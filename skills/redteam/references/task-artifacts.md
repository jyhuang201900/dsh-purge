# 任务产物：一次性草稿还是可复用资产

> 被 `js-reverse` 引用。判据：**换个目标还能用 = 资产；只对这个目标有效 = 草稿。**

## 三类产物，分开放

| 类型 | 放哪 | 判据 |
| --- | --- | --- |
| 草稿 | `runs/` | 允许乱、允许一次性；但命名必须可追溯 |
| 脚本 / POC | `attack-files/<target>/` | 参数化 + 头注释四行 + 单一职责 + 失败可观测 |
| 结论 / 证据 | 演练台 | 用 `redteam_shot_add` / `redteam_vuln_add`，带原始请求或回显 |

## 落盘命名（不许用 temp / test1 / 新建文件）

```
runs/<阶段>-<目标>-<内容>[-日期].txt

runs/observe-app.example.com-network.txt
runs/capture-app.example.com-hook-login.txt
runs/rebuild-app.example.com-sign-fn.js
```

## 脚本四件套（缺一样就回炉）

```javascript
#!/usr/bin/env node
/**
 * 用途：解出 app.example.com 的 sign 参数生成逻辑
 * 用法：node sign.js --url https://app.example.com/api/list --page 2
 * 依赖：node>=18、无第三方包
 * 验证：对已知请求返回相同 sign；见 runs/rebuild-*.txt 的对照表
 */
const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1];
}
if (!args.url) { console.error("缺少 --url"); process.exit(2); }
```

**四条硬标准**：

1. 参数化——IP / 域名 / 端口走参数或头部变量，不写死
2. 头注释四行——用途 / 用法 / 依赖 / 验证
3. 单一职责——一个文件一件事
4. 失败可观测——非零退出码 + 写到 stderr

## 反例（这些不算产物）

- 截图但没标是哪个请求的响应
- 只有最终 JSON，没有「怎么复现」的命令
- 脚本里硬编码 `10.1.2.3` 且没提变量
- 满屏 `console.log`，但失败时退出码是 0

## 与演练台的接法

搞懂一个逻辑并验证后，要回落两处：

```
redteam_attack_file_add   落脚本（带 evidence：对哪个请求验过）
redteam_vuln_add          落漏洞（带 evidence：原始请求 + 回显）
```

只落脚本不落 evidence，等于「说做完了但没证据」。