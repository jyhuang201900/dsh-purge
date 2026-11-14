# 插桩：把运行时变成可观察的白盒

> 被 `js-reverse` 引用。**插桩的本质是「不改代码就能看到内部值」**。
> 三种插桩面：CDP 断点、函数 Hook、网络层 Hook。

## 一、注入时机（这一步错了全错）

| 时机 | API | 适用 |
| --- | --- | --- |
| 页面脚本执行**之前** | `Page.addScriptToEvaluateOnNewDocument` | Hook 原生函数（XHR/fetch/crypto）**必须**用它 |
| 页面加载完 | `Runtime.evaluate` | 补读状态、覆盖已存在的函数 |
| 某个函数被调用时 | `Debugger.setBreakpointByUrl` | 精确取那一刻的局部变量 |

**反例**：用 `Runtime.evaluate` 注入 XHR hook —— 页面自己的脚本已经跑过，
它抓到的是 hook 后的 XHR；但页面已经缓存了原始引用，hook 无效。

## 二、CDP Hook 模板

```javascript
// 注入到 addScriptToEvaluateOnNewDocument 的 source
(() => {
  const R = { log: [] };
  window.__hook = R;

  // 1) fetch
  const _fetch = window.fetch;
  window.fetch = function (...args) {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
    const opts = args[1] || {};
    R.log.push({ type: "fetch", url, method: opts.method || "GET", body: opts.body });
    return _fetch.apply(this, args).then((res) => {
      const clone = res.clone();
      clone.text().then((t) => {
        R.log.push({ type: "fetch-res", url, status: res.status, body: t.slice(0, 2000) });
      });
      return res;
    });
  };

  // 2) XHR
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u, ...rest) {
    this.__h = { method: m, url: u };
    return _open.call(this, m, u, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    this.__h.body = body;
    this.addEventListener("load", () => {
      R.log.push({ type: "xhr-res", ...this.__h, status: this.status, body: String(this.responseText).slice(0, 2000) });
    });
    return _send.call(this, body);
  };

  // 3) 加密函数（常见入口名）
  ["encrypt", "sign", "md5", "sha1", "hmac"].forEach((name) => {
    if (typeof window[name] === "function") {
      const _f = window[name];
      window[name] = function (...a) {
        const r = _f.apply(this, a);
        R.log.push({ type: "crypto", name, args: a, ret: r });
        return r;
      };
    }
  });
})();
```

**取结果**：

```javascript
// Runtime.evaluate（returnByValue: true）
JSON.stringify(window.__hook.log.slice(-20))
```

## 三、函数级断点（精确取局部变量）

```javascript
// 1) 找脚本
Debugger.enable
Debugger.getScriptSource({ scriptId })

// 2) 在函数体首行下断
Debugger.setBreakpointByUrl({
  lineNumber: 42,                       // 0-based
  url: "https://site/static/js/main.js"
})

// 3) 命中后读作用域
Debugger.paused  → 事件里 callFrames[0].scopeChain
Debugger.evaluateOnCallFrame({ callFrameId, expression: "JSON.stringify(locals)" })
```

**断点的坑**：打包产物的行号压缩过，`lineNumber` 要对 `prettyPrint` 之后的行号；
如果脚本被 `Debugger.setBlackboxPatterns` 排除，断点不生效。

## 四、覆盖原生函数（绕过检测）

有些样本会检测 `fetch.toString()` 是否 `[native code]`。覆盖时要伪装：

```javascript
const _fetch = window.fetch;
const fake = function (...a) { /* hook 逻辑 */ return _fetch.apply(this, a); };
Object.defineProperty(fake, "toString", {
  value: () => "function fetch() { [native code] }",
});
window.fetch = fake;
```

同样要处理 `Function.prototype.toString` 本身被检测的情况（改 `fn.name` 也会被查）。

## 五、验伤：怎么证明 Hook 真的生效了

| 证据 | 怎么看 |
| --- | --- |
| Hook 被调用过 | `window.__hook.log.length > 0` |
| 抓到了真实参数 | log 里有本次请求的真实 URL/body，不是空的 |
| 返回值被正确传递 | 页面功能正常（不是白屏/报错），说明 hook 没破坏原逻辑 |
| 覆盖没被检测 | 页面没有走反调试分支（没出现 debugger 死循环/跳转） |

**反例（看起来成功其实是假）**：

- 注入成功但 `log` 一直空 —— 页面用的是**闭包内缓存的**原始引用，你的 hook 没被走到
- 抓到参数但都是 `undefined` —— hook 时机太早，业务代码还没把参数填进去
- 页面白屏 —— 你的 hook 抛异常，拖垮了页面初始化

## 六、常见坑

1. **在错误的时机注入** —— Hook 原生 API 必须用 `addScriptToEvaluateOnNewDocument`。
2. **不 clone 响应** —— `res.text()` 会消费流，页面后续读不到数据，功能坏掉。
   必须 `res.clone()` 后再读。
3. **toString 不伪装** —— 现代反爬会查 `[native code]`。
4. **忘了代理层** —— 有的站用 `Promise` 包装或 Service Worker 拦截，先在 SW 里 hook。
5. **hook 太多** —— 一次 hook 十几个函数会拖慢页面，也更容易被发现。只 hook 需要的。