# 浏览器扩展分析：从 crx 到源码，权限到能力的映射

> 被 `browser-extension-reverse` 引用。扩展的分析重点是**权限 = 能力边界**：
> `<all_urls>` 加上 `tabs` 就等于全站读写 + 全量浏览历史。先看 manifest，再看通信。

## 一、从 crx 到源码（三步）

### 1.1 拿到扩展包

```bash
# Chrome Web Store 的下载 URL（扩展 ID 就是 32 位小写字母）
ID=abcdefghijklmnopqrstuvwxyzabcdef
curl -L -o ext.crx \
  "https://clients2.google.com/service/update2/crx?response=redirect&prodversion=120.0&acceptformat=crx2,crx3&x=id%3D$ID%26uc"

# 本机已安装的扩展（未打包的开发者模式）
ls "$LOCALAPPDATA/Google/Chrome/User Data/Default/Extensions/$ID/"
# Edge 同理：$LOCALAPPDATA/Microsoft/Edge/User Data/Default/Extensions/
```

### 1.2 解包

```bash
# crx 是 "Cr24" 头 + 长度 + zip，去掉头就是 zip
python3 - <<'PY'
import struct, sys
d = open('ext.crx','rb').read()
assert d[:4] == b'Cr24', 'not a crx'
ver = struct.unpack('<I', d[4:8])[0]
if ver == 3:
    off = 12 + struct.unpack('<I', d[8:12])[0]   # header length
elif ver == 2:
    pk, sig = struct.unpack('<II', d[8:16])
    off = 16 + pk + sig
else:
    raise SystemExit('unknown version %d' % ver)
open('ext.zip','wb').write(d[off:])
print('version', ver, 'offset', off)
PY
unzip -o ext.zip -d ext/
ls ext/
```

```bash
# 已安装目录直接可用（无 crx 头）
cp -r "$LOCALAPPDATA/Google/Chrome/User Data/Default/Extensions/$ID/1.2.3_0" ext/
```

### 1.3 先看 manifest

```bash
cat ext/manifest.json | python3 -m json.tool
```

```bash
# 一次性提取关键字段
python3 - <<'PY'
import json
m = json.load(open('ext/manifest.json'))
for k in ('name','version','manifest_version','permissions','host_permissions',
          'optional_permissions','background','content_scripts','externally_connectable',
          'web_accessible_resources','update_url','key','content_security_policy'):
    if k in m:
        print(f'{k}: {json.dumps(m[k], ensure_ascii=False)}')
PY
```

## 二、manifest 权限 → 实际能力（核心表）

### 2.1 `permissions`（API 权限）

| 权限 | 能力 | 风险等级 |
| --- | --- | --- |
| `<all_urls>`（在 host_permissions） | 读**所有**站点内容 + 改所有站点 | **等于全站读写** |
| `tabs` | 读所有标签的 URL/标题（不只当前） | 高（浏览历史画像） |
| `history` | 读全部浏览历史 | 高 |
| `cookies` | 读/写 cookie（配合 host 权限 = 会话劫持） | **极高** |
| `webRequest` + `<all_urls>` | 拦截所有请求（含 Authorization 头） | **极高** |
| `webRequestBlocking` | 阻断/改请求（需 MV2；MV3 限 declarativeNetRequest） | 极高 |
| `debugger` | 附到任意标签（CDP 全套能力） | **极高，近乎任意代码执行** |
| `proxy` | 改代理设置（流量全走攻击者） | 极高 |
| `management` | 枚举/禁用/卸载其他扩展 | 高 |
| `nativeMessaging` | 与本机程序通信（见 §4） | **极高（出沙箱）** |
| `downloads` | 下载任意文件 | 中高 |
| `scripting`（MV3） | 注入脚本（需配合 host 权限） | 高 |
| `storage` | 扩展自己的存储（不敏感） | 低 |
| `clipboardRead` | 读剪贴板（常含密码） | 高 |
| `identity` | OAuth 流程（可拿 Google 账号 token） | 高 |
| `privacy` | 改隐私设置 | 中 |
| `declarativeNetRequest` | 声明式改请求（MV3） | 中高 |

### 2.2 `host_permissions` / `matches`（站点范围）

```bash
# 提取所有 host 范围
python3 - <<'PY'
import json
m = json.load(open('ext/manifest.json'))
hosts = m.get('host_permissions', []) or []
for cs in m.get('content_scripts', []):
    hosts += cs.get('matches', [])
print('\n'.join(sorted(set(hosts))))
PY
```

判读：

- `<all_urls>`、`*://*/*`、`http://*/*` + `https://*/*` → **全站**
- `https://*.example.com/*` → 该域所有子域
- 只有 `https://app.example.com/*` → 范围受限（但若配合 `tabs` 仍可读其他站点元信息）

**关键组合**：`cookies` + `<all_urls>` = 可读任意站 cookie = 会话劫持。
`webRequest` + `<all_urls>` = 可读所有请求头 = 抓 token。

### 2.3 `web_accessible_resources`

这些文件可被**网页**（非扩展）访问。若里面是脚本/iframe，网页可能借它加载扩展上下文：

```bash
python3 -c "
import json;m=json.load(open('ext/manifest.json'))
print(json.dumps(m.get('web_accessible_resources',[]),indent=2,ensure_ascii=False))"
```

危险信号：把 `content.js`、`bridge.html` 暴露出去 → 网页可 `iframe` 它并 postMessage 调用扩展能力。

### 2.4 `externally_connectable`

允许**哪些网站**能直接 `chrome.runtime.sendMessage(extId, ...)`：

```bash
python3 -c "
import json;m=json.load(open('ext/manifest.json'))
print(json.dumps(m.get('externally_connectable',{}),indent=2))"
```

若 `matches: ["*://*/*"]` → **任何网站**都能给扩展发消息，等于扩展暴露了 API 给全网。

## 三、代码结构：background / content / injected

| 组件 | 运行环境 | 能力 | 通信 |
| --- | --- | --- | --- |
| **background**（MV3: service worker） | 扩展进程，有全部 API 权限 | 调 chrome.* 全部 | `chrome.runtime.onMessage` |
| **content script** | 页面上下文（隔离 world） | 读/改 DOM，limited chrome API | `chrome.runtime.sendMessage` |
| **injected script** | 页面主 world（真正共享 window） | 无 chrome API，能改页面 JS 对象 | `window.postMessage` |
| **popup/options** | 扩展页面 | 同 background | `chrome.runtime` |
| **devtools page** | DevTools 窗口 | 调试能力 | — |
| **offscreen document**（MV3） | 隐藏页面 | 用 DOM API（如解析 HTML） | `chrome.runtime` |

```bash
# 找到入口文件
python3 - <<'PY'
import json
m = json.load(open('ext/manifest.json'))
bg = m.get('background', {})
print('bg.service_worker:', bg.get('service_worker'))
print('bg.scripts     :', bg.get('scripts'))
print('bg.page        :', bg.get('page'))
for i, cs in enumerate(m.get('content_scripts', [])):
    print(f'cs[{i}].js      :', cs.get('js'))
    print(f'cs[{i}].matches :', cs.get('matches'))
PY
```

### 3.1 读通信路径（最重要的一节）

```bash
# 找所有消息监听与发送
grep -rn "onMessage" ext/ --include=*.js | head -30
grep -rn "sendMessage" ext/ --include=*.js | head -30
grep -rn "postMessage" ext/ --include=*.js | head -30
grep -rn "addEventListener('message'" ext/ --include=*.js
```

```bash
# 找 native messaging 连接
grep -rn "connectNative\|sendNativeMessage" ext/ --include=*.js
```

```bash
# 找外部消息入口（危险：不校验 sender）
grep -rn "onMessageExternal\|externally_connectable" ext/ --include=*.js
```

**必须回答的三个问题**：

1. background 的 `onMessage` 有没有校验 `sender`（`sender.id`、`sender.origin`、`sender.tab.url`）？
2. content script 有没有把 `window.postMessage` 的数据直接转给 background（放大器）？
3. injected script 有没有把 `eval`/`Function`/`innerHTML` 用在消息数据上？

```javascript
// 典型漏洞模式：无校验的消息转发
window.addEventListener('message', (e) => {
  // 缺 if (e.origin !== 'https://app.example.com') return;
  chrome.runtime.sendMessage({ cmd: e.data.cmd, args: e.data.args });
});
```

这段代码让**任何能向该页面 postMessage 的 iframe**（包括攻击者页面）都能调用扩展的全部能力。

### 3.2 MV3 service worker 的特殊性

```bash
# service worker 是事件驱动的，会被随时杀掉
# 状态不能存全局变量，必须存 chrome.storage
grep -rn "chrome.storage" ext/ --include=*.js | head -20
grep -rn "let \|var \|const " ext/background*.js | head -20   # 看是否有跨事件依赖的全局状态
```

MV3 的 `declarativeNetRequest` 替代了 `webRequestBlocking`，但静态规则文件可读：

```bash
cat ext/rules*.json 2>/dev/null | python3 -m json.tool | head -40
grep -rn "declarativeNetRequest" ext/manifest.json ext/*.js
```

规则里的 `redirect` 目标很关键——指向攻击者域就是流量劫持。

## 四、Native Messaging（出沙箱的唯一路径）

```bash
# 扩展侧的 host 名
grep -rn "connectNative\|sendNativeMessage" ext/ --include=*.js
# 形如 chrome.runtime.connectNative('com.acme.agent')
```

```powershell
# 本机注册的 native host（Windows）
reg query "HKCU\Software\Google\Chrome\NativeMessagingHosts" /s
reg query "HKLM\Software\Google\Chrome\NativeMessagingHosts" /s
reg query "HKCU\Software\Microsoft\Edge\NativeMessagingHosts" /s
```

```bash
# Linux / macOS
ls ~/.config/google-chrome/NativeMessagingHosts/
ls ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/
```

```json
// host manifest 内容（com.acme.agent.json）
{
  "name": "com.acme.agent",
  "description": "Acme Agent",
  "path": "C:\\Program Files\\Acme\\agent.exe",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef/"]
}
```

**检查点**：

| 项 | 危险值 | 后果 |
| --- | --- | --- |
| `path` 可写 | 非管理员可写 | 替换 exe → 扩展调用你的程序（沙箱逃逸） |
| `allowed_origins` 含 `*` 或多个扩展 | 宽 | 其他扩展可复用该 host |
| 注册在 `HKCU` | 用户可改 | 低权即可注册恶意 host |
| host 程序无签名校验 | — | 侧加载 |

```powershell
# 检查 path 的目录权限
icacls "C:\Program Files\Acme"
```

**Native messaging 是扩展能"出浏览器沙箱"的唯一正式通道**，也是本地提权的常见入口。

## 五、扩展 ID 与更新源

### 5.1 扩展 ID 的由来

- **商店扩展**：ID 由公钥（打包时的 key）哈希派生，稳定
- **未打包/开发者模式**：ID 由**路径**派生（`sha256(路径)` 前 16 字节转 a-p），换路径就换 ID
- manifest 里有 `"key"` 字段 → ID 由该公钥决定（可固定 ID 用于 native messaging 白名单）

```bash
# 从 key 算 ID
python3 - <<'PY'
import json, hashlib, base64
key = json.load(open('ext/manifest.json'))['key']
der = base64.b64decode(key)
h = hashlib.sha256(der).hexdigest()[:32]
print(''.join(chr(ord('a') + int(c, 16)) for c in h))
PY
```

**分析价值**：若 manifest 带 `key`，说明作者刻意固定 ID（通常为了 native messaging 白名单或企业部署）。

### 5.2 更新源

```bash
python3 -c "
import json;m=json.load(open('ext/manifest.json'))
print('update_url:', m.get('update_url'))"
```

| update_url | 含义 | 风险 |
| --- | --- | --- |
| 无 | 商店托管 | 低 |
| `https://clients2.google.com/service/update2/crx` | 商店 | 低 |
| 自建 `https://updates.vendor.com/...` | 自托管 | **中高**：更新 XML 可被篡改 → 推恶意版本 |
| `http://` | 明文 | 极高 |

```bash
# 自托管更新 XML 的结构（可访问时）
curl -s https://updates.vendor.com/update.xml | xmllint --format -
# <updatecheck codebase="https://.../ext_1.2.3.crx" version="1.2.3"/>
# 若 codebase 是 http 或可被劫持 → 可推任意版本
```

### 5.3 企业策略强制安装

```powershell
# 看是否被企业策略强制安装（这类扩展用户无法卸载）
reg query "HKLM\Software\Policies\Google\Chrome\ExtensionInstallForcelist" /s
reg query "HKCU\Software\Policies\Google\Chrome\ExtensionInstallForcelist" /s
reg query "HKLM\Software\Policies\Microsoft\Edge\ExtensionInstallForcelist" /s
```

**这类扩展是供应链攻击的高价值目标**：用户无法移除，且通常有宽权限。

## 六、深层审计：源码里找什么

### 6.1 高价值模式

```bash
# 1) 外部可控数据进危险 sink
grep -rnE "(eval|new Function|setTimeout\s*\(\s*['\"]|innerHTML|document\.write|insertAdjacentHTML)" \
  ext/ --include=*.js | head -30

# 2) 凭据/令牌处理
grep -rnE "(Authorization|Bearer|access_token|refresh_token|api_key|password)" \
  ext/ --include=*.js | head -30

# 3) 外发数据（数据回传）
grep -rnE "fetch\(|XMLHttpRequest|\.send\(|navigator\.sendBeacon" ext/ --include=*.js | head -30

# 4) 可疑域名
grep -rhoE "https?://[a-zA-Z0-9.\-]+" ext/ --include=*.js | sort | uniq -c | sort -rn | head -20

# 5) 混淆特征
grep -rlE "_0x[0-9a-f]{4,}|\\x[0-9a-f]{2}\\x[0-9a-f]{2}" ext/ --include=*.js
```

### 6.2 混淆代码处理

```bash
# 先看文件大小分布，小的可能是 loader
find ext -name '*.js' -exec wc -c {} + | sort -n | tail -20

# 常见混淆：eval + 长 base64 / 字符串数组 + 解密函数
# 处理顺序：
# 1) 找 eval / Function 的参数，打印出来（在沙箱里跑，不要在本机直接跑）
# 2) AST 去混淆（见 ast-deobfuscation.md）
# 3) 动态：加载到 Chromium，用 CDP 看实际执行的代码
```

```javascript
// 在隔离环境里把 eval 的输入打印出来（Node 沙箱）
const vm = require('vm');
const fs = require('fs');
const code = fs.readFileSync('obf.js','utf8');
const ctx = vm.createContext({
  eval: (s) => { console.log('=== EVAL ===\n' + s.slice(0, 4000)); return s; },
  Function: function(...a){ console.log('=== FUNCTION ===\n' + a.join('\n').slice(0,4000)); return () => {}; },
});
vm.runInContext(code, ctx, { timeout: 3000 });
```

### 6.3 动态分析（最可靠）

```bash
# 起一个带扩展的 Chromium，用 CDP 观察
# 1) 打包扩展目录（开发者模式加载）
google-chrome --user-data-dir=/tmp/prof --load-extension=/abs/path/to/ext \
  --remote-debugging-port=9222 about:blank

# 2) 连 CDP，看 service worker 的 target
curl -s http://127.0.0.1:9222/json/list | jq -r '.[] | "\(.type) \(.url)"'
# 期望看到 type=service_worker，url=chrome-extension://<id>/background.js

# 3) 附到该 target 上抓网络与 console
#    （用 puppeteer/playwright 的 connectOverCDP）
```

```javascript
// puppeteer 附着到已运行的 Chrome，抓扩展 service worker 的请求
const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
  const targets = b.targets().filter(t => t.type() === 'service_worker');
  for (const t of targets) {
    const w = await t.worker();
    console.log('SW:', t.url());
    w.on('console', m => console.log('[sw]', m.text()));
  }
  // 再去访问几个页面，观察扩展的行为
})();
```

## 七、验伤：扩展分析的成功标准

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| 全站读写能力 | manifest 的 `<all_urls>` + 代码里确实在注入/读取 | 只有权限声明但代码没用到（潜在风险，非实际利用） |
| 消息无校验 | 从**攻击者页面**成功调用扩展能力（如读到 cookie） | 只能在自家页面调用（那是正常） |
| cookie 窃取 | 拿到目标站的真实 cookie 并**用它登录** | 只看到代码里读 cookie（未外发） |
| native host 可劫持 | 替换 host 程序后扩展调用了你的程序 | 只是找到了路径 |
| 更新源可劫持 | 推到恶意版本并被安装 | 只看到 `update_url` 存在 |
| 数据外传 | 抓到实际发往第三方域的数据包（含用户数据） | 只有代码里有 fetch（可能未触发） |

**扩展分析的核心闭环**：**权限声明 → 代码路径 → 实际外发数据包**。三者齐全才算证明。

## 八、检测视角

| 手法 | 日志/信号 | 特征 |
| --- | --- | --- |
| 扩展侧加载 | EDR / 浏览器策略 | 扩展从非商店源安装；`update_url` 非 Google |
| 全站权限扩展 | 浏览器管理台 | `host_permissions` 含 `<all_urls>` 且非知名厂商 |
| 扩展数据外传 | 代理/DNS | 扩展 SW 向非常见域发请求；请求体含 cookie/token 结构 |
| Native host | 进程创建 | 浏览器进程（chrome.exe）拉起非签名 exe |
| 恶意更新 | 更新服务 | 版本号跳变；包签名/哈希不符 |
| 企业策略注入 | 注册表变更（需监控） | `ExtensionInstallForcelist` 被改 |
| postMessage 滥用 | 页面 CSP 报告 | 页面收到异常来源的 message（需页面侧埋点） |

## 九、常见坑

1. **crx 直接 unzip 失败**——有 `Cr24` 头，必须先剥。v2 和 v3 的头长度不同。
2. **只看 manifest 就下结论**——`<all_urls>` 是**潜在**能力，实际危害要看代码是否用了。两者要分开写。
3. **MV3 找不到 background 文件**——是 `background.service_worker` 而不是 `scripts`；且 SW 会被杀，动态分析时要主动触发事件。
4. **content script 里搜不到网络请求**——content script 跑在隔离 world，`fetch` 用的是页面上下文但 chrome API 不是。请求可能在 background 里发。
5. **Native host 只看注册表**——还要看 `path` 指向的程序是否存在、是否可写、是否有签名。
6. **混淆代码在本机直接 `node obf.js`**——可能有反调试或直接执行恶意行为。用 `vm` 沙箱 + timeout，或干脆在一次性 VM 里跑。
7. **忽略 `web_accessible_resources`**——这是网页能触达扩展上下文的入口，配合 `postMessage` 是完整的攻击链。