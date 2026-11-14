# 本地复现：把远程逻辑搬到本机跑起来

> 被 `js-reverse` 引用。**本地复现是唯一能证明「我真的搞懂了」的方式**——
> 远程只能观察，本地才能改参数试。

## 三种搬法

| 搬法 | 适用 | 做法 |
| --- | --- | --- |
| **整文件搬** | 逻辑在内联 js 里 | 下载 + 补环境 + 直接跑 |
| **函数抽离** | 只关心一个函数 | 抽出该函数 + 它依赖的闭包变量 |
| **行为复刻** | 逻辑埋在 WASM / 原生里 | 用 Node 重写等价实现，对照输出验证 |

## 整文件搬的步骤

```bash
# 1) 拿文件（保留原始字节，别过编辑器）
curl -s "https://app.example.com/static/js/main.3f2a.js" -o main.js

# 2) 找入口：页面里谁调这个文件里的东西
grep -oE "webpackJsonp|__webpack_require__\.s *= *[0-9]+" main.js | head

# 3) 起最小 Node 环境（见 env-patching.md）
node --inspect-brk main.js
```

## 函数抽离的坑（最常见的失败）

抽函数时**必须连带闭包变量**，否则一片 `ReferenceError`：

```javascript
// 原代码
(function(){
  var _0x1a = "salt123";          // ← 闭包变量，抽函数时必须一起搬
  window.sign = function(s){ return md5(s + _0x1a); };
})();

// 抽出来
const crypto = require("crypto");
const _0x1a = "salt123";
function sign(s){ return crypto.createHash("md5").update(s + _0x1a).digest("hex"); }
```

**判定抽对了**：对同一输入，本地结果 === 远程结果。**对不上就不是「差不多」，是错的。**

## 行为复刻的验证纪律

WASM / 原生逻辑没法直接搬时只能重写，此时**必须做对照表**：

```
输入            远程结果        本地结果        一致？
abc             8f14e45f...     8f14e45f...     是
ABC（大写）      c9f0f895...     c9f0f895...     是
空串             d41d8cd9...     d41d8cd9...     是
含中文           待测            待测            未知
超长（10k）      待测            待测            未知
```

**至少 5 组**：正常值、边界值（空 / 超长）、特殊字符、非 ASCII。
只测一组就宣布成功，是自欺。

## 复现失败的四种原因（按概率排）

1. **环境差异**——`navigator` / `Date` / `Math.random` 在 Node 里不同 → 补环境
2. **时序依赖**——代码用了 `performance.now()` 或存在竞态 → 固定时钟
3. **异步没等**——`Promise` 没 await，结果拿早了 → 加 await
4. **反调试**——检测到 devtools 走另一条分支 → 见 `fallbacks.md`

## 复现成功后的下一步

本地跑通不是终点，要用它做**参数空间探测**——这才是复现的价值：

```bash
# 例：验证 sign 是否只依赖时间戳（改时间戳看结果变不变）
for ts in 1700000000 1700000001 1700000002; do
  node sign.js --ts $ts --data "abc"
done
```

结论要写成一句话：**sign = md5(data + salt)，salt 固定为 xxx，与时间戳无关**。
只写「复现成功」等于没说清。