# Sourcemap 恢复：从打包产物还原源码结构

> 被 `competition-bundle-sourcemap-recovery` 引用。核心不是「找 .map 文件」，
> 而是**在没有 map 的情况下重建足够的结构信息**。

## 一、先确认有没有 map（三种藏法）

```bash
# 1) 标准位置
curl -sI "https://site/static/js/main.3f2a.js.map" | head -3

# 2) 注释指向（构建时可能被删，也可能留在文件尾部）
tail -c 200 main.js | strings | grep -oE "sourceMappingURL=.*"

# 3) 内联（base64 data URI，最容易被漏掉）
grep -oE "sourceMappingURL=data:application/json;base64,[A-Za-z0-9+/=]{100,}" main.js | head -1
```

**内联 map 解码**：

```bash
grep -oE "base64,[A-Za-z0-9+/=]+" main.js | head -1 | sed 's/base64,//' | base64 -d > main.js.map
```

## 二、拿到 map 之后（1 分钟还原）

```bash
npx source-map-visualize main.js main.js.map   # 可视化
# 或直接用 sourcemap 库批量导出源码
node -e '
const fs = require("fs");
const { SourceMapConsumer } = require("source-map");
const map = JSON.parse(fs.readFileSync("main.js.map", "utf8"));
SourceMapConsumer.with(map, null, (c) => {
  const files = new Set();
  c.eachMapping((m) => m.source && files.add(m.source));
  console.log("原始文件数:", files.size);
  fs.mkdirSync("src", { recursive: true });
  for (const f of files) {
    const content = c.sourceContentFor(f, true);   // map 里通常带源码
    if (content) {
      const p = "src/" + f.replace(/^webpack:\/\//, "").replace(/\.\.\//g, "");
      fs.mkdirSync(require("path").dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    }
  }
});
'
```

**关键**：`sourceContentFor` 能拿到源码说明 map 是 `sourcesContent` 完整型；
拿不到说明只存了映射，源码要按 `sources` 路径去原站找。

## 三、没有 map 时怎么重建结构

| 目标 | 手法 | 命令 |
| --- | --- | --- |
| 模块边界 | 找 webpack 的 chunk 分段 | `grep -oE "__webpack_require__\([0-9]+\)" main.js \| sort -u` |
| 模块名 | 有的构建会保留 `/*! ./src/xxx.js */` 注释 | `grep -oE "/\\*! .*\\.js \\*/" main.js \| head` |
| 函数边界 | AST 解析后按 FunctionDeclaration 切 | 见 `ast-deobfuscation.md` |
| 字符串资源 | 提取所有字符串常量 | `strings main.js \| grep -E "^[\\x20-\\x7e]{6,}$"` |

**模块边界重建（最有用）**：

```javascript
// 打包产物的形态：一个大 IIFE 里一堆 function(module, exports, __webpack_require__)
// 用 AST 抽出每个 module 函数的源码，按 moduleId 命名落盘
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const fs = require("fs");

const ast = parser.parse(fs.readFileSync("main.js", "utf8"), { sourceType: "script" });
let n = 0;
require("@babel/traverse").default(ast, {
  FunctionExpression(p) {
    if (p.node.params.length === 3 && p.node.params[2].name === "__webpack_require__") {
      const id = p.parent?.key?.value ?? n;
      fs.mkdirSync("modules", { recursive: true });
      fs.writeFileSync(`modules/${id}.js`, generate(p.node).code);
      n += 1;
    }
  },
});
console.log("抽出模块:", n);
```

## 四、验伤：怎么证明还原是完整的

| 证据 | 判据 |
| --- | --- |
| 原始文件数量合理 | 中大型 SPA 通常 50~500 个源文件；只有 3 个说明 map 是残缺的 |
| 关键函数能定位 | 在还原出的源码里能搜到业务函数名（不是压缩名） |
| 行为可对照 | 把还原的一段逻辑抽出来跑，结果与线上一致 |
| 行号映射可用 | `SourceMapConsumer.originalPositionFor` 能把压缩后的位置映射回源文件 |

**反例**：
- map 只有 `names` 没有 `sourcesContent` → 拿到的是符号表不是源码
- 还原出的文件全是 `webpack/bootstrap` → map 只覆盖了 loader 部分

## 五、常见坑

1. **只看标准路径** —— map 可能在 CDN 另一路径、被改名、或内联成 data URI。
2. **忘了 `sourcesContent` 可能为空** —— 有些构建配置 `devtool: 'hidden-source-map'`
   会把 map 生成但不带源码，需要去原站按 `sources` 路径抓。
3. **模块切分把闭包切坏** —— AST 抽 FunctionExpression 时，模块之间的 `__webpack_require__`
   引用关系会断，切出来的模块单独跑不了（正常，目的是读不是跑）。
4. **把 chunk 当完整包** —— SPA 常有多个 chunk（`main.js` / `vendor.js` / `1.js`），
   要全部下载再拼。
5. **map 版本不匹配** —— 文件更新后旧 map 会错位，行号全偏。先确认 build hash 一致。