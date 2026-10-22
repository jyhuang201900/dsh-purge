---
name: asset-correlation
description: 资产关联：域名↔IP↔C 段↔证书↔主体的图谱化，产出"先打谁"
whenToUse: 信息收集阶段性收口，需要形成资产关系视图并排序时
role: assess
enabled: true
---

# 资产关联与易打性排序（图谱化）

## 边类型（与 `redteam_asset_link` 的 `relation` 取值一致）

| relation | 方向 | 怎么发现 |
| --- | --- | --- |
| `resolves` | domain → asset(IP) | `dig +short A <domain>`、`dnsx -a -resp` |
| `contains` | segment(/24) → asset(IP) | 按 /24 自动归段（`redteam_asset_add` 已处理） |
| `exposes` | asset → port/service | `naabu` / `nmap` / `pd-httpx` 的输出 |
| `shares_cert` | asset ↔ asset | 证书 SAN / subject 相同：`echo | openssl s_client -connect IP:443 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName` |
| `trusts` | asset → asset | 反代 / 同源策略 / SSO 回调白名单 / CORS `Access-Control-Allow-Origin` 里点名的域 |

## 关联动作

```bash
# ① 证书 SAN 聚簇：同一张证书覆盖多少站点 = 同一套后端
for ip in $(cat runs/ips.txt); do
  echo -n "$ip  "; echo | timeout 5 openssl s_client -connect $ip:443 2>/dev/null \
    | openssl x509 -noout -subject -enddate -ext subjectAltName 2>/dev/null | tr '\n' ' '; echo
done | tee runs/certs.txt

# ② 同主体 / 同注册人（备案与 whois keyword，见 passive-recon）
#    拿到"单位名称"后回 fofa-recon 反查同主体全部资产

# ③ 反查同 IP 的其它域名（虚拟主机上常挂着测试站）
curl -s "https://api.hackertarget.com/reversedns/?q=<IP>"

# ④ CORS / 回调白名单里的内部域名（最容易漏的资产）
curl -sk https://TARGET/login -D- -o /dev/null | grep -i 'access-control-allow-origin'
grep -oE 'https?://[a-z0-9.-]+\.(example\.com|内网域)' runs/*.js | sort -u
```

## 易打性排序（这一步的产出是"先打谁"，不是"又扫了一遍"）

优先级从高到低：

1. **边缘与测试环境**：`test` / `dev` / `uat` / `pre` / `staging` / `old` / `legacy` 前缀或标题里带这些词的——补丁通常落后半年。
2. **非标准端口上的 Web**：8080 / 8443 / 9000 / 3000 / 7001 / 8888 / 管理台端口——扫描器少、监控少。
3. **未备案但同主体 / 同 C 段**：不在主 CDN 后面，常是裸源站。
4. **能定出确切版本的老栈**：CVE 直接可查，Nday 优先。
5. **面板类**：Jenkins / GitLab / Tomcat 管理台 / phpmyadmin / Druid / Hadoop YARN——未授权与弱口令高发。
6. 主站生产环境：最后打，WAF 和监控最全。

每条资产落库时写 `priority`（high/medium/low）、`potential`（能拿到什么）、`reason`（**为什么排这个序**，要能复现判断依据）。

## 失败分支

- **泛解析导致"所有子域都活着"** → 只保留证书 / 历史解析里出现过的子域进图，其余标 `wildcard=true` 不建 `resolves` 边。
- **CDN 让整段 IP 归属失真** → 先摘出 CDN IP 段（`fofa` 查 `cert=` / 归属 AS13335 等），CDN 后的资产不按 /24 建 `contains`，改用 `shares_cert` / `trusts` 关联。
- **关系边写不进去（重复）** → `redteam_asset_link` 对 `(src_kind, src_id, dst_kind, dst_id, relation)` 幂等，重复写不报错；确认是 id 传错而不是网络错。

## 落库要求

- 全部走 `redteam_asset_add` / `redteam_asset_link`，**不直接写 SQL**。
- `provenance` 按来源分：被动来源 `passive`，主动探测 `active`。
- 每条边带 `confidence`（0–1）：证书 SAN 精确匹配 0.95，同 IP 反代线索 0.6，仅同 C 段 0.4。
- `redteam_chain_add`：`stage_code=assess`，`result` 写"共 N 条资产、M 条边，其中 K 条排到 high，先打 <点名>"。
- 给指挥者的结论必须**点名具体目标**，不要停在"发现了一些边缘资产"。
