---
name: passive-recon
description: 被动信息收集：不接触目标主机，仅使用公开数据源
whenToUse: 需要在不暴露自身的情况下收集目标资产情报时
role: recon
enabled: true
---

# 被动信息收集（不接触目标）

## 铁律

**一个包都不发给目标。** 只查第三方。目标是 `example.com` 时，不要 `curl example.com`、不要 dig 它的 NS 去碰权威、不要扫端口——那已经是 `active-scan` 的活。

## 数据源与命令

```bash
D=example.com

# ① 证书透明（最全的被动子域来源）
curl -s "https://crt.sh/?q=%25.$D&output=json" \
  | jq -r '.[].name_value' | tr 'A-Z' 'a-z' | sed 's/^\*\.\//' | sort -u > runs/crtsh-$D.txt
# 备用源
curl -s "https://api.certspotter.com/v1/issuances?domain=$D&include_subdomains=true&expand=dns_names" \
  | jq -r '.[].dns_names[]' | sort -u > runs/certspotter-$D.txt

# ② DNS（走公共解析器，不碰权威）
for t in A AAAA CNAME MX TXT NS SOA; do echo "== $t"; dig +short $t $D @1.1.1.1; done
# SPF / DMARC 里常漏内部域名与发信域
dig +short TXT _spf.$D @1.1.1.1; dig +short TXT _dmarc.$D @1.1.1.1

# ③ whois：注册人、网段、ASN、DNS 服务器
whois $D | grep -Ei 'org|registrant|netname|orgname|asn|name server|creation date|expiry'
# 反查同注册人 / 同邮箱的其它域名（备案与同主体线索）
whois -h whois.apnic.net "keyword <注册人关键字>" | head -50

# ④ 历史解析与同 IP 站点
curl -s "https://api.hackertarget.com/reversedns/?q=<IP>"
curl -s "https://api.hackertarget.com/pastdns/?q=$D"
# SecurityTrails 有 key 时更全（技能 redteam-setup 里要 key）
curl -s -H "APIKEY: $ST_TOKEN" "https://api.securitytrails.com/v1/domain/$D/subdomains" | jq -r '.subdomains[]'

# ⑤ 代码托管与文档泄露（子域、内网地址、密钥）
# GitHub 代码搜索需要 token；网页搜索可先兜底
gh search code --owner=<org> --match file --filename .env 2>/dev/null \
  || echo "GitHub 代码搜索需 GITHUB_TOKEN，缺则说明降级"
# 搜索运算符（浏览器/搜索 API 均可）
#   site:github.com "$D" (apikey OR password OR jdbc OR "10.0.")
#   site:pastebin.com "$D"    site:trello.com "$D"    intitle:"index of" "$D"

# ⑥ 测绘平台（有 key 才用，见技能 fofa-recon 的限速规则）
#   FOFA / Shodan / Censys：查 domain、org、issuer、同 C 段

# ⑦ 备案与同主体（国内目标必查）
#   https://www.beianx.cn/search/<domain>    https://icp.bugcqueen.com/
#   拿"单位名称"再回 fofa-recon 反查同主体全部资产
```

## 与其它技能的分工

| 要什么 | 用哪个 |
| --- | --- |
| 有 key、要单位资产全景（含未备案、同主体） | **`fofa-recon`** |
| 域名 → 子域 → 解析 → 端口 → 存活（可发包） | `recon-pipeline` |
| 完全不接触目标，只要情报 | **本技能** |
| 已确认在授权范围内，要端口和服务 | `active-scan` |

## 失败分支

- **crt.sh 超时 / 502**（高峰期常见）→ 换 certspotter、`subfinder -silent`（只用被动源，不加 `-all`），或隔 30s 重试一次；不要循环打。
- **泛解析**（任意子域都有 A）→ 被动结果里的随机子域是噪声：用 `dnsx -wd` 过滤，或只保留出现在证书里的子域。
- **没有 API key** → 明确写"被动测绘降级"，改用 crt.sh + whois keyword + 备案反查 + 搜索引擎，成果照样能出，但覆盖会小。
- **搜索结果里出现内网地址**（10./172.16-31./192.168.）→ 这是**边界突破线索**，记进 `note` 并标 `potential=high`，别当噪声丢。

## 落库要求

- 每条发现调 `redteam_asset_add`，`provenance` 固定 `passive`，`tool` 写具体数据源（`crt.sh` / `certspotter` / `hackertarget` / `whois` / `securitytrails`）。
- 域名 → IP 用 `redteam_asset_link` 建 `resolves` 边；同证书 / 同主体建 `shares_cert` 边。
- `redteam_chain_add`：`stage_code=recon`，`tool` 写实际命令原文，`result` 写数量摘要（如 `crt.sh 拿到 63 个子域 → 去重后 41 → 其中 6 个带内网线索`）。
- 给指挥者的结论必须**给数字**，并单列"高优先级边缘资产"（test/dev/uat/pre/staging、老系统、非标准端口、非备案但同主体）。
