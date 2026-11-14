# 回退策略：主路径失败的四类原因与替代路径

> 被 `js-reverse` 引用。回退不是"换个工具再试一次"，而是**先判断失败属于哪一类**，再选
> 对应的替代路径。分类错了，换十个工具也没用。

## 一、四类失败原因（判定表）

| 类别 | 症状 | 判定信号 | 替代路径 |
| --- | --- | --- | --- |
| **① 入口不对** | 断点不命中、找不到关键函数 | 页面行为变了但代码没变；有多个 bundle | 换入口（换页面/换触发方式/找懒加载 chunk） |
| **② 环境不足** | 报 `xxx is not defined`、结果不一致 | 本地跑报 Web API 缺失 | 补环境 / 用真浏览器 |
| **③ 反调试拦截** | 断点被跳过、`debugger` 死循环、`Function.prototype.toString` 被改 | 打开 DevTools 就没反应 | 插桩 / 反反调试 / 换时机 |
| **④ 逻辑不在 JS 里** | 全站 JS 都看完也没有签名逻辑 | 有 WASM / 有原生调用 / 在 Service Worker 里 | 转 WASM 分析 / 抓包重放 / 放弃本地复现 |

## 二、① 入口不对：五个换法

```bash
# 1) 确认当前分析的 bundle 是"正在用的那个"
#    从 Network 面板看实际加载的 JS，而不是从 HTML 里猜
grep -oE 'src="[^"]+\.js"' page.html
# 但真实加载的可能是动态 import 的 chunk

# 2) 找懒加载 chunk（webpack 的 chunk 映射）
grep -oE '"chunk-[a-f0-9]+"' main.js | sort -u
grep -oE '\.u\s*=\s*function' main.js    # webpack 的 chunk 文件名生成器

# 3) 换触发方式：同一个功能可能有多个入口
#    按钮点击 / 表单提交 / 页面加载 / 定时器 / WebSocket 消息
#    用事件监听断点（Event Listener Breakpoints）逐个试

# 4) 换页面：登录页 vs 主应用可能加载不同 bundle
# 5) 换时机：首屏 vs 交互后（有些代码在交互时才加载）
```

```javascript
// 在 CDP 里列出所有已加载的脚本（含动态加载的）
// （用 CDP 的 Debugger.scriptParsed 事件）
const scripts = [];
client.on('Debugger.scriptParsed', e => scripts.push(e.url));
await client.send('Debugger.enable');
// 触发页面行为后再看
console.log(scripts.filter(u => u.includes('.js')));
```

**判定"入口不对"**：你改了一个函数但页面行为没变 → 你看的不是真正在跑的那份代码。

## 三、② 环境不足：三条路

| 路 | 适用 | 成本 |
| --- | --- | --- |
| **补环境**（`env-patching`） | 依赖少、纯计算逻辑 | 低 |
| **用真浏览器跑**（CDP/Playwright） | 依赖多、有 DOM/Canvas/WebGL | 中 |
| **只抽核心函数**（`local-rebuild`） | 逻辑集中在一个函数 | 低但需连带闭包 |

```bash
# 判断依赖深度：跑一遍看报什么错，数一下报错种类
node main.js 2>&1 | grep -oE '^[A-Za-z]+Error: .*' | head -20
# 1-3 种 → 补环境可行
# 10+ 种（DOM/Canvas/WebGL/Worker）→ 用真浏览器
```

```javascript
// 折中方案：在真浏览器里跑，但把结果导出（比纯补环境稳）
// 用 Playwright 的 evaluate
const { chromium } = require('playwright');
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('https://app.example.com/');
const sig = await p.evaluate(async (data) => {
  // 直接调用页面里的函数
  return window.__sign(data);
}, 'payload');
console.log(sig);
```

## 四、③ 反调试：五类与对策

| 反调试手法 | 症状 | 对策 |
| --- | --- | --- |
| `debugger` 死循环 | 断点一开就卡死 | 禁用所有断点后 hook `Function`；或在 `debugger` 语句前 patch |
| `Function.prototype.toString` 检测 | 被 hook 的函数被识别 | 用 Proxy 保持 `toString` 返回原值 |
| 检测 `devtools` 打开 | 打开就跳转/白屏 | 用 CDP 但不在前台；或 hook `console` |
| 计时检测（`debugger` 前后时间差） | 下断点就触发反制 | 避免断点，用 `Runtime.evaluate` 注入 |
| 代码完整性校验 | 改代码后报错 | 在内存里改（不落盘） |

```javascript
// 反 debugger 死循环：在页面加载前 patch
// （CDP 的 Page.addScriptToEvaluateOnNewDocument）
const patch = `
  (function(){
    const _Function = Function;
    // 让 debugger 语句失效：替换 Function 构造
    window.Function = new Proxy(_Function, {
      construct(target, args) {
        const src = args[args.length - 1] || '';
        args[args.length - 1] = src.replace(/debugger;?/g, '');
        return new target(...args);
      },
      apply(target, thisArg, args) {
        if (args.length) args[args.length-1] = String(args[args.length-1]).replace(/debugger;?/g,'');
        return target.apply(thisArg, args);
      }
    });
  })();
`;
await client.send('Page.addScriptToEvaluateOnNewDocument', { source: patch });
```

```javascript
// 保住 toString（防止 hook 被识别）
const origToString = Function.prototype.toString;
Function.prototype.toString = new Proxy(origToString, {
  apply(target, thisArg, args) {
    if (thisArg === someHookedFn) return 'function native() { [native code] }';
    return Reflect.apply(target, thisArg, args);
  }
});
```

**判定"被反调试"**：代码逻辑正确但断点从不命中；或打开 DevTools 后页面行为突变。

## 五、④ 逻辑不在 JS：四个转出方向

| 迹象 | 真实位置 | 转出 |
| --- | --- | --- |
| `WebAssembly.instantiate` | WASM | `wasm2wat` + 分析 |
| 大量 `new Worker('...')` | Worker | 单独抓 Worker 的脚本 |
| `navigator.serviceWorker` | SW | 从 `Service Worker/ScriptCache` 取 |
| 空函数体但结果正确 | 原生插件/扩展 | 查 native messaging / 扩展 |
| `crypto.subtle` | 浏览器原生 | 用 Node 的 `crypto.webcrypto` 复刻 |

```bash
# WASM 分析
curl -s https://app.example.com/static/sign.wasm -o sign.wasm
wasm2wat sign.wasm -o sign.wat
grep -nE 'call|i32|local' sign.wat | head -40
# 或用 wasm-decompile
wasm-decompile sign.wasm -o sign.dcmp
```

```bash
# 提取 Service Worker 脚本（Chrome profile）
ls "$LOCALAPPDATA/Google/Chrome/User Data/Default/Service Worker/ScriptCache/"
# 里面是缓存文件，需要用脚本解析或用 CDP 直接取
```

## 六、回退的判定信号（该放弃的四个时刻）

| 信号 | 含义 | 动作 |
| --- | --- | --- |
| 换了 3 个入口仍然不命中 | 逻辑不在你能触达的 JS 里 | 转 WASM/原生 |
| 补了 10+ 个 API 仍报新错 | 依赖 DOM/渲染，不是纯计算 | 用真浏览器 |
| 反调试绕过 3 次仍被识别 | 有多层检测 | 换时机（首屏前注入）或放弃动态 |
| 时间盒用尽（如 90 分钟） | 投入产出比低 | 报告"未突破"+ 已有的观察证据 |

**关键**：放弃不等于失败。**记录"试了什么、为什么不行"就是有价值的结论**。

```markdown
## 回退记录模板

**主路径**：CDP 断点 hook `XHR.send`，定位签名函数
**失败原因**：③ 反调试（`debugger` 死循环 + `toString` 检测）
**已试**：
1. 禁用断点 + `Page.addScriptToEvaluateOnNewDocument` patch → 仍被识别（有计时检测）
2. 用 `Runtime.evaluate` 注入 hook（不断点）→ 部分生效，但签名函数在 Worker 里
3. 抓 Worker 脚本 → 脚本被混淆且二次加载
**结论**：签名逻辑在 Worker + WASM 里，动态 hook 成本过高
**替代方案**：改为"重放式"——用浏览器正常操作一次，捕获请求，之后重放（不重算签名）
**限制**：签名有时效（约 30 秒），重放窗口有限
```

## 七、验伤：回退是否成功的判据

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| 换入口成功 | 新入口的断点命中，且能改参数影响结果 | 断点命中但改参数无影响（不是关键路径） |
| 补环境成功 | 本地输出与远程**逐字节一致**（多组输入） | 一组偶然一致 |
| 反调试绕过 | 断点稳定命中，且连续 10 分钟不被踢 | 命中一次后又被拦 |
| 转 WASM 成功 | 能从 wat 里读出算法，且复刻后结果一致 | 只是能打开 wat |
| 放弃 | 有完整的"已试清单+失败原因" | 只说"做不了" |

## 八、检测视角（防守方看到什么）

| 回退动作 | 信号 |
| --- | --- |
| 换页面/换入口 | 同一账号短时间内访问大量不同路由 |
| 补环境（本地跑） | 服务端看到来自非浏览器的 TLS 指纹 / 无 cookie |
| 反调试绕过 | 页面加载时 `Function.prototype.toString` 被调用异常频繁 |
| WASM 分析 | 大量请求 `.wasm` 文件 |
| 重放 | 相同请求体在短时间内重复（nonce/时间戳相同） |

## 九、常见坑

1. **不判类别就换工具**——"换工具"只对 ②环境不足 有效。①③④ 换工具没用。
2. **不确认"这是正在跑的代码"**——静态下载的 bundle 可能不是实际执行的那份（有动态加载/服务端下发）。
3. **补环境补太多**——一次塞 20 个假对象，掩盖了真实依赖，也不知道哪个错。
4. **反调试硬刚**——有多层检测时，patch 一层触发下一层。换时机（首屏前）比逐个 patch 更有效。
5. **忘了 Worker/SW**——大量逻辑在这些"看不见的上下文"里。主线程找不到就去那里。
6. **时间盒不设**——在一条路上耗一整天。设 60-90 分钟上限。
7. **放弃了不记录**——"试过什么、为什么不行"本身就是交付物（避免下一个人重复）。
8. **把"重放"当"逆向成功"**——重放只是绕过，不是理解了算法。报告要区分。