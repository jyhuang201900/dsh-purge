# 固件提取方法论：先判封装，再选工具，失败怎么兜

> 被 `firmware-pentest` 引用。`binwalk -e` 不是万能的，它失败的场景比成功的多。
> 这一篇讲**失败模式与补救**，不讲"一键提取"。

## 一、提取前的三条铁律

1. **原始镜像只读**。`chmod 444 firmware.bin`，所有工作在 `work/` 副本上做。
2. **每步记录 offset**。`binwalk` 输出的 offset 是后续所有结论的锚点。
3. **提取结果要能自证**。`unsquashfs -l` 能列出文件树才算提取成功，
   不是"binwalk 打印了一堆 magic"。

```bash
mkdir -p work/{raw,extracted,mounted,patched}
cp firmware.bin work/raw/firmware.bin
cd work/raw && sha256sum firmware.bin | tee firmware.sha256
```

## 二、先判封装：四步决策树

```text
① file firmware.bin
   ├─ 认得出（Squashfs / uImage / TRX / UBI）→ 直奔对应工具
   └─ "data" → ②
② hexdump -C | head -32，看头 64 字节
   ├─ 有 ASCII 型号字符串 / "HDR0" / "*#$^!" → TRX/CHK 类
   ├─ 全 0xFF / 全 0x00 → 可能是裸 flash dump，找分区表
   └─ 高熵乱码 → 可能加密，③
③ binwalk -E（熵图）+ binwalk（magic 扫描）
   ├─ 找到 fs magic → 按 offset 提取
   └─ 只有高熵无 magic → 加密固件，见第五节
④ 找分区表
   ├─ fdisk -l / gdisk -l 有输出 → 按分区切
   └─ 无 → 手工扫描（strings 找 "mtdparts"、"rootfs"、内核版本）
```

## 三、binwalk -e 的五种失败模式

| 现象 | 原因 | 补救 |
| --- | --- | --- |
| `WARNING: Extractor.execute failed` | 缺 `unsquashfs`/`jefferson` 等 | `apt install squashfs-tools mtd-utils` |
| 提取出的目录是空的 | offset 偏了 / 压缩块损坏 | `unsquashfs -o <offset>` 手动试多个 offset |
| `Squashfs image is corrupt` | 镜像被截断 / 加密 / 非标准块大小 | 试 `-b 131072`、`-comp xz`；或改用 `unblob` |
| 解出一堆 `_firmware.bin.extracted/xxx` 碎片 | 只识别到内层 magic，外层没识别 | 先手动切外层，再逐层 binwalk |
| 无限递归 | `-M` 遇到自引用 | 用 `-d 2` 限制递归深度 |

```bash
# 更稳的替代：unblob（支持更多格式、自动处理嵌套、输出 JSON 报告）
pipx install unblob
unblob -e work/extracted -v firmware.bin
#  -e = 输出目录；参数以 `unblob --help` 为准
cat work/extracted/report.json | jq '.chunks[] | {start_offset, end_offset, handler_name}'

# 限制 binwalk 递归深度（避免爆炸）
binwalk -e -d 2 firmware.bin
```

## 四、按封装选工具（真实命令，含参数）

### Squashfs

```bash
# 列内容（先确认能读）
unsquashfs -l firmware.bin | head -30
# 解到指定目录
unsquashfs -d work/extracted/rootfs -f firmware.bin
# 指定 offset（关键：offset 是字节数，不是块号）
unsquashfs -o $((0x640000)) -d work/extracted/rootfs -f firmware.bin
# 大端
unsquashfs -be -d out/ firmware.bin
# 指定压缩算法与块大小（老固件常见）
unsquashfs -comp xz -b 131072 -d out/ firmware.bin
```

**offset 怎么算**：binwalk 输出 `DECIMAL HEXADECIMAL DESCRIPTION`，
用 `DECIMAL` 列（十进制）。差 1 字节都会失败，可以 `-o` 附近 ±16 试。

### Cramfs

```bash
cramfsck -x work/extracted/cramfs firmware_cramfs.bin
# 或在能 mount 的环境
mount -t cramfs -o loop,ro firmware_cramfs.bin /mnt
```

### JFFS2

```bash
# 先确认 endianness 与 erase block size（这一步决定成败）
jffs2dump -c -v rootfs.jffs2 | head -10
#   看 "Endianess: Little/Big" 与 erase block size

# 提取
jefferson -d work/extracted/jffs2 rootfs.jffs2
# jefferson 的 endianness 依据镜像自身 magic 判断，一般不用手工指定；
# 若解出垃圾，先用 jffs2dump 确认镜像是否被截断或 erase size 不对

# 备用：mtd-utils（在能 mount 的 Linux 上）
sudo modprobe mtdram total_size=131072 erase_size=128
sudo modprobe mtdblock
sudo dd if=rootfs.jffs2 of=/dev/mtdblock0 bs=128
sudo mount -t jffs2 /dev/mtdblock0 /tmp/jffs2
```

### UBI / UBIFS

```bash
# 先看容器信息与卷清单（卷名、大小、类型）
ubireader_display_info rootfs.ubi

ubireader_extract_images rootfs.ubi -o work/extracted/ubi_img
ubireader_extract_files -o work/extracted/ubi_fs rootfs.ubi
ls work/extracted/ubi_fs/

# 只要某个卷：用 -V 指定卷名（卷名从 display_info 拿）
ubireader_extract_files -o out -V rootfs rootfs.ubi
# 注：不同版本参数名有差异，先 `ubireader_extract_files -h` 确认
```

### TRX

```bash
# binwalk 能识别 HDR0，但分段信息要自己解析
xxd -l 28 firmware.trx
# offset 0x00 "HDR0", 0x04 len, 0x08 crc32, 0x0c flags, 0x10 offsets[3]
python3 - <<'PY'
import struct
d = open('firmware.trx','rb').read()
magic, ln, crc, flags, o1, o2, o3 = struct.unpack('<4sIII3I', d[:28])
print('len', ln, 'flags', hex(flags), 'offsets', hex(o1), hex(o2), hex(o3))
open('trx_part1.bin','wb').write(d[o1:o2])
open('trx_part2.bin','wb').write(d[o2:o3])
PY
```

### tar 类（OpenWrt 等）

```bash
tar tzf firmware.tar.gz | head
tar xzf firmware.tar.gz -C work/extracted/
find work/extracted -maxdepth 2 -name 'sysupgrade-*' -o -name '*.squashfs'
```

## 五、加密固件的判定与补救

**判定**：

```bash
binwalk -E firmware.bin        # 整块 1.0
binwalk firmware.bin            # 无任何 fs magic
strings -n 8 firmware.bin | head   # 无可读字符串（全乱码）
```

**补救路径（按成本排序）**：

| 路径 | 做法 | 前提 |
| --- | --- | --- |
| 找同型号的明文固件 | 老版本/不同区域版本常不加密 | 能下载到 |
| 设备上直接 dump flash | SPI 夹子 / `dd if=/dev/mtd0` | 有物理访问或已 root |
| 逆向更新程序 | 找到解密函数和密钥（常在 `/usr/sbin/upgrade` 或 bootloader） | 能拿到另一个明文固件做对照 |
| 抓 OTA 过程 | 中间人抓设备解压前的明文 | 能控制网络 |
| 找厂商泄露的密钥 | 公开的 GPL 源码包里常有 | 概率低但值得搜 |

```bash
# 从明文固件里找解密线索（对比法）
# 如果同型号有新旧两个版本，一个加密一个不加密，diff 二进制找算法特征
# 常见标记：AES sbox、RSA 常量、OpenSSL 字符串
strings -n 6 firmware_old.bin | grep -iE 'aes|rsa|decrypt|openssl|crypto'
```

## 六、提取不全的补救（"少了一半文件"）

```bash
# 1) 确认是否只是没解全
unsquashfs -l firmware.bin | wc -l
unsquashfs -d out/ firmware.bin 2>&1 | tail -5    # 看有没有 "failed to write"

# 2) 检查是否有多段 squashfs（分区里的 rootfs 常带 overlay）
binwalk firmware.bin | grep -i squashfs

# 3) 检查 xattrs / 稀疏文件导致的失败
unsquashfs -no-xattrs -d out/ firmware.bin

# 4) 如果是 UBI 里的 UBIFS，卷可能不止一个
ubireader_display_info firmware.ubi     # 先列卷，再决定解哪个

# 5) 设备上直接看真实布局（已 root 时最可靠）
cat /proc/mtd
cat /proc/partitions
mount | grep -E 'jffs2|ubifs|squashfs'
```

**判据**：解出来的文件数 vs 设备上 `find / -xdev | wc -l`。差很多说明提取不全。

## 七、挂载与重建（要改固件时）

```bash
# 解包 → 改 → 重新打包（squashfs 的最常用流程）
unsquashfs -d rootfs_new firmware.bin
# 修改 rootfs_new/...
mksquashfs rootfs_new rootfs_new.sqsh -comp xz -b 131072 -noappend
# 再拼回原镜像（保留 header）
python3 - <<'PY'
orig = open('firmware.bin','rb').read()
new = open('rootfs_new.sqsh','rb').read()
off = 0x640000            # 原始 squashfs 起始 offset
open('firmware_patched.bin','wb').write(orig[:off] + new)
PY
```

**注意**：`mksquashfs` 的版本与参数必须和原镜像一致，否则设备可能拒挂
（老内核不支持新压缩算法，x86 上的 `-comp zstd` 在 MIPS 4.x 内核上挂不上）。

## 八、检测视角（防守方）

| 检查 | 方法 |
| --- | --- |
| 固件完整性 | 出厂 hash 基线 + OTA 前比对 |
| 未授权提取 | 无（这是离线行为），但**设备被 dump** 可以通过 flash 访问计数/调试口检测 |
| 固件被重打包 | 签名校验 + squashfs 块大小/压缩算法的一致性检查 |
| 调试口被用 | UART 引脚电平监测、JTAG 熔丝状态 |

## 九、验伤信号

| 声称 | 硬证据 | 假成功反例 |
| --- | --- | --- |
| 提取成功 | `find out/ -type f \| wc -l` 数量合理，`out/etc/passwd` 可读 | 只有几个 `.extracted` 碎片文件 |
| offset 正确 | `unsquashfs -l` 无报错且文件树完整 | 报 `corrupt` 但 binwalk 说找到了 |
| 加密固件已解 | 解出的内容 `file` 识别为合法 fs | 解出的是随机字节（密钥错） |
| 重打包可用 | 设备/仿真能启动到 shell | 打包成功但内核 panic |

## 十、常见坑

1. **`binwalk -e` 在嵌套时会污染目录**。用 `-d <depth>` 或 `unblob` 分目录。
2. **offset 是十进制不是十六进制**。binwalk 输出两列，脚本里别抄错。
3. **`mksquashfs` 默认块大小 128K，老固件常是 64K**。错设备挂不上。
4. **JFFS2 的 endian 判错**。MIPS BE 设备要用 `-b`，否则解出垃圾。
5. **UBI 提取会合并多个卷**。要看卷名对应哪个分区，别把 `rootfs_data` 当 `rootfs`。
6. **`unsquashfs -f` 会覆盖**。多次尝试时用不同 `-d` 目录，避免互相污染。