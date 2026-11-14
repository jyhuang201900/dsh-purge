# 自动化入口：从「看到混淆 JS」到「可执行任务」的入口判定

> 被 `js-reverse` 引用。目的：不让模型在入口处就开始瞎猜工具。

## 三种入口，按目标形态选

| 目标形态 | 入口 | 首条命令 |
| --- | --- | --- |
| 浏览器里已加载的页面（SPA / 有运行时） | **CDP 插桩** | 见 `instrumentation.md` |
| 只有静态文件（`*.js` 落地了） | **AST 静态分析** | 见 `ast-deobfuscation.md` |
| 只有网络流量 / 没有源文件 | **Hook + 抓包** | 先 `instrumentation.md` 的 Network 域 |

## 入口判定（30 秒内做完，不要写成分析报告）

```bash
# 1) 判断是不是打包产物（找 webpack/vite/rollup 指纹）
grep -lE "webpackJsonp|__webpack_require__|__vite__|System\.register" *.js | head

# 2) 判断混淆类型
grep -oE "_0x[0-9a-f]{4,}" target.js | head -3        # 十六进制名 → obfuscator.io 系
grep -c "\\x[0-9a-f]{2}" target.js                  # 转义密度 → 高则字符串加密
head -c 200 target.js                                  # 看头部有没有 eval/Function 自解

# 3) 判断有没有 sourcemap
curl -sI "https://site/path/app.js.map" | head -3
strings target.js | grep -oE "sourceMappingURL=.*" | head -2
```

## 入口决策树

```
有 sourcemap？
├─ 有 → 直接还原（最快，1 分钟）→ local-rebuild.md
└─ 无 → 
   有运行时？
   ├─ 有 → CDP 插桩抓真实参数（Observe/Capture）→ instrumentation.md
   └─ 无 → AST 静态去混淆 → ast-deobfuscation.md
         └ 失败 → 补环境本地跑起来 → env-patching.md
```

**纪律**：入口选择错了会白干。**先做上面 30 秒判定，再动手**。不要一上来就 `js-beautify`——
美化只改格式，不改控制流，混淆代码美化后依然读不懂。

## 最小可跑任务模板

每个入口都要产出这一份，后续环节共用：

```
target       URL 或文件路径
entry        选定的入口（cdp / ast / hook）
observable   这一轮要看到的信号（函数名 / 参数 / 返回值 / 网络请求）
artifact     落盘路径（runs/<阶段>-<目标>-<内容>.txt）
stop         什么算完成（拿到签名算法 / 拿到加密参数 / 拿到接口）
```
