# 胖客户端检查清单：本地存储、IPC、更新、本地 API

> 被 `thick-client` 引用。胖客户端的安全模型是**"客户端可信"**——一旦你控制本机，
> 所有客户端侧校验都可绕过。检查的核心是找出**服务端还在信任客户端的哪些断言**。

## 一、先建资产清单（10 分钟内完成）

```powershell
# 1) 装在哪、签没签、版本、公司
Get-ChildItem 'C:\Program Files','C:\Program Files (x86)',$env:LOCALAPPDATA,$env:APPDATA -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'Acme|App|Client' } | Select-Object FullName

Get-ChildItem 'C:\Program Files\Acme' -Recurse -Filter *.exe |
  ForEach-Object {
    $s = Get-AuthenticodeSignature $_.FullName
    [pscustomobject]@{ Path=$_.FullName; Status=$s.Status; Signer=$s.SignerCertificate.Subject }
  } | Format-Table -AutoSize
```

```powershell
# 2) 版本与内嵌信息
(Get-Item 'C:\Program Files\Acme\acme.exe').VersionInfo | Format-List *
```

```powershell
# 3) 运行时在干什么（进程/连接/句柄）
Get-Process acme -ErrorAction SilentlyContinue | Select-Object Id,Path,StartTime
Get-NetTCPConnection -OwningProcess (Get-Process acme).Id -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,State
```

## 二、本地存储：六类位置与判据

| 位置 | 典型内容 | 危险信号 |
| --- | --- | --- |
| `%APPDATA%\<Vendor>\` | 配置、缓存、日志、令牌 | `token`/`password`/`secret` 明文；`.db`/`.sqlite` 无加密 |
| `%LOCALAPPDATA%\<Vendor>\` | Chromium 类客户端的 profile、缓存 | Electron 的 `Local Storage\leveldb` |
| `%PROGRAMDATA%\<Vendor>\` | 全用户共享配置、许可证 | **可写 → 提权/横向** |
| 安装目录 | 插件、DLL、模板 | 非管理员可写 → DLL 劫持 |
| 注册表 `HKCU\Software\<Vendor>` | 设置、会话、最近文件 | 明文密码、`Run` 自启 |
| 凭据存储 | Windows Credential Manager / DPAPI | 见 `dpapi-credential-chain` |

```powershell
# 一次性扫全部候选目录里的敏感文件
$roots = @("$env:APPDATA","$env:LOCALAPPDATA","$env:PROGRAMDATA")
$roots | ForEach-Object {
  Get-ChildItem $_ -Recurse -ErrorAction SilentlyContinue -Include *.json,*.xml,*.ini,*.conf,*.config,*.db,*.sqlite,*.sqlite3,*.log |
    Where-Object { $_.FullName -match 'Acme' } |
    Select-Object FullName, Length, LastWriteTime
} | Format-Table -AutoSize
```

```powershell
# 在配置里找明文凭据（模式匹配）
Get-ChildItem "$env:APPDATA\Acme" -Recurse -Include *.json,*.xml,*.ini,*.config -ErrorAction SilentlyContinue |
  Select-String -Pattern 'pass|pwd|secret|token|apikey|api_key|credential|bearer' -CaseSensitive:$false |
  Select-Object Path, LineNumber, Line | Format-Table -Wrap
```

```bash
# SQLite 库直接看表结构
sqlite3 "$APPDATA/Acme/acme.db" '.tables'
sqlite3 "$APPDATA/Acme/acme.db" '.schema users'
sqlite3 "$APPDATA/Acme/acme.db" "select * from users limit 3;"
# 若加密（SQLCipher）→ 报 "file is not a database"
```

**LevelDB（Electron/Chromium）**：

```bash
# Local Storage 里的键值
python3 - <<'PY'
import plyvel  # pip install plyvel (需 leveldb)
db = plyvel.DB(r'%LOCALAPPDATA%\Acme\User Data\Default\Local Storage\leveldb', create_if_missing=False)
for k, v in db:
    print(k[:80], b'->', v[:200])
PY

# 不装库的话用 strings 也能捞到不少
strings "$LOCALAPPDATA/Acme/User Data/Default/Local Storage/leveldb/"*.ldb | grep -iE 'token|session|user' | head -30
```

### 2.1 凭据的真实位置（务必按顺序找）

```
1. 配置文件明文                → 直接读
2. 配置文件加密但密钥在同目录  → 找 key/secret 文件，或反编译看解密逻辑
3. DPAPI 保护（CurrentUser）    → 同用户下可直接 CryptUnprotectData
4. DPAPI 保护（LocalMachine）   → 需管理员/SYSTEM
5. Windows Credential Manager   → cmdkey /list + mimikatz vault
6. 内存里                       → 见 §5
```

```powershell
# 3) DPAPI CurrentUser：同用户可直接解
Add-Type -AssemblyName System.Security
$blob = [Convert]::FromBase64String((Get-Content "$env:APPDATA\Acme\cred.b64" -Raw).Trim())
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($blob, $null, 'CurrentUser')
[Text.Encoding]::UTF8.GetString($plain)
```

```cmd
:: 5) Credential Manager 列表
cmdkey /list
```

## 三、IPC：命名管道、本地 socket、COM

```powershell
# 列出该进程打开的命名管道（需要 Sysinternals handle64 或 PowerShell 替代）
handle64.exe -p (Get-Process acme).Id -a | Select-String 'Pipe'
```

```bash
# 更直接：枚举系统所有命名管道，找与该产品相关的
pip install pywin32  # 或用 PowerShell
```

```powershell
# 枚举命名管道（PowerShell，无外部依赖）
Get-ChildItem \\.\pipe\ | Where-Object { $_.Name -match 'acme|agent|svc' } | Select-Object Name
```

```powershell
# 看管道的 ACL（谁能连、谁能写）
# 用 PipeSec 或直接看进程的 DACL
$p = Get-Process acme
(Get-Acl "\\.\pipe\acme_agent").Access | Format-Table IdentityReference, FileSystemRights, AccessControlType
```

| IPC 类型 | 怎么找 | 攻击面 |
| --- | --- | --- |
| 命名管道 | `\\.\pipe\<name>`；`handle64` | 管道 ACL 过宽 → 低权进程可发指令给高权服务 |
| 本地 socket | `netstat -ano` 里的 `127.0.0.1:<port>` | 无认证的本地 HTTP API（见 §4） |
| COM 对象 | `reg query HKCR\CLSID`；OLEView | 本地服务 COM 的 `LaunchPermission` 过宽 → 提权 |
| 共享内存 | `Global\` / `Local\` 映射 | 敏感数据留驻 |
| WCF/自建 RPC | 端口 + 二进制协议 | 见 `custom-protocol-replay` |

```bash
# 手工测命名管道：看是否接受未认证写入（授权范围内）
python3 - <<'PY'
import win32file, win32pipe
p = r'\\.\pipe\acme_agent'
try:
    h = win32file.CreateFile(p, win32file.GENERIC_READ|win32file.GENERIC_WRITE,
                             0, None, win32file.OPEN_EXISTING, 0, None)
    win32file.WriteFile(h, b'{"cmd":"status"}\r\n')
    print(win32file.ReadFile(h, 4096)[1])
except Exception as e:
    print('ERR', e)
PY
```

**判据**：低权用户（非管理员）能连上并拿到响应 = 管道 ACL 过宽。这是本地提权的常见入口。

## 四、本地 API 暴露（localhost 端口）

这是胖客户端最高价值的检查项：Electron/Tauri/自建 agent 常起一个本地 HTTP 服务，
**无认证**且**不校验 Origin**。

```powershell
# 找所有 listening 的本地端口 + 归属进程
Get-NetTCPConnection -State Listen |
  Where-Object { $_.LocalAddress -in '127.0.0.1','0.0.0.0','::','::1' } |
  Select-Object LocalAddress,LocalPort,OwningProcess,
    @{n='Proc';e={(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName}} |
  Sort-Object LocalPort | Format-Table -AutoSize
```

```bash
# 从外部视角扫本机高位端口（授权范围内）
nmap -Pn -p 3000-3010,5000-5010,8000-8010,9000-9010,27000-27010 127.0.0.1
```

```bash
# 逐个探：是否要认证、是否有 CORS 通配、是否有危险端点
for port in 37200 37201 8080; do
  echo "=== $port"
  curl -s -i "http://127.0.0.1:$port/" | head -12
  curl -s -i -X OPTIONS "http://127.0.0.1:$port/api" \
    -H 'Origin: https://evil.com' -H 'Access-Control-Request-Method: POST' | grep -i 'access-control'
done
```

**四个必测点**：

| 测试 | 命令 | 命中含义 |
| --- | --- | --- |
| 无认证读 | `curl http://127.0.0.1:PORT/api/config` | 任意本地进程可读配置/令牌 |
| CORS 通配 | `-H 'Origin: https://evil.com'` 看 `Access-Control-Allow-Origin` | **任意网页可打本地 API**（配合 DNS rebinding 更强） |
| Host 头不校验 | `curl -H 'Host: evil.com' http://127.0.0.1:PORT/` | DNS rebinding 可行 |
| 危险端点 | `/exec`、`/shell`、`/open?path=`、`/file?path=` | 直接 RCE / 任意文件读 |

```bash
# DNS rebinding 思路验证：把 Host 换成攻击者域，看是否仍响应
curl -s -i http://127.0.0.1:37200/api/status -H 'Host: attacker.example.com' | head -6
```

**这是浏览器扩展/恶意网页打本地客户端的标准路径**：网页 JS → `fetch('http://127.0.0.1:37200/api/...')`
→ 若 CORS 允许 `*` 或无 Origin 校验，就能读响应。

## 五、内存与进程

```powershell
# 进程的内存权限（是否可读）
# 用 procdump 抓全量 dump（需管理员）
procdump64.exe -ma (Get-Process acme).Id C:\tmp\acme.dmp
```

```bash
# 在 dump 里找凭据
strings -el acme.dmp | grep -iE 'password|token|Bearer|secret' | head -20
strings acme.dmp | grep -oE '[A-Za-z0-9_\-]{32,}' | sort -u | head -30
```

```bash
# Linux/macOS 等价：直接读 /proc/<pid>/maps 找可读段
# （Windows 上用 WinDbg / Volatility 分析 dump）
```

**注意**：内存里的凭据通常是**已解密**的，这是绕过配置文件加密的最快路径。

## 六、更新机制：签名校验是唯一实质防线

```powershell
# 1) 找更新端点（配置/日志/字符串）
Get-ChildItem "$env:APPDATA\Acme" -Recurse -Include *.log,*.json -ErrorAction SilentlyContinue |
  Select-String -Pattern 'update|version|download|http' | Select-Object -First 20
```

```bash
# 2) 从二进制里捞更新 URL
strings acme.exe | grep -oE 'https?://[a-zA-Z0-9./_\-]+' | sort -u | grep -iE 'update|download|cdn|release'
```

```powershell
# 3) 抓更新流量（授权范围内，指向自己的代理）
#    用 mitmproxy 或 Burp 作为系统代理，触发"检查更新"
```

**四个检查点**：

| 检查 | 方法 | 危险信号 |
| --- | --- | --- |
| 传输是否 HTTPS | 抓包 | 明文 HTTP → 可中间人 |
| **是否校验签名** | 替换更新包为自签/未签，看是否安装 | 安装了 → 无校验，可远程代码执行 |
| 是否校验版本回滚 | 提供旧版本包 | 接受降级 → 可打已知漏洞 |
| 更新服务器是否可劫持 | 看 URL 域名是否可注册/HTTP | — |

```bash
# 模拟更新服务器（授权范围内）：用 hosts 把更新域名指到本地
# 1) 起一个返回恶意包的 HTTP 服务
python3 -m http.server 8000 --directory ./fake-update
# 2) 把 update.acme.com 指到 127.0.0.1（改 hosts 或 DNS）
# 3) 触发"检查更新"，观察是否下载并执行

# 关键：如果客户端做了 Authenticode 校验，篡改的 exe 会被拒
# 这时要测：manifest 是否签名、签名是否对包内每个文件都校验（zip 里塞额外文件）
```

**验伤**：替换的更新包被安装且执行了你放进去的 payload（回连/写文件）。仅"下载成功"不算。

## 七、DLL 劫持与加载顺序

```powershell
# 1) 找缺失的 DLL（Procmon 最准；无 Procmon 时看导入表 + 目录权限）
#    Procmon 过滤：Process Name is acme.exe, Operation is Load Image, Result is NAME NOT FOUND
```

```bash
# 2) 看导入表（用 objdump / rabin2）
objdump -p acme.exe | grep 'DLL Name'
rabin2 -i acme.exe | head -40
```

```powershell
# 3) 检查安装目录是否非管理员可写（可写 = 可放同名 DLL）
icacls 'C:\Program Files\Acme'
# 关注 (F) / (M) / (W) 出现在 BUILTIN\Users 或 Authenticated Users 上
```

```powershell
# 4) 检查 PATH 里的可写目录
$env:PATH -split ';' | ForEach-Object {
  if (Test-Path $_) {
    $acl = Get-Acl $_
    $w = $acl.Access | Where-Object { $_.IdentityReference -match 'Users|Everyone|Authenticated' -and $_.FileSystemRights -match 'Write|Modify|FullControl' }
    if ($w) { [pscustomobject]@{ Path=$_; Writables=($w.IdentityReference -join ',') } }
  }
} | Format-Table -AutoSize
```

**加载顺序三类**：

| 类型 | 触发条件 | 利用 |
| --- | --- | --- |
| 缺失 DLL | 导入表里有但文件不存在 | 在搜索路径放同名 DLL |
| 相对路径加载 | `LoadLibrary("plugin.dll")` 无绝对路径 | 在 CWD 放同名文件 |
| 侧加载 | manifest 声明 + 同目录 | 替换同目录的 DLL（需写权限） |

**这是本地提权的经典路径**：低权可写的目录 + 高权进程加载缺失 DLL → 高权执行。

## 八、客户端信任边界（最重要的一节）

胖客户端的漏洞几乎都来自"服务端信任了客户端的某个断言"：

| 客户端断言 | 服务端是否该信 | 测试方法 |
| --- | --- | --- |
| 价格/金额 | 否 | 改请求里的 `price`/`total`，看订单金额是否变 |
| 角色/权限 | 否 | 改请求里的 `role`，或直接调管理接口 |
| 步骤顺序（向导） | 否 | 跳过第 2 步直接发第 3 步请求 |
| 输入已校验 | 否 | 绕过前端直接发原始请求（Burp） |
| 设备可信 | 部分 | 改 device id / 证书 |
| 时间戳/签名 | 否 | 见 `js-reverse`（签名算法逆向） |
| 隐藏功能开关 | 否 | 改配置里的 `featureX: false → true`，看服务端是否响应功能 |

```bash
# 标准动作：全流量过代理，然后逐字段改
# 1) 设系统代理到 Burp（127.0.0.1:8080），装 CA 证书
# 2) 客户端若做证书固定（pinning），需要绕过：
#    - Electron: 改 asar 里的 pinning 逻辑
#    - .NET: 改 ServicePointManager.ServerCertificateValidationCallback
#    - 原生: Frida hook SSL_CTX_set_verify / CertVerifyCertificateChainPolicy
```

证书固定绕过后，重点看**请求里哪些字段是客户端算的**：

- 签名/HMAC → 逆向算法（`js-reverse` 或 `ida-reverse`）
- 时间戳 + nonce → 看是否有窗口校验
- 加密 body → 找密钥（配置文件/内存/反编译）

## 九、验伤：胖客户端的"成功"标准

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| 本地凭据泄露 | 明文密码/token 字符串 + 能用它登录 | 只看到加密 blob |
| 本地 API 无认证 | `curl` 返回**配置/令牌/业务数据** | 返回 404 但其实是路径错 |
| CORS 通配 | `Access-Control-Allow-Origin: *` + `Allow-Credentials: true` | 只有 `*` 无 credentials（影响小） |
| 命名管道过宽 | **非管理员**会话能连上并得到响应 | 管理员能连（那是正常） |
| 更新无签名校验 | 篡改包被安装并执行 payload | 包下载了但安装失败 |
| DLL 劫持 | 你的 DLL 被加载（回连/写文件证明） | 放了文件但进程没加载（搜索路径不对） |
| 客户端信任绕过 | 服务端接受了篡改后的值（订单金额/权限真的变了） | 客户端显示变了但服务端拒绝 |

## 十、检测视角

| 手法 | 日志 | 信号 |
| --- | --- | --- |
| 配置文件读取 | EDR 文件访问 | 非该进程的进程读取 `%APPDATA%\<Vendor>` |
| DPAPI 解密 | 4688 / EDR | 非预期进程调用 `CryptUnprotectData` |
| 本地 API 滥用 | 本地服务日志 | 请求 `Origin` 不是自家域；`Host` 头异常；来自浏览器进程 |
| 命名管道连接 | 安全日志 5145（若开） | 低权 SID 连接高权管道 |
| 更新包替换 | 更新服务日志 | 包 hash 与发布记录不符；签名状态 Invalid |
| DLL 侧加载 | 4688 + 图像加载（Sysmon 7） | 高权进程从非安装目录加载 DLL；签名 Unsigned |
| 客户端字段篡改 | 应用审计 | 请求里 `price`/`role` 与服务端记录不一致 |

## 十一、常见坑

1. **只找配置文件不找 DPAPI**——现代客户端基本都加密了。要先反编译看解密逻辑，或直接在同用户上下文里调 `Unprotect`。
2. **本地 API 只测 GET**——POST/PUT 才是改状态的路径；另外要测 `/exec` 类端点（Electron 的 `shell.openExternal` 常被包成 HTTP 接口）。
3. **CORS 测试忘了 `credentials`**——`Access-Control-Allow-Origin: *` 加 `Allow-Credentials: true` 是非法组合（浏览器会拒），真正危险的是**反射 Origin**（回显请求的 Origin）。
4. **命名管道用管理员测**——必须用**低权账号**测，否则"能连"毫无意义。
5. **DLL 劫持不验证加载**——放了 DLL 不代表被加载。要用 Procmon/Sysmon 图像加载事件确认，或让 DLL 里写一个标记文件。
6. **更新测试直接改生产**——一定先确认是测试环境，或用 hosts 重定向到自己的服务器。
7. **Electron 的 asar 忘了解包**——`npx asar extract app.asar out/`，源码全在里面（含 API key、pinning 逻辑）。