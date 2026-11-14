# 邮件认证检查清单：SPF / DKIM / DMARC 的判定与伪造成本

> 被 `email-security` 引用。核心问题只有一个：**拿到 `From: ceo@target.com` 需要多少成本**。
> SPF/DKIM/DMARC 三者各自回答不同的问题，缺一个就有一条路。

## 一、三个机制各管什么（先分清，否则判错）

| 机制 | 作用域 | 验证对象 | 保护的是 |
| --- | --- | --- | --- |
| **SPF** | `MAIL FROM`（信封发件人）/ HELO | 发信服务器 IP | 信封域，**不保护 `From:` 显示名** |
| **DKIM** | 邮件头 + 正文 | 签名域（`d=`） | 内容完整性 + 签名域 |
| **DMARC** | `From:` 头（显示域） | SPF/DKIM 的**对齐** | 显示域，决定"不通过怎么办" |

**最关键的一点**：SPF 校验的是信封域（`Return-Path`），而用户看到的是 `From:`。两者可以
完全不同——这就是"SPF 通过但 From 是伪造的"的经典场景。

## 二、SPF：读 record 的四件事

```bash
# 查 SPF（注意 SPF 记录在 TXT 里，不是 SPF 类型）
dig +short TXT example.com | grep -i 'v=spf1'
nslookup -type=TXT example.com 8.8.8.8 | grep -i spf1

# 多条 SPF 记录 = 配置错误（RFC 7208 规定只能有一条，多条的后果是 PermError）
dig +short TXT example.com | grep -c 'v=spf1'
```

### 2.1 逐项判读

```
v=spf1 ip4:203.0.113.0/24 include:_spf.google.com -all
      ↑ 授权的 IP 段          ↑ 引用的第三方      ↑ 限定符 + 机制
```

| 限定符 | 含义 | 伪造难度 |
| --- | --- | --- |
| `-all` | 未列出的全部失败（Fail） | 高 |
| `~all` | 软失败（SoftFail），通常仍投递但标记 | **中低**——很多收件方仍放行 |
| `?all` | 中性（Neutral），等于没策略 | 无 |
| `+all` | 全部通过 | **等于开放中继**，任何人可伪造 |

| 机制 | 含义 | 检查点 |
| --- | --- | --- |
| `ip4:` / `ip6:` | 直接授权网段 | 网段是否过大（`/8` 等于放行整个 A 类） |
| `include:` | 引入另一域的策略 | 递归深度（>10 会 PermError）；被引用的域是否可被接管 |
| `a` / `mx` | 授权 A/MX 记录 | 若 `a` 指向共享主机 → 其他租户也能发 |
| `ptr` | 反向 DNS | 已废弃，不可靠，常被滥用 |
| `exists:` | 任意 DNS 存在性 | 复杂，易出错 |
| `redirect=` | 完全替换 | 只应出现一次，且在最后 |

### 2.2 一眼判定"能不能伪造"

```bash
#!/usr/bin/env bash
# spf-judge.sh — 判断某域的 SPF 是否容易被伪造
D=$1
REC=$(dig +short TXT "$D" | tr -d '"' | grep '^v=spf1')
N=$(dig +short TXT "$D" | grep -c 'v=spf1')
echo "域: $D"
echo "记录数: $N   （>1 = PermError，SPF 直接失效）"
echo "记录: $REC"
case "$REC" in
  *"+all"*)  echo "判定: 全放行，任何人可伪造" ;;
  *"?all"*)  echo "判定: 中性，无实际保护" ;;
  *"~all"*)  echo "判定: SoftFail，多数收件方仍投递 → 可伪造（有标记）" ;;
  *"-all"*)  echo "判定: Fail，标准严格 → 需绕路（见 include 接管/子域）" ;;
  *"redirect"*) echo "判定: 重定向，需追目标域" ;;
  *)         echo "判定: 缺 all 限定符 → 默认 Neutral，等于无策略" ;;
esac
```

### 2.3 SPF 的五个绕过面

| 绕过 | 原理 | 怎么测 |
| --- | --- | --- |
| **缺 `all`** | 默认 Neutral，收件方按"无策略"处理 | 上面脚本会打出 |
| `~all` 软失败 | 大多数 MTA 仍投递，只加头部 | 实测投递 |
| **include 域被接管** | `include:_spf.vendor.com`，vendor 域过期可注册 | `dig` vendor 的 NS，看是否可注册 |
| **子域未设 SPF** | `mail.target.com` 无记录，DMARC 若为 `p=none` 则子域可伪造 | `dig TXT mail.target.com` |
| **共享发送 IP** | `include:` 指向共享 ESP，同 ESP 的其他客户可发 | 用同 ESP 账号发信（授权测试） |

```bash
# 检查子域是否有 SPF（子域伪造是最常见的实战路径）
for s in mail smtp eml email newsletter bounce info; do
  printf '%-12s ' "$s"
  dig +short TXT "$s.example.com" | grep -c 'v=spf1'
done
```

## 三、DKIM：selector 与密钥长度

### 3.1 找 selector

selector 写在邮件头的 `DKIM-Signature: ... s=selector; d=domain`。没有样本邮件时靠猜：

```bash
# 常见 selector 字典
for s in default google selector1 selector2 s1 s2 mail dkim k1 smtp 20230601 20240101; do
  printf '%-12s ' "$s"
  dig +short TXT "$s._domainkey.example.com" | head -1
done
```

```bash
# 从已收到的邮件里读（最快）
# 把 .eml 存下来
grep -i '^DKIM-Signature' mail.eml | tr ';' '\n' | grep -E 'd=|s=|a=|c='
```

### 3.2 判读公钥

```bash
dig +short TXT selector1._domainkey.example.com
# "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA..."
```

```bash
# 密钥长度（p= 的 base64 解码后看 DER 长度）
dig +short TXT selector1._domainkey.example.com | tr -d '"' | sed 's/.*p=//' | \
  base64 -d | openssl rsa -pubin -inform DER -noout -text 2>/dev/null | head -2
# 输出 "Public-Key: (1024 bit)" → 弱
```

| 项 | 安全值 | 风险值 |
| --- | --- | --- |
| 密钥长度 | RSA ≥ 2048 | **1024 bit**（可分解，历史上有多起被爆破） |
| `p=` 为空 | 无 | **空 p = 密钥被撤销**，等于不验签 |
| `k=` | `rsa` | `ed25519` 也行；其他少见 |
| `t=y` | — | **测试模式**，收件方可能不强制 |
| `h=` 覆盖范围 | 含 `From` 和 `Subject` | **只签 `From`** → Subject/正文可改（重放攻击） |

```bash
# 检查签名头的 h= 列表（覆盖了哪些头）
grep -i '^DKIM-Signature' mail.eml | tr ';' '\n' | grep -E '^\s*h=' | tr ':' '\n'
# 若只有 from → Subject 和 body 可被替换（把一封合法邮件改内容后重放）
```

### 3.3 DKIM 的四个绕过面

| 绕过 | 原理 | 测法 |
| --- | --- | --- |
| **`h=` 未覆盖关键头** | 只签 `From`，`Subject`/`To`/正文可改 | 改 Subject 后重发，签名仍通过 |
| **长度截断（`l=`）** | 只签正文前 N 字节，后面可追加 | 追加内容后签名仍通过 |
| **`p=` 为空** | 密钥撤销但域名仍被配置为"通过" | 检查公钥为空时收件方行为 |
| **重放** | 签名无时间绑定（无 `t=` 或窗口太宽） | 原样重发一封旧邮件 |

```bash
# 改 Subject 后重放（前提：h= 不含 subject）
python3 - <<'PY'
import email
from email import policy
m = email.message_from_binary_file(open('mail.eml','rb'), policy=policy.SMTP)
m.replace_header('Subject', 'URGENT: wire transfer required')
open('mail2.eml','wb').write(m.as_bytes())
PY
# 然后用 SMTP 重发，观察收件方是否加 DKIM pass
```

## 四、DMARC：策略与对齐

### 4.1 读记录

```bash
dig +short TXT _dmarc.example.com
# "v=DMARC1; p=reject; sp=quarantine; pct=100; rua=mailto:dmarc@example.com; adkim=s; aspf=r"
```

| tag | 值 | 判读 |
| --- | --- | --- |
| `p=` | `none` / `quarantine` / `reject` | **`none` = 只报告，不拦截** → 伪造可投递 |
| `sp=` | 同上 | 子域策略；**缺失则继承 `p`** |
| `pct=` | 0-100 | **< 100 = 只对部分邮件生效**，其余走 `p=none` 行为 |
| `adkim=` | `r`（relaxed）/ `s`（strict） | DKIM 对齐严格度 |
| `aspf=` | `r` / `s` | SPF 对齐严格度 |
| `rua=` | 报告地址 | 可被滥用（报告泄露内部信息） |
| `fo=` | 0/1/d/s | 失败报告粒度 |

**对齐（alignment）是 DMARC 的核心**：

| 模式 | 规则 | 绕过 |
| --- | --- | --- |
| `adkim=r`（默认） | 签名域与 `From:` **组织域**相同即可 | `From: x@a.example.com`，签名 `d=example.com` → 对齐通过 |
| `adkim=s` | 必须**完全相等** | 严格，难绕 |
| `aspf=r` | 信封域与 `From:` 组织域相同 | 用 `bounce.example.com` 做信封，`From: x@example.com` → 通过 |
| `aspf=s` | 必须完全相等 | 严格 |

### 4.2 一眼判定"伪造是否会被拦"

```bash
#!/usr/bin/env bash
# dmarc-judge.sh
D=$1
R=$(dig +short TXT "_dmarc.$D" | tr -d '"')
[ -z "$R" ] && { echo "$D: 无 DMARC → 可伪造，收件方按启发式处理"; exit; }
echo "记录: $R"
P=$(echo "$R" | grep -oE 'p=[a-z]+' | head -1 | cut -d= -f2)
SP=$(echo "$R" | grep -oE 'sp=[a-z]+' | cut -d= -f2)
PCT=$(echo "$R" | grep -oE 'pct=[0-9]+' | cut -d= -f2)
ADKIM=$(echo "$R" | grep -oE 'adkim=[rs]' | cut -d= -f2)
ASPF=$(echo "$R" | grep -oE 'aspf=[rs]' | cut -d= -f2)
echo "p=$P sp=${SP:-继承} pct=${PCT:-100} adkim=${ADKIM:-r} aspf=${ASPF:-r}"
[ "$P" = "none" ] && echo "→ 主域: 不拦截, 可伪造 (仅进报告)"
[ -n "$PCT" ] && [ "$PCT" -lt 100 ] && echo "→ 仅 $PCT% 生效, 其余邮件可伪造"
[ -z "$SP" ] && echo "→ 子域继承 p=$P; 若子域无 SPF/DKIM 记录则对齐失败但按 p 处理"
```

### 4.3 五个绕过面

| 绕过 | 前提 | 做法 |
| --- | --- | --- |
| **`p=none`** | 只监控 | 直接伪造 `From:`，DMARC 会给收件方 pass/fail 报告但不拦 |
| **`pct<100`** | 灰度上线期常见 | 多试几次，统计投递率 |
| **子域无记录** | `sp` 未设且子域未单独配 | `From: ceo@mail.target.com` |
| **对齐窗口** | `adkim=r` | 用 `target.com` 的兄弟子域签名（`d=mail.target.com` 对 `From: x@target.com` **不对齐**，但反过来可以） |
| **显示名伪造** | 无需任何技术绕过 | `From: "ceo@target.com" <attacker@gmail.com>` —— 很多客户端只显示显示名 |

**显示名伪造是最省事的路径**，不需要碰 SPF/DKIM/DMARC：

```
From: "CEO Zhang <ceo@target.com>" <attacker@evil.com>
```

在手机邮件客户端里，收件人只看到 "CEO Zhang"。这是真实钓鱼的第一选择，成本为零。

### 4.4 组合判定表

| SPF | DKIM | DMARC | 伪造成本 | 结论 |
| --- | --- | --- | --- | --- |
| `-all` | 2048 RSA | `p=reject; pct=100; adkim=s; aspf=s` | 很高 | 需找子域/显示名/客户端漏洞 |
| `-all` | 2048 | `p=reject; pct=100; adkim=r` | 中 | 用兄弟子域的合法 DKIM 签名 |
| `~all` | 有 | `p=quarantine` | 中低 | 直接伪造，进垃圾箱但有概率投递 |
| `~all` | 有 | `p=none` | 低 | 直接伪造，正常投递 |
| 无 | 无 | 无 | 零 | 随便伪造 |
| `+all` | — | — | **零** | 等于开放中继 |

## 五、验伤：怎么判定"这封是伪造的"

拿到一封可疑邮件后，**从上往下读头部**，这是最硬的证据链：

```bash
# 1) 完整头部（含所有 Received）
head -60 mail.eml

# 2) 关键字段
grep -iE '^(From|Return-Path|Reply-To|Authentication-Results|Received-SPF|DKIM-Signature|ARC)' mail.eml
```

### 5.1 判定流程

```
[1] Return-Path 与 From 的域是否一致？
    不一致 → 信封域与显示域分离，可能是合法的（ESP 代发）也可能是伪造
[2] Authentication-Results 头（由收件方 MTA 加，最可信）
    spf=pass/fail  dkim=pass/fail  dmarc=pass/fail
[3] DMARC 结果的 aligned 域是谁？
    dmarc=pass header.from=target.com → 真的
    dmarc=fail header.from=target.com → 伪造（或被转发破坏）
[4] Received 链从下往上，看第一跳 IP
    与 SPF 授权段对比
[5] DKIM-Signature 的 d= 与 From 的域
    对齐（relaxed 看组织域）
```

```bash
# 一条命令汇总（用 swaks 或 python 解析）
python3 - <<'PY'
import email, re
from email import policy
m = email.message_from_binary_file(open('mail.eml','rb'), policy=policy.default)
print('From       :', m['From'])
print('Return-Path:', m['Return-Path'])
print('Reply-To   :', m['Reply-To'])
print('Auth-Res   :', m.get('Authentication-Results'))
print('Recv-SPF   :', m.get('Received-SPF'))
d = m.get_all('DKIM-Signature') or []
for i, s in enumerate(d):
    print(f'DKIM[{i}] d=', re.search(r'\bd=([^;\s]+)', s).group(1) if re.search(r'\bd=([^;\s]+)', s) else '?')
    print(f'         s=', re.search(r'\bs=([^;\s]+)', s).group(1) if re.search(r'\bs=([^;\s]+)', s) else '?')
print('--- Received (bottom-up) ---')
for r in reversed(m.get_all('Received') or []):
    print(r.strip()[:160])
PY
```

### 5.2 三种结局

| 现象 | 结论 | 证据强度 |
| --- | --- | --- |
| `dmarc=pass header.from=victim.com` 但 `Return-Path` 是别的域 | **不是伪造**，是 ESP 代发（对齐通过） | 需要看 `aspf=r` |
| `spf=pass` 但 `From:` 是 victim.com 且 SPF 域是 attacker.com | SPF 通过但**未对齐** → `dmarc=fail` → 是伪造 | 强 |
| 无 `Authentication-Results` 头 | 邮件在传输中丢失了认证结果，或被中间人剥离 | 弱，需看 Received 链 |
| `dkim=pass` 但 `d=` 与 `From:` 不对齐 | 用了别人的合法签名（可能转发） | 中 |

**反例（看起来像伪造其实不是）**：

- 邮件列表转发：转发了原邮件，SPF 会 fail（发信 IP 是列表服务器），但 DKIM 通常保留 → `dmarc=pass`
- `From: "ceo@target.com" <ceo@target.com>` 且 `dmarc=pass` → 是真的（或内部账号被控）
- 邮件客户端显示 "via" 标记 → 说明 `From:` 域与签名域不一致，客户端已提示

## 六、检测视角

| 手法 | 日志/信号 | 具体特征 |
| --- | --- | --- |
| SPF fail | MTA 日志 / DMARC 报告 | `spf=fail` 且 IP 不在授权段；同 IP 高频失败 |
| DKIM fail | 同上 | `dkim=fail`（签名被改）或 `dkim=none`（无签名） |
| DMARC fail | 聚合报告（rua） | `disposition=quarantine/reject`；`header.from` 是自家域但 `source_ip` 是外部 |
| 子域伪造 | DMARC 报告 | `header.from=mail.target.com` 但该子域无 SPF/DKIM 记录 |
| 显示名伪造 | 无技术信号 | **只能在用户举报/内容分析里发现**，认证全 pass |
| 相似域 | DMARC 报告 + 域名监控 | `target-corp.com`、`target.co` 等注册变体 |
| 内部账号被控 | 邮件网关 | 内部 IP 发信但 `From:` 是高管；异常时间/地理位置 |

**必须配的两件事**：

1. `rua=` 报告接收 + 解析（否则 DMARC 等于没部署，你不知道谁在伪造你）
2. **相似域名注册监控**（`dnstwist`）——显示名伪造 + 相似域是绕过所有认证的唯一路径

```bash
# 相似域枚举
dnstwist --registered example.com -f csv | head -30
```

## 七、常见坑

1. **把 SPF 当保护 `From:`**——SPF 只看信封域。`Return-Path: bounce@esp.com` + `From: ceo@target.com` 时 SPF 可能 pass 但 DMARC fail。
2. **DMARC 记录查错位置**——是 `_dmarc.example.com`（带下划线），不是 `example.com`。
3. **`p=none` 就判定"完全没防护"**——它对**收件方**是只报告，但很多大厂（Gmail/Outlook）会用自己的启发式额外拦。仍要实测投递率。
4. **`pct=100` 缺失就当 100**——是的，缺省是 100。但很多组织在灰度期写 `pct=10`，这时 90% 的伪造邮件仍会投递。
5. **DKIM 密钥长度判断错**——`p=` 的 base64 直接看长度不准，要 base64 解码后看 DER 里的模长。1024 bit 的 DER 约 162 字节。
6. **selector 猜不到就放弃**——从**已收到的邮件**里读 `s=` 是最快的；另外 `_domainkey` 的 TXT 可能有多个 selector，用 `dig ANY` 或子域枚举。
7. **忘了检查子域**——大组织常有几十个子域，`sp=` 未设时子域继承 `p`，但子域若没有 SPF/DKIM 记录，对齐会失败 → 按 `p` 处理。但若子域被第三方托管且配了宽松记录，就成了缺口。
8. **显示名伪造完全不需要技术绕过**——报告里要单列这一类，别把它混进 SPF/DKIM 讨论。