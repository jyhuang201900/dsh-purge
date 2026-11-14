# 工具默认值与参数口径

> 被 `js-reverse` 引用。目的：模型不要每次重新猜参数，也不要给出「按需调整」这种废话。

## 静态分析

| 工具 | 默认参数 | 说明 |
| --- | --- | --- |
| `js-beautify` | `-s 2 -w 120` | 缩进 2；宽度 120 避免长字符串被硬折行 |
| `node --inspect-brk` | `--inspect-brk=0.0.0.0:9229` | 断在第一行前，方便下断点 |
| `de4js`（在线/本地） | 先选 `Obfuscator.io` 预设 | 猜错预设会解出垃圾 |
| `webcrack` | `webcrack input.js -o out/` | 自动识别 webpack/obfuscator，优先试它 |

## Babel AST 常用插件（去混淆）

```bash
npm i -D @babel/parser @babel/traverse @babel/generator @babel/types
```

| 参数 | 默认 | 为什么 |
| --- | --- | --- |
| `parser plugins` | `["jsx","typescript"]` 按需 | 少一个会直接 parse 失败 |
| `sourceType` | `"script"`（打包产物）/ `"module"`（ESM） | 判错会拿不到 `Program.body` |
| `jsescOption` | `{ minimal: true }` | 输出中文不转成 `\uXXXX` |

## 运行时插桩

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| CDP `Runtime.evaluate` | `awaitPromise: true` | 拿异步结果 |
| `Network.getResponseBody` | `maxTotalBufferSize: 100MB` | 默认 10MB 会截断大响应 |
| Hook 注入时机 | `Page.addScriptToEvaluateOnNewDocument` | **必须**在页面脚本前，否则钩子被覆盖 |
| `frida -f` | `--no-pause` | 不加会停在启动点，看起来像卡死 |

## 输出

| 参数 | 默认 |
| --- | --- |
| 产物目录 | `runs/` |
| 文件命名 | `<阶段>-<目标>-<内容>[-日期].txt` |
| 日志级别 | 只记信号，不记心跳 |

**纪律**：以上是默认值，不是建议值。要改必须说清「为什么这个目标的默认值不适用」，
否则按默认走——「按需调整」等于没给参数。
