# 补环境：让 Node 跑得动浏览器代码

> 被 `js-reverse` 引用。顺序很重要——**先跑起来看报什么错，再补什么**。
> 不要预先塞一大堆 `window` / `document` 假对象，那会掩盖真实依赖。

## 迭代法（唯一正确的方法）

```bash
node main.js 2>&1 | head -5
# ReferenceError: window is not defined
#   → 只补 window
node main.js 2>&1 | head -5
# TypeError: Cannot read properties of undefined (reading 'userAgent')
#   → 补 navigator.userAgent
# ... 循环，直到跑通
```

**每轮只补一个**。一次补十个，就不知道哪个是必需的，也不知道哪个补错了。

## 最小环境骨架（按报错逐步加，不要一次全开）

```javascript
global.window = global;
global.self = global;
global.navigator = {
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  platform: "Win32",
  language: "zh-CN",
  languages: ["zh-CN", "zh"],
  hardwareConcurrency: 8,
  deviceMemory: 8,
  webdriver: false,              // 反爬常查这个
};
global.document = {
  cookie: "",
  createElement: () => ({ getContext: () => null, style: {}, setAttribute(){}, appendChild(){} }),
  addEventListener(){},
  removeEventListener(){},
  getElementsByTagName: () => [],
  documentElement: { style: {} },
};
global.location = { href: "https://app.example.com/", hostname: "app.example.com", protocol: "https:" };
global.screen = { width: 1920, height: 1080, colorDepth: 24 };
global.localStorage = {
  _d: {},
  getItem(k){ return this._d[k] ?? null; },
  setItem(k, v){ this._d[k] = String(v); },
  removeItem(k){ delete this._d[k]; },
};
const START = Date.now();
global.performance = { now: () => Date.now() - START };
```

## 反爬检测点（补错会立刻暴露）

| 检测项 | 真值特征 | 常见破绽 |
| --- | --- | --- |
| `navigator.webdriver` | `false` | Node 里是 `undefined`，直接被识别 |
| `navigator.plugins.length` | 3~5（Chrome） | 空数组，被识别 |
| `window.chrome` | 有 `runtime` 对象 | 缺，被识别 |
| `documentElement.style` 的 `-webkit-` 前缀 | 存在 | 缺，被识别 |
| `canvas.toDataURL()` | 稳定但机器相关 | 空 / 报错，被识别 |
| `performance.now()` | 有微秒抖动 | 恒等，被识别 |

## 常见报错对照

| 报错 | 缺什么 | 怎么补 |
| --- | --- | --- |
| `window is not defined` | 全局对象 | `global.window = global` |
| `Cannot read properties of undefined (reading 'x')` | 上游对象没建 | 补那个对象的父级 |
| `xxx is not a function` | 方法没实现 | 补空函数先跑，再看是否影响结果 |
| `Illegal invocation` | 方法被抽出来丢了 `this` | 用 `.bind(obj)` |
| 死循环 / 卡住 | 缺时钟或定时器 | 补 `setTimeout` / `setInterval`，但**不要真等** |

## 定时器的坑

```javascript
// 不要真的等 5 秒
global.setTimeout = (fn) => { fn(); return 0; };

// 但如果代码依赖「延时顺序」，立即执行会乱序 ——
// 那时才用真定时器，或者用 fake timer 固定时钟推进
```

## 判定标准

**补对了 = 本地输出 === 远程输出。**

补到「不报错」不等于「算得对」。很多反爬代码在缺环境时会走降级分支，
不报错但算出的 sign 是错的——必须用 `expected` 值对照才知道。