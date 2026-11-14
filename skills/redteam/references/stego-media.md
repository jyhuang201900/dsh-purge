# 隐写分析：媒体通道、检测顺序、提取命令

> 被 `competition-stego-media` 引用。隐写题的纪律是**先确认容器真相，再逐层剥**。
> 跳过 `binwalk`/`exiftool` 直接上 LSB 脚本，是浪费时间的最常见方式。

## 一、检测顺序（固定五步，不要跳）

```text
1. 容器真相：file / xxd / binwalk / exiftool —— 类型、尺寸、附加数据、元数据
2. 一眼可见：strings / foremost / 尾部 hex —— 是否有明文/压缩/zip
3. 结构性：chunk 表 / 段落 / 帧数 / 页对象 —— 异常尺寸、多余块
4. 通道级：LSB / 调色板 / alpha / 频谱 / 帧差 —— 逐通道
5. 深挖：变换域 / 加密 blob / 二次隐写
```

```bash
# Step 1（四条命令，30 秒内跑完）
file suspect.png
xxd -l 64 suspect.png
exiftool suspect.png
binwalk suspect.png
```

| 命令 | 回答什么问题 |
| --- | --- |
| `file` | 真实类型（扩展名不可信） |
| `xxd -l 64` | 魔数、头部字段 |
| `exiftool` | 元数据、注释、软件、GPS、时间 |
| `binwalk` | 内部嵌套了什么（zip/png/jpeg/elf） |

```bash
# Step 2
strings -a -n 6 suspect.png | head -30
binwalk -e suspect.png                 # 自动提取（谨慎，会产生目录）
# 尾部附加：看最后一个 IEND 之后还有什么
python3 - <<'PY'
d = open("suspect.png","rb").read()
i = d.rfind(b"IEND")
print("total", len(d), "IEND at", i, "trailing", len(d) - (i + 8))
print(d[i+8:i+80])
PY
```

## 二、图片：五类通道

### 2.1 LSB（最低有效位）

| 项 | 说明 |
| --- | --- |
| 原理 | 改像素值最低 1-2 位，人眼不可见 |
| 适用 | PNG（无损）、BMP、TIFF；**JPEG 不适用**（有损压缩会破坏） |
| 容量 | 1 bit/通道 → 3 bit/像素（RGB） |
| 提取 | 按位重组为字节，按通道顺序（R,G,B）或交错 |

```bash
# zsteg（Ruby，PNG/BMP 最全，自动试多种位平面与通道）
gem install zsteg
zsteg suspect.png                      # 全自动扫
zsteg -a suspect.png                   # 所有组合（慢但全）
zsteg -E "b1,rgb,lsb,xy" suspect.png > out.bin      # 精确指定
zsteg -E "b1,bgr,lsb,xy" suspect.png > out2.bin     # BGR 顺序（很常见）

# stegsolve（GUI，逐位平面可视化）—— 手动看最直观
java -jar stegsolve.jar
```

```python
# 手写 LSB 提取（可控，便于调通道顺序）
from PIL import Image
im = Image.open("suspect.png").convert("RGBA")
w, h = im.size
px = im.load()
bits = []
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        bits += [r & 1, g & 1, b & 1]        # 只取 RGB
# 每 8 位 → 1 字节（高位在前）
out = bytes(int("".join(map(str, bits[i:i+8])), 2) for i in range(0, len(bits)//8*8, 8))
open("lsb.bin","wb").write(out)
print(out[:64])
```

| 变体 | 怎么试 |
| --- | --- |
| 通道顺序 | RGB / BGR / GRB / 单通道 |
| 位平面 | bit0 / bit1 / bit0+bit1 |
| 起点偏移 | 前 N 个像素跳过（常有 4/8/16 字节头） |
| 行序 | 从上到下 / 从下到上 |
| 交错 | 逐像素 / 逐通道平面 |

### 2.2 附加数据（appended / trailer）

```bash
# PNG：IEND 之后
# JPEG：FFD9 之后
# GIF：3B（trailer）之后
python3 - <<'PY'
for f, marker in [("a.png", b"IEND"), ("a.jpg", b"\xff\xd9"), ("a.gif", b";")]:
    try: d = open(f,"rb").read()
    except: continue
    i = d.rfind(marker)
    print(f, "len", len(d), "marker@", i, "trail", len(d)-i-len(marker))
    print("  head:", d[i+len(marker):i+len(marker)+48])
PY
```

```bash
# 提取附加数据
python3 -c "
d=open('a.png','rb').read(); i=d.rfind(b'IEND')+8
open('trail.bin','wb').write(d[i:])"
binwalk trail.bin
file trail.bin
```

### 2.3 调色板（palette）与 alpha

| 通道 | 说明 |
| --- | --- |
| 调色板顺序 | 改索引顺序隐藏信息（PNG 的 PLTE chunk） |
| 调色板值 | 未使用的颜色槽里塞数据 |
| alpha 通道 | 全不透明但 alpha 值有低位差异 |
| 透明度索引 | GIF 的 transparent index |

```bash
# 看 palette
python3 - <<'PY'
from PIL import Image
im = Image.open("suspect.png")
print(im.mode, im.size, "palette:", bool(im.palette))
if im.palette:
    pal = im.palette.getdata()[1]
    print("palette bytes:", len(pal), pal[:32].hex())
PY
```

### 2.4 EXIF / 元数据

```bash
exiftool -a -u -g1 suspect.jpg          # 全部，含未知标签
exiftool -b -Comment suspect.jpg        # 只取 Comment（可能有载荷）
exiftool -b -UserComment suspect.jpg > c.bin
# 大块 EXIF（缩略图里可藏文件）
exiftool -b -ThumbnailImage suspect.jpg > thumb.jpg
```

| 字段 | 常被用来藏 |
| --- | --- |
| `Comment` / `UserComment` | 明文/base64 |
| `ImageDescription` | 同上 |
| `XPComment`（Windows） | UTF-16 |
| `ThumbnailImage` | 第二张图（可能是原图/载荷） |
| `MakerNote` | 厂商私有区（常有未解析数据） |
| `XMP` | XML 里可塞 base64 |

### 2.5 结构性异常

```bash
# PNG chunk 列表（看有没有非标准 chunk）
python3 - <<'PY'
import struct
d = open("suspect.png","rb").read()
i = 8
while i < len(d) - 8:
    ln, typ = struct.unpack(">I4s", d[i:i+8])
    print(typ.decode(errors="replace"), "len", ln, "at", i)
    i += 12 + ln
PY
```

| 异常 | 含义 |
| --- | --- |
| 非标准 chunk（`tEXt`/`zTXt`/`iTXt` 之外的自定义） | 可能藏数据 |
| `zTXt` / `iTXt` 压缩文本 | 解压后可能有大块数据 |
| 多个 IDAT 但总长异常 | 正常 |
| 尺寸与内容不符 | 可能裁剪过 |

```bash
# 提取所有文本 chunk
python3 - <<'PY'
import struct, zlib
d = open("suspect.png","rb").read(); i = 8
while i < len(d) - 8:
    ln, typ = struct.unpack(">I4s", d[i:i+8])
    body = d[i+8:i+8+ln]
    if typ in (b"tEXt", b"iTXt", b"zTXt"):
        print(typ, body[:120])
        if typ == b"zTXt":
            try: print("  unz:", zlib.decompress(body.split(b"\x00",2)[2]))
            except Exception as e: print("  err", e)
    i += 12 + ln
PY
```

## 三、音频：四类通道

### 3.1 频谱（spectrogram）

| 项 | 说明 |
| --- | --- |
| 原理 | 把音频转时频图，隐藏信息画成图形（常见于 CTF） |
| 工具 | Audacity（频谱视图）、Sonic Visualiser、`sox` |
| 特征 | 高频区有"文字/图形"轮廓 |

```bash
# Audacity：导入 → 轨道菜单 → Spectrogram（或 Spectrogram Settings 调窗函数）
# 命令行生成频谱图（sox + spectrogram）
sox suspect.wav -n spectrogram -o spec.png -X 1000 -y 800 -z 100
# -X/-y = 宽高；-z = 动态范围（dB）
```

```bash
# 用 Python 生成更可控的频谱（scipy）
python3 - <<'PY'
import numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.io import wavfile
sr, x = wavfile.read("suspect.wav")
if x.ndim > 1: x = x[:,0]
plt.specgram(x, NFFT=1024, Fs=sr, noverlap=512, cmap="magma")
plt.ylim(0, sr//2); plt.savefig("spec.png", dpi=200)
print("sr", sr, "len", len(x)/sr, "s")
PY
```

### 3.2 回声隐藏（echo hiding）

| 项 | 说明 |
| --- | --- |
| 原理 | 用两种延迟的回声代表 0/1 |
| 识别 | 自相关/倒谱在固定延迟处有峰 |
| 检测 | 倒谱分析（cepstrum）看峰位 |

```python
# 倒谱检测（简化）
import numpy as np
from scipy.io import wavfile
sr, x = wavfile.read("suspect.wav")
x = x[:,0] if x.ndim > 1 else x
x = x.astype(float) / 32768.0
# 分段做倒谱，看是否有稳定延迟峰
seg = x[:sr]                       # 1 秒
spec = np.fft.rfft(seg)
cep = np.fft.irfft(np.log(np.abs(spec) + 1e-12))
peaks = np.argsort(cep[:2000])[-5:]
print("cepstrum peaks (samples):", sorted(peaks.tolist()))
```

### 3.3 相位编码 / 扩频 / 摩斯

| 通道 | 识别 | 提取 |
| --- | --- | --- |
| 相位编码 | 相位突变处对应位 | 解调相位差 |
| 扩频（spread spectrum） | 类似噪声，需 key | 需要密钥/伪随机序列 |
| 摩斯 | 长短音（可听） | 听 + 手工，或 `morse` 解码 |
| DTMF | 双音（电话按键） | `multimon-ng` |
| 静音间隔 | 段间时长编码 | 测时长 |

```bash
# DTMF / 其它数字信令
multimon-ng -a DTMF -t wav suspect.wav
multimon-ng -a AFSK1200 -t wav suspect.wav     # 也解 pocsag 等

# 摩斯（若有现成音频，先降噪 + 二值化）
sox suspect.wav -n stat 2>&1 | head        # 看幅度
```

```python
# 简易摩斯：按能量门限切成"单位长度"，再映射
import numpy as np
from scipy.io import wavfile
sr, x = wavfile.read("morse.wav")
x = np.abs(x[:,0] if x.ndim > 1 else x).astype(float)
thr = x.max() * 0.3
on = x > thr
# 找连续 on/off 段长度
segs, cur, val = [], 1, on[0]
for b in on[1:]:
    if b == val: cur += 1
    else: segs.append((val, cur)); val, cur = b, 1
segs.append((val, cur))
unit = min(c for v, c in segs if v)     # 最短 on = 1 单位
print([(("on" if v else "off"), round(c/unit,1)) for v, c in segs][:40])
```

### 3.4 容器层（WAV 的 chunk / MP3 的 tag）

```bash
# WAV：RIFF chunk 列表（可能有 LIST/INFO 或自定义 chunk）
python3 - <<'PY'
import struct
d = open("suspect.wav","rb").read()
i = 12
while i < len(d) - 8:
    cid, sz = struct.unpack("<4sI", d[i:i+8])
    print(cid, sz, "at", i)
    i += 8 + sz + (sz & 1)
PY

# MP3：ID3 tag 可塞大块数据
exiftool -b -ID3v2_Private suspect.mp3 > priv.bin
id3v2 -l suspect.mp3
```

## 四、文档：四类通道

| 通道 | 说明 | 提取 |
| --- | --- | --- |
| 隐藏文本 | 白色字体 / 极小字号 / 隐藏文字层 | `pdftotext` 后 grep；`strings` |
| 元数据 | 作者/标题/注释字段 | `exiftool`、`pdfinfo` |
| 对象流 | PDF 的 stream 对象里嵌文件 | `pdf-parser`、`peepdf` |
| zip 附加 | docx/xlsx 是 zip，里面可放任意文件 | `unzip -l` + `binwalk` |
| 修订记录 | DOCX 的 `word/people.xml`、批注 | `unzip` 后看 |
| 图片里的图 | 文档内嵌图本身可能带隐写 | 提取图后按图片流程 |

```bash
# PDF
pdfinfo suspect.pdf
pdftotext -layout suspect.pdf - | grep -iE "flag|secret|key"
pdfimages -all suspect.pdf out/img        # 提取所有图
pdf-parser.py --search stream suspect.pdf | head
peepdf -f suspect.pdf                     # 交互式分析（JS/流）

# Office（docx/xlsx/pptx 都是 zip）
unzip -l suspect.docx
unzip -o suspect.docx -d docx_un
ls -R docx_un/word/ | head
cat docx_un/word/document.xml | tr '<' '\n' | grep -i "flag" | head

# 文档内的隐藏文本（白色/极小）在 XML 里可见
grep -o 'w:color w:val="FFFFFF"[^>]*' docx_un/word/document.xml | head
```

## 五、视频与其他容器

| 通道 | 说明 | 命令 |
| --- | --- | --- |
| 帧级隐写 | 每隔 N 帧藏一位 | 抽帧后按图片流程 |
| 帧序 | 打乱帧顺序编码 | `ffprobe` 看 PTS 是否单调 |
| 音轨 | 视频里的音频轨 | `ffmpeg -i v.mp4 -vn -acodec copy a.aac` |
| 字幕轨 | 隐藏字幕 | `ffmpeg -i v.mp4 -map 0:s:0 s.srt` |
| 容器 metadata | mp4 的 `udta`/`meta` | `exiftool`、`ffprobe -show_format` |
| 附加数据 | mp4 末尾 | `binwalk` |

```bash
ffprobe -v error -show_streams -show_format suspect.mp4
ffmpeg -i suspect.mp4 -vsync 0 frames/%05d.png      # 抽全部帧
ffmpeg -i suspect.mp4 -vf "select='not(mod(n\,10))'" -vsync 0 f/%04d.png   # 每 10 帧
```

## 六、工具清单与安装

| 工具 | 用途 | 安装 |
| --- | --- | --- |
| `binwalk` | 嵌套/附加检测与提取 | `pip install binwalk` + `apt install binwalk` |
| `foremost` | 按文件头 carving | `apt install foremost` |
| `exiftool` | 元数据 | `apt install libimage-exiftool-perl` |
| `zsteg` | PNG/BMP LSB | `gem install zsteg` |
| `stegsolve` | 位平面可视化 | jar |
| `steghide` | JPEG/BMP/WAV 隐写（需口令） | `apt install steghide` |
| `outguess` | JPEG | `apt install outguess` |
| `pngcheck` | PNG 结构校验 | `apt install pngcheck` |
| `pdf-parser` / `peepdf` | PDF | `pip install pdf-parser` |
| `sox` / `ffmpeg` | 音频/视频 | `apt install sox ffmpeg` |
| `multimon-ng` | 数字信令 | `apt install multimon-ng` |
| `stegdetect` | JPEG 隐写检测 | 老工具 |
| `aperisolve` | 在线多工具集成 | 网页（敏感样本勿传） |

```bash
# 一条龙（PNG 常见组合）
binwalk -e suspect.png && \
zsteg -a suspect.png > zsteg.txt && \
pngcheck -v suspect.png && \
exiftool suspect.png > exif.txt
```

## 七、检测视角（防守方：外发媒体带隐写）

| 场景 | 信号 |
| --- | --- |
| 内部人员外发图片 | DLP 的图片→外部邮箱；图片元数据被剥（常见于隐写工具处理后） |
| 图片异常大 | 同分辨率下 PNG 体积远超同类 |
| 元数据异常 | `Software` 是 steg 工具名；`Comment` 有 base64 |
| 高频图片外发 | 单用户短时间大量图片上传 |
| 音频/视频外发 | 少见格式（wav 而非 mp3）大量外发 |
| 文档带宏/嵌入对象 | OLE 对象、`/EmbeddedFile` |

## 八、验伤信号

| 声称 | 证据 |
| --- | --- |
| "容器真相已确认" | `file` 输出 + 关键头字段值 + 与扩展名是否一致 |
| "找到隐藏数据" | 偏移 + 长度 + 提取命令 + 提取出的字节 |
| "LSB 提取成功" | 通道/位平面/顺序明确，输出**可解析**（有魔数或可读） |
| "解出明文" | 明文内容 + 它来自哪一层（链路可复现） |

**反例（看起来成功其实是假）**：

- `zsteg` 输出一堆字符串就报"找到 flag" → 大部分是 PNG 的正常 chunk 文本
- LSB 提取出 100KB 数据 → 但熵接近随机、无魔数：只是噪声
- 看到 base64 就解码 → 解出来是另一层 base64（或乱码），不是终点
- `binwalk` 报有 zip → 其实是 PNG 的 IDAT 被误判（看偏移是否在 IEND 之后）
- JPEG 上做 LSB → 有损压缩后数据已破坏，理论上不可恢复

## 九、常见坑

1. **先上 LSB 不看容器**——80% 的题在 `binwalk`/`exiftool` 阶段就解了。
2. **通道顺序错**——`RGB` vs `BGR` 是最高频失败原因，两个都试。
3. **忽略起点偏移**——隐写工具常在头部留 4/8/16 字节头，要跳过。
4. **JPEG 用 LSB**——JPEG 是有损的，LSB 会被压缩破坏；
   JPEG 常见的是 DCT 系数隐写（`steghide`/`outguess`/`F5`）。
5. **忘记看 IEND/FFD9 之后**——附加数据是最简单的隐藏方式。
6. **音频只"听"**——频谱图能看到听不到的信息；先看频谱再听。
7. **文档只看正文**——docx/xlsx 是 zip，`unzip -l` 可能直接看到 `flag.txt`。
8. **不保留中间产物**——多层隐写必须每层落盘，否则无法复现。