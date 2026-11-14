# AST 去混淆：从混淆态还原到可读逻辑

> 被 `js-reverse` 引用。核心：**先判混淆类型，再选还原手法**。
> 用错手法会把代码改坏而且看不出来（AST 层面合法，语义已错）。

## 一、30 秒判型

```bash
# 1) 字符串数组 + 位移函数（obfuscator.io 家族最强特征）
grep -cE "var _0x[0-9a-f]{4,} *= *\[" target.js
grep -cE "_0x[0-9a-f]{4,} *- *0x[0-9a-f]{3,}" target.js

# 2) 控制流平坦化（switch 包裹 + 状态变量自增）
grep -cE "switch *\(.*\) *\{ *case " target.js
grep -cE "while *\( *!!\[\] *\)" target.js

# 3) 死代码注入（if 条件恒假：'abc'.length !== 3）
grep -cE "'[a-z]+'\.length *!== *[0-9]+" target.js

# 4) 代理函数（一层层包成 function(a){return f(a)}）
grep -cE "return [a-z_$]+\([a-z]\);" target.js
```

| 命中最多 | 混淆类型 | 还原首要动作 |
| --- | --- | --- |
| 1（字符串数组） | obfuscator.io / javascript-obfuscator | 提取数组 + 内联还原 |
| 2（switch 平坦化） | 控制流平坦化 | 重建真实控制流 |
| 3（死代码） | 死代码注入 | 删除恒假分支 |
| 4（代理函数） | 代理/包裹 | 折叠代理链 |

## 二、字符串数组还原（最常见，优先做这个）

```javascript
// 输入形态
var _0x1a2b = ["log", "getElementById", "value", "test"];
(function (_0xarr, _0xkey) {
  var _0xshift = function (i) {
    i = i - 0x0;
    var s = _0xarr[i];
    return s;
  };
  window.foo = _0xshift;
})(_0x1a2b, 0x1f3);

// 还原脚本：直接把调用的返回值内联
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");
const fs = require("fs");

const code = fs.readFileSync("target.js", "utf8");
const ast = parser.parse(code, { sourceType: "script" });

// 1) 收集字符串数组与位移函数
const arrMap = new Map();
traverse(ast, {
  VariableDeclarator(p) {
    const { id, init } = p.node;
    if (t.isIdentifier(id) && t.isArrayExpression(init)) {
      arrMap.set(
        id.name,
        init.elements.map((e) => (t.isStringLiteral(e) ? e.value : null))
      );
    }
  },
});

// 2) 折叠 函数调用(数组名, 索引) → 字符串
traverse(ast, {
  CallExpression(p) {
    const callee = p.node.callee;
    if (!t.isIdentifier(callee)) return;
    const args = p.node.arguments;
    if (args.length !== 1 || !t.isNumericLiteral(args[0])) return;
    // 找同名位移函数体（实践中需先解析函数声明的移位逻辑）
    const arr = arrMap.get(callee.name);
    if (!arr) return;
    const v = arr[args[0].value];
    if (typeof v === "string") p.replaceWith(t.stringLiteral(v));
  },
});

fs.writeFileSync("target.deob.js", generate(ast, { jsescOption: { minimal: true } }).code);
```

**关键点**：

- `jsescOption: { minimal: true }` 不加，中文会被转成 `\uXXXX`，可读性全毁
- 位移函数的**真实偏移量**必须先解出来（`_0xshift` 里 `i - 0x1f3` 或先按某顺序重排数组）
- 有些样本会**重排数组**（`_0xarr.push(_0xarr.shift())` 循环），不先跑那步偏移就是错的

## 三、验证还原正确性（这一步不能省）

```bash
# 还原后必须在原环境跑一遍，对比行为
node target.js    > before.txt 2>&1
node target.deob.js > after.txt 2>&1

# 差异比较：允许"输出相同但格式不同"，不允许"结果不同"
diff <(node -e "require('./target.js'); console.log('ok')" 2>&1) \
     <(node -e "require('./target.deob.js'); console.log('ok')" 2>&1)
```

**判定标准**：同一输入 → 同一输出。**只是"看起来能跑"不算还原成功**。
如果原代码依赖浏览器环境，用 `env-patching.md` 的骨架补好再比。

## 四、控制流平坦化的识别与还原

```javascript
// 原形态
var _0xorder = "3|1|0|2".split("|");
var _0xi = 0x0;
while (!![]) {
  switch (_0xorder[_0xi++]) {
    case "0": doB(); continue;
    case "1": doA(); continue;
    case "2": doD(_0xstate); continue;
    case "3": _0xstate = init(); continue;
  }
  break;
}
// 真实顺序：3 → 1 → 0 → 2  = init() → doA() → doB() → doD(state)
```

**还原方法**：按 `_0xorder` 的字符串顺序重排 case 体。

```javascript
// 手工还原（推荐，比脚本可靠）
state = init();
doA();
doB();
doD(state);
```

**不要用全自动工具**（如某些 "flattener" 项目）：它们对带 `_0xstate` 跨 case 传值的样本
经常生成错误代码，而且错得不明显。

## 五、死代码与代理函数的清理

```javascript
// 死代码（恒假分支）——判断依据是常量折叠后恒 false
if ('abcdef'.length !== 6) { /* 永不执行 */ }
// 用 Babel 的 path.evaluate() 判断，不要靠正则

// 代理函数链——一层层折叠
function _0xa(x){ return _0xb(x); }
function _0xb(x){ return _0xc(x); }
function _0xc(x){ return md5(x); }
// 折叠后：_0xa === md5
```

## 六、常见坑

1. **先美化再分析**——`js-beautify` 只改空白，混淆逻辑一点没变；美化后依然读不懂，还多了几万行。
2. **解位移函数时忽略数组重排**——有些样本启动时先 `while(n--) arr.push(arr.shift())`，不跑这步索引全偏。
3. **还原后不验行为**——AST 合法 ≠ 语义正确。必须用同输入对比输出。
4. **正则改代码**——正则不认识 AST 边界，会改到字符串里的同名 token。一律用 Babel visitor。
5. **忘了 `sourceType`**——打包产物用 `script`，ESM 用 `module`，判错直接 parse 失败。
6. **eval 自解型放弃太早**——有些样本第一层是 `eval(decrypt("..."))`，先把 decrypt 结果打印出来就能拿到下一层，不需要静态解整个链。