# Node 环境重建：从浏览器代码到本机可跑

> 被 `js-reverse` 引用。补环境（`env-patching.md`）是**补缺的 API**；
> 这篇是**重建整个运行上下文**——包括依赖、时钟、随机数、网络。

## 一、先判断需要重建到什么程度

| 目标代码依赖 | 重建级别 | 做法 |
| --- | --- | --- |
| 纯算法（无 IO/无 DOM） | **最低**：直接 require | 只补 `window` 一句 |
| 用了 crypto/编码库 | **中**：装依赖 | npm i 对应库 |
| 用了 DOM/Canvas | **高**：补假对象 | jsdom 或手写骨架 |
| 需要真实网络请求 | **最高**：真跑 | 保留 fetch，指向测试环境 |

## 二、依赖识别（自动化，不靠猜）

```bash
# 抽所有浏览器/第三方 API 引用
grep -oE "\\b(window|document|navigator|localStorage|sessionStorage|XMLHttpRequest|fetch|WebSocket|crypto|atob|btoa|TextEncoder|TextDecoder|Intl|URL|URLSearchParams)\\b" main.js \
  | sort | uniq -c | sort -rn

# 抽可能的第三方库特征
grep -oE "\\b(jquery|\\$|lodash|_|moment|axios|crypto-js|CryptoJS|jsencrypt|sm2|sm4)\\b" main.js \
  | sort | uniq -c | sort -rn | head
```

**优先级**：`atob`/`btoa`/`TextEncoder` 在 Node 里有原生实现（直接可用），
`crypto-js`/`jsencrypt` 必须装包，`document` 要给假对象。

## 三、最小重建脚本

```javascript
// rebuild.js —— 装配顺序很重要：先原生，再第三方，最后业务代码
const fs = require("fs");
const vm = require("vm");

// 1) 原生能力（Node 自带，但浏览器形态不同）
const sandbox = {
  console,
  setTimeout, setInterval, clearTimeout, clearInterval,
  Buffer,
  TextEncoder, TextDecoder,          // Node 18+ 原生
  URL, URLSearchParams,
  atob: (s) => Buffer.from(s, "base64").toString("binary"),
  btoa: (s) => Buffer.from(s, "binary").toString("base64"),

  // 2) crypto：浏览器是 WebCrypto（异步），Node 有 crypto 模块（同步）
  crypto: {
    getRandomValues: (arr) => require("crypto").randomFillSync(arr),
    subtle: require("crypto").webcrypto.subtle,
  },

  // 3) 时间与随机（可固定，便于对照）
  Date: Date,
  Math: Object.create(Math),

  // 4) 全局
  window: null, self: null, globalThis: null,
};

// window 自引用
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;

const ctx = vm.createContext(sandbox);

// 5) 加载第三方库（UMD 形式可直接在 ctx 里跑）
if (fs.existsSync("vendor/crypto-js.min.js")) {
  vm.runInContext(fs.readFileSync("vendor/crypto-js.min.js", "utf8"), ctx);
}

// 6) 加载目标代码
vm.runInContext(fs.readFileSync("main.js", "utf8"), ctx);

// 7) 调用
const result = vm.runInContext("window.sign('abc')", ctx);
console.log("result:", result);
```

**为什么用 `vm` 而不是直接 `require`**：`require` 会把代码放进当前模块作用域，
拿不到 `window` 赋值的效果；`vm.createContext` 给一个干净的全局对象，
补环境补得干净，也不会污染你的脚本。

## 四、可变性控制（对照验证的关键）

```javascript
// 固定时钟：让每次运行的时间戳一致
let __now = 1700000000000;
sandbox.Date = class extends Date {
  constructor(...a) { super(...(a.length ? a : [__now])); }
  static now() { return __now; }
};

// 固定随机：让 Math.random 可复现
let __seed = 42;
sandbox.Math.random = () => {
  __seed = (__seed * 1103515245 + 12345) % 2147483648;
  return __seed / 2147483648;
};
```

**用途**：验证「sign 是否依赖时间戳」——

```bash
# 同一输入，改时钟，看结果变不变
__now=1700000000000 node rebuild.js   # → aaa
__now=1700000000001 node rebuild.js   # → aaa  ← 与时间无关
```

## 五、验证：三组对照

| 组 | 输入 | 期望 |
| --- | --- | --- |
| 1 | 远程抓到的真实请求参数 | 本地算出**完全相同**的结果 |
| 2 | 改一个字符 | 结果变化（证明输入真的参与了计算） |
| 3 | 边界（空 / 超长 / 中文） | 与远程一致（或明确记录不一致） |

组 2 很重要：如果改了输入结果不变，说明你解的函数**根本没用到那个参数**。

## 六、常见坑

1. **直接 `require("main.js")`** —— 拿不到 `window` 副作用，且会污染当前模块。
   用 `vm.createContext`。
2. **WebCrypto 与 node crypto 混用** —— 浏览器 `crypto.subtle.digest` 是异步返回 Promise，
   Node 的 `crypto.createHash` 是同步。混了会拿到 `[object Promise]`。
3. **忘了固定时钟** —— 做对照实验时结果一直在变，误判成"算法不确定"。
4. **`atob` 处理 Unicode 出错** —— 浏览器的 `atob` 只处理 Latin1，中文要先用
   `TextEncoder` 转字节。Node 里直接用 `Buffer.from(s, "base64")` 更稳。
5. **第三方库版本不对** —— crypto-js 3.x 与 4.x 的 `WordArray` 行为有差异，
   拿到错误结果时先对比版本。