# MCP 专用任务编排（jshookmcp / browser MCP）

> 被 `js-reverse` 引用。MCP 是「把浏览器 / Node 当远程执行面」，不是万能加速器。
> 用错场景会比手工慢十倍。

## 什么时候该用 MCP，什么时候不该

| 场景 | 用 MCP | 理由 |
| --- | --- | --- |
| 页面有反调试 / 风控，需要真实浏览器指纹 | 是 | MCP 走真 CDP，navigator 全套真值 |
| 需要在页面脚本**之前**下钩子 | 是 | `addScriptToEvaluateOnNewDocument` 只有 CDP 有 |
| 纯静态 js 文件分析 | 否 | 本地 Babel 更快，MCP 是绕远路 |
| 需要断点单步（Debugger 域） | 谨慎 | 能但慢，优先本地 `--inspect-brk` |
| 大量请求并发抓包 | 谨慎 | 单页面串行，别指望并发 |

## 五阶段在 MCP 里怎么落

```
1. Observe   → navigate + Network.enable，先看请求清单
2. Capture   → 注入 hook（addScriptToEvaluateOnNewDocument）
3. Rebuild   → Runtime.evaluate 取中间值 / 或转本地复现
4. Patch     → 本地改代码，回填到页面验证（evaluate 覆盖函数）
5. DeepDive  → Debugger.setBreakpointByUrl 精确定位
```

## 参数纪律

| 参数 | 值 | 原因 |
| --- | --- | --- |
| `Network.enable` 的 `maxTotalBufferSize` | `100000000` | 默认 10MB，大响应 `getResponseBody` 会返回空 |
| hook 注入时机 | 必须在 `Page.navigate` 之前 | 之后注入会被页面脚本覆盖 |
| `Runtime.evaluate` 的 `returnByValue` | 简单值 `true`，对象 `false` | 对象带循环引用会抛 |
| 超时 | 单命令 30s，整体 5min | 无超时会把会话卡死 |

## 失败回退

| 症状 | 原因 | 换法 |
| --- | --- | --- |
| hook 没触发 | 注入晚于页面脚本 | 用 `addScriptToEvaluateOnNewDocument` 重来 |
| `getResponseBody` 返回空 | 响应太大或已被消费 | 开 `Network.enable` 时就设大 buffer，或用 `Fetch` 域 |
| `Execution context was destroyed` | 页面跳转 | 等 `Page.loadEventFired` 再执行 |
| 拿不到 `window.xxx` | 在 iframe 里 | 遍历 `Page.getFrameTree` 找目标 frame |

## 与本地流程的交接点

Capture 阶段抓到的最小参数集，要立刻落盘成「本地复现的输入」：

```
runs/capture-<host>-<内容>.json
{
  "url": "...", "method": "POST", "headers": {...}, "body": "...",
  "expected": { "sign": "..." }     ← 本地复现时要对上的目标值
}
```

没有 `expected` 这个字段，本地复现就没有验收标准，等于白跑。