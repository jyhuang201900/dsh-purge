---
name: api-security
description: Use for authorized security assessment of REST, GraphQL, WebSocket, or SOAP APIs, including discovery, authentication, authorization, rate-limit, and CI/CD testing.
whenToUse: Use for authorized security assessment of REST, GraphQL, WebSocket, or SOAP APIs, includin
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---

# API 安全测试

## 适用场景

- REST API 安全测试（OpenAPI/Swagger 驱动或盲测）
- GraphQL 安全审计（内省、批查询、别名过载）
- WebSocket 安全测试
- JWT / OAuth 2.0 认证测试
- BOLA/IDOR/BFLA 授权漏洞检测
- API 限速绕过与 DoS 测试

## 10 阶段测试流程

### Phase 1: API 发现与侦察

```text
主动发现：
□ Vespasian: 无头浏览器爬取 → 自动生成 OpenAPI 3.0 / GraphQL SDL 规范
□ Entropy --discover: 从 robots.txt + JS 文件提取端点
□ Kiterunner / ffuf: 爆破未文档化的端点路径
□ 检查常见路径: /swagger.json, /openapi.json, /graphql, /api-docs

GraphQL 内省（三级尝试）：
  1. 标准内省查询
  2. 精简查询（绕过 WAF 全量封禁）
  3. 仅查 __schema { types { name } }（最小探测）
```

### Phase 2: 认证测试

```text
JWT 分析（jwt_tool / Burp）：
□ alg:none 攻击: 修改头部为 "alg":"none"，清空签名
□ 密钥混淆: RS256 公钥 → HS256 对称密钥
□ 弱 HMAC 密钥爆破: jwt_tool -C -d wordlist.txt
□ 过期/声明篡改: 修改 exp/iat/sub/role 声明
□ kid 注入: ../../etc/passwd → HMAC 签名绕过

OAuth 2.0：
□ redirect_uri 操控 → 授权码泄漏
□ CSRF via state 参数缺失
□ Token 在 Referer 头泄漏
□ PKCE 缺失检测

GraphQL 认证：
□ mutation 通过 GET 请求绕过认证（CSRF）
□ 批查询认证绕过
```

### Phase 3: 授权测试（BOLA/IDOR/BFLA）

```text
BOLA（对象级授权绕过）：
□ 遍历数字 ID: /user/1 → /user/2 → /user/3
□ 遍历 UUID
□ 遍历用户名/邮箱
□ Burp Autorize: 双会话重放对比

BFLA（功能级授权绕过）：
□ 普通用户执行管理员 API
□ HTTP 方法切换: GET → PUT → PATCH → DELETE
□ API 版本降级: /v2/admin → /v1/admin
□ 批量操作注入: {"users": [1,2,3]} → {"users": [1,2,3,admin_id]}

工具: Burp Autorize, AuthMatrix, Entropy (malicious_insider persona)
```

### Phase 4: GraphQL 专项

```text
内省泄漏 → 信息暴露检测
别名过载 → 100+ 别名 DoS
批查询 → 10+ 同时查询 DoS
字段重复 → __typename × 500
指令过载 → 递归 @skip/@include
循环查询 → 深度嵌套内省递归
字段建议 → 错误消息信息泄漏
GraphiQL/Playground 暴露 → IDE 公开风险
GET 突变 → CSRF 风险
追踪/调试模式 → 元数据泄漏

工具: FireTail, Escape DAST, api.sh (Phases 1-3)
```

### Phase 5: REST 输入验证

```text
□ HTTP 方法切换: GET→POST→PUT→DELETE→OPTIONS→PATCH
□ Content-Type 篡改: JSON→XML→multipart
□ NoSQL 注入: {"username": {"$gt": ""}}
□ SSRF via URL 参数: webhook URL/头像 URL/导入 URL
□ XXE in XML 端点
□ 参数污染: /api?role=user&role=admin
□ 批量赋值: 向请求体添加 is_admin: true
```

### Phase 6: 业务逻辑与差分测试

```text
□ Entropy compare: diff v1 vs v2 API → 状态码变化/字段删除/延迟回归
□ 多角色工作流测试: admin/user/readonly 权限矩阵
□ 优惠券/积分/价格操控
□ 竞态条件: 并发请求测试 TOCTOU
```

### Phase 7: WebSocket 测试

```text
□ 端点发现
□ 消息注入（注入 payload、原型污染）
□ 超大消息处理
□ 类型混淆
□ 跨站点 WebSocket 劫持（CSWH）
```

### Phase 8: 限速与 DoS

```text
□ 限速绕过 via 头部: X-Forwarded-For, X-Real-IP
□ 路径变体: /api/ → /api → /Api/ → /API/
□ Slowloris 低带宽耗尽
□ GraphQL 批查询深度嵌套 DoS
□ IP 轮换测试（ProxyCat 代理池）
```

### Phase 9: 数据暴露

```text
□ 响应过度暴露: 对比 API 返回 vs UI 展示
□ 分页枚举: ?page=1&limit=10000
□ 错误消息信息泄漏: 堆栈跟踪/内部路径/SQL 错误
□ GraphQL 嵌套遍历访问越权数据
□ OpenAPI 规范暴露敏感端点
```

### Phase 10: CI/CD 集成

```text
□ Entropy --ci --watch: spec 变更时自动重跑
□ Escape DAST: 按严重度阈值自动阻断构建
□ 发现持久化为回归测试
□ StackHawk（开发者优先、ZAP 内核）
```

## 工具链

| 工具 | 用途 | 获取 |
|------|------|------|
| Vespasian | 流量 → OpenAPI/GraphQL 规范 | GitHub: praetorian-inc/vespasian |
| Entropy | LLM 生成攻击场景，5 personas | GitHub: arjinexe/entropy-chaos |
| Escape DAST | 业务逻辑安全测试 | escape.tech |
| api.sh | 8 阶段全协议攻击管道 | GitHub: Sharon-Needles/api |
| FireTail | GraphQL 12 专项测试 | firetail.ai |
| jwt_tool | JWT 全面测试 | GitHub: ticarpi/jwt_tool |
| Burp Autorize | 双会话授权对比 | Burp BApp Store |

## 参考

- `references/rest-graphql-testing.md` — REST + GraphQL 深度测试
- `references/jwt-oauth-testing.md` — JWT + OAuth 安全测试

## 任务完成自检（声称完成前 MUST 通过）

- [ ] 我是否执行了工作流中的每一步（而不是只阅读）？
- [ ] 我是否基于 工具索引（本机无，以技能内「本机工具实况」为准） 使用了真实工具路径？
- [ ] 我是否产出了可复现证据（命令/脚本/截图/报告）？
- [ ] 我是否完成并回写了 RULES 要求的 Checklist 项？

## 本机工具实况（导入时快照；当前真值用 `npm run toolkit:check` 或 `node scripts/sync-tool-status.mjs` 复核——表会过期，命令不会）

| 工具 | 状态 |
| --- | --- |
| `api` | ❌ 未装（用前先装，或改用等价工具） |
| `burp` | ❌ 未装（用前先装，或改用等价工具） |

---

## JWT / OAuth 测试（上游深度参考）

###### JWT + OAuth 2.0 安全测试

###### JWT 攻击面

###### 1. 算法混淆

```bash
###### alg:none — 最经典
###### 原始: {"alg":"RS256","typ":"JWT"}.payload.signature
###### 攻击: {"alg":"none","typ":"JWT"}.payload.  (空签名)

###### RS256 → HS256 密钥混淆
###### 如果服务端用 RS256 公钥做 HS256 验证
###### 可以把公钥当 HMAC 密钥来签名
python3 jwt_tool.py <JWT> -X k -pk public.pem

###### kid 注入
###### {"alg":"HS256","kid":"../../../../etc/passwd"}
###### 服务端用 kid 指向的文件内容做 HMAC 密钥
```

###### 2. jwt_tool 完整用法

```bash
###### 全面扫描
python3 jwt_tool.py <JWT> -t <URL> -cv "Authorization: Bearer <JWT>"

###### 弱密钥爆破
python3 jwt_tool.py <JWT> -C -d /usr/share/wordlists/rockyou.txt

###### 声明篡改
python3 jwt_tool.py <JWT> -I -pc role -pv admin
python3 jwt_tool.py <JWT> -I -pc exp -pv 9999999999

###### RSA 密钥混淆
python3 jwt_tool.py <JWT> -X k -pk public.pem

###### 嵌入 JWK
python3 jwt_tool.py <JWT> -X i
```

###### 3. 手工 JWT 篡改

```python
import jwt
import base64

###### 解码（不验证）
header, payload, sig = jwt.split('.')

###### 篡改 payload
payload['role'] = 'admin'
payload['exp'] = 9999999999

###### alg:none
new_token = base64url_encode(header) + '.' + base64url_encode(payload) + '.'

###### HS256 with known key
new_token = jwt.encode(payload, 'secret', algorithm='HS256')
```

###### OAuth 2.0 攻击面

###### Authorization Code Grant

```text
1. redirect_uri 操控
   正常: https://app.com/callback?code=AUTH_CODE
   攻击: https://app.com/callback@evil.com?code=AUTH_CODE
         https://evil.com/?redirect=https://app.com/callback?code=AUTH_CODE
         开放重定向 + redirect_uri: https://app.com/callback?redirect=https://evil.com

2. CSRF via state 缺失
   无 state 参数 → 攻击者用自己的 code 绑定受害者 session

3. PKCE 缺失
   无 code_challenge → 授权码拦截攻击

4. Token 在 Referer 泄漏
   回调页面加载外部资源 → Referer 头包含 code/token
```

###### Implicit Grant（已废弃但仍有部署）

```text
1. access_token 在 URL fragment → Referer 泄漏
2. token 在浏览器历史 → 物理访问风险
3. 无客户端认证 → token 替换攻击
```

###### Client Credentials Grant

```text
1. client_secret 泄漏（前端/移动端硬编码）
2. 过度 scope 授予
3. 无 client 限速 → 暴力枚举
```

###### 通用 OAuth 测试

```text
□ 测试 scope 提升: scope=read → scope=read%20write
□ Token 重放: 用旧的 access_token 访问新资源
□ Refresh token 滥用: refresh_token 无限续期
□ 跨租户访问: tenant A 的 token 访问 tenant B
□ Token 在日志/URL/Referer 中泄漏
```

###### 工具

```bash
###### JWT 测试
pip install jwt-tool pyjwt

###### OAuth 测试
###### Burp Suite + OAuth Scanner 扩展
###### Postman OAuth 2.0 流程测试

###### 自动化
###### Entropy: 自动 JWT 篡改 + OAuth redirect_uri 测试
```

Source: OWASP API Top 10 (API2: Broken Authentication), jwt_tool, PortSwigger OAuth research



<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`pip`
- `pip`：用 `python -m pip` 代替裸 `pip`

命令含 Linux 专属形态（`sudo` / `apt` / `/usr/share` 等）：本机是 Windows，**去掉 sudo**、把绝对路径换成工具目录（`$DSH_HOME/redteam/toolkit/<name>/`），`.exe` 后缀别漏。

runnability:end -->

<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **同类替代**（链路里的互补技能，手法最接近）：`code-audit`、`database-security`

2. **前提没满足就先回去**：`graphql-testing`、`web-fingerprint`、`race-conditions` —— 上一环没做实，本环再试也是空打

3. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

4. **目标比预期更深**：换到同主题的专项靶子面 `competition-jwt-claim-confusion`、`competition-graphql-rpc-drift`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现｜**角色**：`vuln-scan`
- **上游**（先做完这些再进来）：`graphql-testing`、`web-fingerprint`
- **下游**（产出交给谁）：`code-audit`、`injection-payloads`
- **专项下游**（同主题更深的靶子面）：`competition-jwt-claim-confusion`、`competition-graphql-rpc-drift`
- **互补**（同类场景一起用）：`code-audit`、`database-security`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->
