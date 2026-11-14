# 固件布局：封装识别、分区还原、Boot 链与硬编码密钥

> 被 `competition-firmware-layout` 引用。原则：**先画清边界，再动手改**。
> 每提取一次都要留 offsets / hashes 的原始记录，否则后面的结论无法复现。

## 一、第一手信息（不改动镜像）

```bash
# 永远先备份、先算 hash
sha256sum firmware.bin > firmware.sha256
cp firmware.bin firmware.bin.orig

file firmware.bin
stat -c '%s bytes' firmware.bin
hexdump -C firmware.bin | head -32
strings -n 8 firmware.bin | head -40
```

`file` 的常见输出与含义：

| 输出 | 含义 |
| --- | --- |
| `data` | 无标准 magic，要手动找分区表/文件系统 |
| `u-boot legacy uImage` | U-Boot 镜像头（64 字节） |
| `Squashfs filesystem, little endian` | 直接是 rootfs |
| `Linux kernel ARM boot executable zImage` | 内核 |
| `Android bootimg` | Android boot 分区 |
| `TRX firmware` | Broadcom/Netgear 的 TRX 封装 |
| `ISO 9660 CD-ROM` | 少见，但存在 |

## 二、封装格式识别表

| 封装 | magic（hex / ascii） | 结构 | 提取工具 |
| --- | --- | --- | --- |
| Squashfs | `hsqs`（le）/ `sqsh`（be）at offset 0 | 单文件系统，可 `unsquashfs` 直挂 | `unsquashfs`、`binwalk -e` |
| Cramfs | `0x28cd3d45` | 只读压缩 fs，块内 zlib | `cramfsck -x`、`binwalk` |
| JFFS2 | `0x1985`（node magic）+ `0xE001` | 裸 flash 镜像，需正确 erase size | `jefferson`、`jffs2dump` |
| UBIFS / UBI | `UBI#`（0x55424923） | UBI 容器内含 UBIFS 卷 | `ubireader_extract_images`、`ubireader_extract_files` |
| YAFFS2 | 无全局 magic，按页 | NAND 专用 | `unyaffs` |
| ext2/3/4 | `0x53EF` at 0x438 | 普通块设备 | `mount -o loop`、`debugfs` |
| TRX | `HDR0`（0x30524448） | 头部 + 多段（loader/linux/rootfs） | `binwalk -e`、`trx` 脚本 |
| U-Boot uImage | `0x27051956` | 64B 头 + 数据，含 `ih_load`/`ih_ep` | `dumpimage -T`、`binwalk` |
| CHK（Netgear） | `*#$^!` 变体 | 头部 + squashfs | `binwalk`、`chk` 工具 |
| D-Link SHRS | `SHRS` | 加密头（部分型号） | 需解密脚本 |
| TP-Link | 头部含型号字符串 | 常为 `0x01000000` 后跟分区 | `binwalk` |
| Sercomm | `0x4seC`（"Sec"） | 加密/签名 | 需密钥 |
| OpenWrt sysupgrade | tar.gz 内含 `sysupgrade-*` 目录 | 直接 `tar tzf` | `tar` |

**识别命令**：

```bash
binwalk firmware.bin                 # 签名扫描（最直接）
binwalk -E firmware.bin              # 熵图
binwalk -A firmware.bin              # 指令架构扫描（MIPS/ARM 识别）
unblob -e out/ firmware.bin          # 现代替代，处理嵌套更强（-e = 输出目录）
```

## 三、熵图怎么读（这是最快判断"有没有加密"的方法）

`binwalk -E` 输出的熵值 0~1：

| 熵值区间 | 含义 | 处理 |
| --- | --- | --- |
| 0 ~ 0.3 | 大量填充（0x00/0xFF）、未初始化区 | 跳过，通常是 padding |
| 0.3 ~ 0.85 | 代码/文本/结构化数据 | 正常，继续 |
| 0.85 ~ 1.0 | 压缩或加密 | 压缩 → 找 fs magic；加密 → 找解密逻辑 |
| 全图 1.0（整块） | **全镜像加密** | 需要设备上的解密程序或密钥，静态提取无解 |
| 整块 0.0 | 空镜像 / 只读错文件 | 检查是否下错或下载中断 |

**判据**：整块高熵 + 找不到任何 fs magic = 加密固件。这时唯一出路是
① 从设备 flash 直接 dump（SPI/JTAG）；② 找 OTA 更新时的解密过程；③ 找厂商签名绕过。

## 四、分区表与"未封装"固件

很多固件（尤其是 eMMC dump）没有容器，直接是分区表：

```bash
# MBR
fdisk -l image.bin
# GPT
gdisk -l image.bin
parted image.bin unit s print

# 按 offset 直接切（示例：offset 0x100000，size 0x800000）
dd if=image.bin of=part_kernel.bin bs=1 skip=$((0x100000)) count=$((0x800000)) status=progress
# 更精确：用 parted 的输出算
```

**记录表格式**（报告必须有）：

```text
offset      size        type          name        sha256
0x00000000  0x00040000  u-boot        bootloader  a1b2...
0x00040000  0x00600000  uImage        kernel      c3d4...
0x00640000  0x01800000  squashfs      rootfs      e5f6...
0x01e40000  0x00100000  jffs2         config      07a8...
```

## 五、嵌套提取（固件里套固件）

常见嵌套：`TRX → uImage → (kernel + squashfs)`、`tar.gz → sysupgrade.tar → squashfs`、
`UBI → ubifs → 内含另一个 squashfs`。

```bash
# 递归提取（binwalk 的 -M 是 matryoshka，递归）
binwalk -eM firmware.bin

# 手动分层
mkdir -p layer1 && cd layer1
tar tzf ../firmware.tar.gz
tar xzf ../firmware.tar.gz
file *
binwalk -e *

# UBI 两层
ubireader_extract_images rootfs.ubi -o ubi_img/
ubireader_extract_files -o ubi_fs/ rootfs.ubi
ls ubi_fs/

# JFFS2（先用 jffs2dump 确认 endianness 与 erase size，再解）
jffs2dump -c -v rootfs.jffs2 | head -10
jefferson -d jffs2_out/ rootfs.jffs2
# 解出垃圾时先怀疑 erase block size / 镜像被截断，而不是换工具
```

## 六、Boot / 更新链的还原顺序

不要直接跳到 rootfs 里最有趣的文件，要按链走：

```text
1. Boot ROM / 厂商 bootstrap        → 烧录地址、校验方式
2. Bootloader（U-Boot / CFE）        → bootargs、kernel 加载地址、rootfs 位置
3. Kernel + initramfs                → 内核版本、initramfs 是否含救援 shell
4. rootfs /etc/inittab 或 systemd    → init 顺序、启动的服务
5. 更新校验器（/usr/sbin/upgrade）    → 签名算法、公钥位置、是否可绕过
```

```bash
# U-Boot 环境变量（明文常在镜像里）
strings -n 6 firmware.bin | grep -E 'bootargs|bootcmd|mtdparts|console=|root='
# 从 uImage 里解出内核命令行
dumpimage -l kernel.uImage
dumpimage -T flat_dt -p 0 -o kernel.dtb kernel.uImage

# init 链
cat rootfs/etc/inittab 2>/dev/null || ls rootfs/etc/systemd/system/
cat rootfs/etc/init.d/rcS
ls -l rootfs/etc/rc.d/

# 更新流程
strings rootfs/usr/sbin/upgrade 2>/dev/null | grep -Ei 'signature|verify|rsa|sha256|md5'
find rootfs -name '*.pub' -o -name 'pubkey*' -o -name '*public*'
```

## 七、找硬编码凭据（按命中率排序）

```bash
# 1) 口令与账号
grep -rInE '(password|passwd|pwd|secret|admin)[[:space:]]*[=:]' rootfs/etc/ rootfs/usr/ 2>/dev/null | head -40
cat rootfs/etc/shadow 2>/dev/null | head
cat rootfs/etc/passwd | head

# 2) 常见默认账户（很多固件直接写死）
grep -rn 'root:' rootfs/etc/ | head
grep -rn 'support\|admin\|guest' rootfs/etc/passwd

# 3) 私钥
find rootfs -type f \( -name '*.pem' -o -name '*.key' -o -name 'id_rsa*' -o -name '*.p12' \) -exec ls -l {} \;
grep -rl 'BEGIN.*PRIVATE KEY' rootfs/ 2>/dev/null | head

# 4) 云/API key
grep -rInE '(AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36})' rootfs/ | head

# 5) 二进制里的字符串（配置常编译进二进制）
strings -n 6 rootfs/usr/sbin/httpd | grep -iE 'pass|admin|key|token' | head -30

# 6) web 后台默认口令（常见于 CGI）
grep -rIn 'Authorization\|Basic ' rootfs/www/ 2>/dev/null | head
find rootfs -name '*.cgi' -o -name '*.lua' | head

# 7) 无线默认 PSK
grep -rInE 'wpa_passphrase|WPA-PSK|ssid' rootfs/etc/ | head
```

**验证硬编码凭据是否"决定性"**：必须证明**哪个进程在读它**。

```bash
# 在仿真环境里（见 emulation-and-fuzz.md）跑起来，然后
ps aux
lsof | grep -i shadow           # 谁打开了 /etc/shadow
strace -f -e openat ./httpd 2>&1 | grep -i passwd
```

## 八、签名与校验的位置（攻防关键）

| 位置 | 找什么 | 绕过思路 |
| --- | --- | --- |
| U-Boot 的 `bootm` 前 | `CONFIG_FIT_SIGNATURE`、公钥在 dtb 里 | 换 dtb 或改 `bootargs` |
| rootfs 挂载前 | dm-verity、`CONFIG_SQUASHFS_XATTR` | 改分区表或禁用 verity |
| 更新包解包前 | `/usr/sbin/upgrade` 里的 RSA/ECDSA 校验 | patch 掉 `verify` 返回值 |
| Web 上传接口 | 固件上传时的 sig 检查 | 找不校验的恢复接口 |
| 双分区 A/B | 回滚机制是否校验 | 降级到有漏洞的旧版 |

```bash
# 检查 dm-verity / 签名相关
strings rootfs/usr/sbin/upgrade | grep -iE 'verity|rsa_verify|EVP_Verify|signature'
grep -rn 'verity' rootfs/etc/ rootfs/usr/lib/ 2>/dev/null | head

# 公钥的典型位置
ls -l rootfs/etc/ssl/ rootfs/etc/certs/ rootfs/usr/share/public/ 2>/dev/null
```

**判据**：签名校验是"在用户态做"（可 patch）还是"在 bootloader/硬件做"（难）。
前者基本都能绕，后者只能靠"降级到未签名校验的旧固件"或"改启动参数"。

## 九、检测视角（防守方：怎么发现固件被改了）

| 检查点 | 方法 |
| --- | --- |
| 镜像完整性 | 出厂时记录 `sha256` 全镜像 + 分区级 hash，OTA 前比对 |
| 签名验证 | 强制 `secure boot`，拒绝 unsigned 镜像 |
| 分区表变更 | 监控 `mtd` 分区表的写入 |
| rootfs 修改 | `dm-verity` + 只读挂载 |
| 调试接口 | 量产固件关闭 UART/JTAG，禁用 `telnetd` |

## 十、验伤信号

| 声称 | 硬证据 | 假成功反例 |
| --- | --- | --- |
| 提取成功 | `unsquashfs -l` 能列出完整文件树，`/etc/passwd` 可读 | binwalk 报 "Squashfs filesystem" 但 `unsquashfs` 报 `magic not found`（offset 错） |
| 拿到硬编码口令 | 能在仿真设备上用该口令登录 web/telnet | 只是 `strings` 里看到字符串，实际是错误提示文案 |
| 找到私钥 | 私钥能解析（`openssl rsa -in k.pem -check`）且能验证某个签名 | 只是证书里的公钥（`BEGIN PUBLIC KEY`） |
| 找到签名校验点 | patch 掉校验后，改过的固件能被设备接受 | 校验在 bootloader 里，patch rootfs 无效 |
| Boot 链还原 | 能用提取出的 kernel+rootfs 在 QEMU 里跑到 shell | 只能启动内核，rootfs 挂载失败 |

## 十一、常见坑

1. **先改后记**。解包后直接在原目录改文件，之后再也说不清原始 offset。
   永远 `cp -a` 到 `work/`，原镜像只读。
2. **Squashfs 的 offset 差 1 字节就失败**。`unsquashfs -o <offset>` 要精确；
   binwalk 给出的 offset 有时是 magic 位置，实际数据可能早几个字节。
3. **JFFS2 解出垃圾先怀疑镜像本身**。常见原因是镜像被截断（dump 长度不够）、
   erase block size 与 NAND 实际不符（0x20000 / 0x40000 / 0x80000）、或该文件其实是
   UBI 容器而不是裸 JFFS2。用 `jffs2dump -c -v` 看节点是否连续、`binwalk` 是否同时
   报出 `UBI#`。不要盲目换工具重试。
4. **UBI 的 `-o` 参数容易覆盖**。`ubireader_extract_files` 输出目录存在时会跳过，
   要先 `rm -rf` 再跑。
5. **熵高不等于加密**。压缩过的 squashfs 也是高熵。判据是"有没有 fs magic"。
6. **多分区同名文件**。`/etc/passwd` 可能在 rootfs 和 config 分区各有一份，
   报告里必须标明来自哪个分区（用 offset 区分）。
7. **uint32 大小端**。MIPS BE 固件的 magic 会是 `sqsh` 而不是 `hsqs`，
   `unsquashfs` 需要 `-b`（big-endian）或对应版本支持。