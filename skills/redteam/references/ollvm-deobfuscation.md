# OLLVM 去混淆：控制流平坦化与指令替换的实战还原

> 被 `malware-analysis` 引用。OLLVM（Obfuscator-LLVM）是**编译期**混淆，与 JS 的
> 运行期混淆完全不同——还原要在二进制层做，不能靠跑脚本。

## 一、先判是不是 OLLVM（三种典型特征）

| 特征 | 判断方法 | 说明 |
| --- | --- | --- |
| 控制流平坦化（FLA） | 函数的 CFG 呈「一个 dispatcher + 一堆 case」 | 大函数里只有一个 switch/间接跳转中枢 |
| 虚假控制流（BCF） | 大量恒真/恒假条件，`x ^ y == z` 类不透明谓词 | 分支数远超实际逻辑需要 |
| 指令替换（SUB） | 简单运算被换成等价复杂表达式（`a+b` → `a-(-b)`） | 反编译出来的算术看起来很怪 |

```bash
# 静态初判：函数大小与分支密度异常
rabin2 -zz sample.bin | head            # 看字符串（OLLVM 常保留）
r2 -A -q -c "afl~+size" sample.bin | sort -k2 -rn | head -10   # 最大的函数

# 动态初判：单步时大量跳转回到同一地址（dispatcher）
# gdb: 在疑似 dispatcher 地址下断，观察是否反复命中
```

**关键判据**：一个函数里，**绝大多数基本块都跳回同一个块**——那个块就是 dispatcher。

## 二、控制流平坦化的结构（看懂这个才能还原）

```
        ┌──────────────┐
        │  entry:      │
        │  state = X   │
        └──────┬───────┘
               ▼
        ┌──────────────┐
   ┌───►│ dispatcher:  │◄───┐
   │    │ switch(state)│    │
   │    └──┬───┬───┬───┘    │
   │       │   │   │        │
   │   ┌───▼┐┌─▼─┐┌▼──┐     │
   │   │case││case││case│    │
   │   │ 1  ││ 2 ││ 3  │    │
   │   └─┬──┘└─┬─┘└─┬──┘    │
   │     │     │    │       │
   └─────┴─────┴────┘       │
         (state = next) ────┘
```

**还原的本质**：把 `state` 的赋值链抽出来，按 state 转移顺序重排 case 体。
**不需要真的重建 CFG**——只要按 `state` 顺序把块拼起来。

## 三、脚本化还原（r2 / IDA 两条路）

### 路线 A：r2 脚本抽取 state 转移

```python
# r2 -i ollvm_fla.py -A sample.bin
import r2pipe, re

r2 = r2pipe.open()
r2.cmd("aaa")

# 1) 找 dispatcher：被最多块跳转到的地址
refs = {}
for f in r2.cmdj("aflj") or []:
    for blk in r2.cmdj(f"afbj @ {f['offset']}") or []:
        for op in r2.cmdj(f"aoj {blk['size']} @ {blk['addr']}") or []:
            if op.get("type") == "jmp" and op.get("jump"):
                refs[op["jump"]] = refs.get(op["jump"], 0) + 1

disp = max(refs, key=refs.get) if refs else None
print(f"dispatcher 疑似：{hex(disp)}  入边 {refs.get(disp)}")

# 2) 抽每个 case 的 (case_id, state_assignment)
# 手工看 dispatcher 的跳转表（r2: axj @ <disp>）
print(r2.cmd(f"axj @ {disp}"))
```

### 路线 B：IDA + 插件（推荐，更快）

```bash
# 装 OLLVM 反混淆插件（社区有多个，选维护活跃的）
# 通用流程：
#   1) 定位 dispatcher（插件自动找分发表）
#   2) 按 state 转移重建顺序
#   3) 用 Hex-Rays 重新反编译该函数
```

**纪律**：插件结果**必须人工核对**。OLLVM 变种（有的加了 state 加密、
有的把 state 存在堆上）会让插件还原出错误顺序，而且错得不明显——
反编译能过但逻辑反了。

## 四、验证还原正确性（最容易跳过的一步）

| 方法 | 怎么做 | 判据 |
| --- | --- | --- |
| **动态对照** | 对同一输入，原样本与还原后逻辑的输出必须一致 | 逐字节相同 |
| **关键路径插桩** | 在原样本里给每个 case 入口打点，记录实际执行顺序；还原后应一致 | 顺序完全相同 |
| **分支覆盖** | 构造输入覆盖每个 case，看行为是否符合预期 | 每个分支都走到且行为正确 |

**反例**：反编译「看起来像正常代码」就宣布还原成功——这是最常犯的错。
OLLVM 还原错顺序后代码依然可读，只是逻辑是错的。

## 五、指令替换（SUB）的处理

```c
// 原：a + b
// 混淆后：a - (-b)  或  (a ^ b) + 2*(a & b)
```

**判据**：反编译出来的算术表达式里有大量 `-(-x)`、`~(~x)`、`(x^y)+2*(x&y)` 这类结构。

**处理**：

- 手工：这些是恒等变形，按数学恒等式直接化简
- 脚本：写 Hex-Rays microcode 插件做模式匹配替换（成本高，只在大函数上值得）
- **务实做法**：只化简出现在**关键判断**上的表达式（比较/边界），其余不动

## 六、虚假控制流（BCF）的处理

特征是**不透明谓词**：

```c
// 恒真（但编译器看不出来）
if ((x * (x + 1)) % 2 == 0) { /* 真实逻辑 */ } else { /* 垃圾代码 */ }

// 恒假
if (y * y < 0) { /* 永不执行 */ }
```

**处理顺序**：

1. 先用常量折叠/符号执行判定哪些分支恒真（angr 可以自动做）
2. 恒假分支整块删除，恒真分支提升
3. 剩下的才是真实控制流

```python
# angr 判定恒假分支（示例骨架）
import angr
p = angr.Project("./sample.bin", auto_load_libs=False)
sm = p.factory.simulation_manager()
sm.explore(find=lambda s: <真实目标地址>, avoid=lambda s: <垃圾地址>)
```

## 七、常见坑

1. **把 BCF 当 FLA 处理** —— 两者结构完全不同。FLA 有 dispatcher，BCF 是谓词。判错工具白跑。
2. **只还原 FLA 不做验证** —— 顺序错也能反编译通过，必须动态对照。
3. **试图完全自动还原** —— OLLVM 变种很多，全自动一定有错。**只在需要理解的关键函数上做**，
   其余保持原样。
4. **忘了编译选项影响** —— `-O2` 加 OLLVM 后函数被内联/拆分，dispatcher 可能不止一个。
5. **忽略字符串与常量** —— 很多样本的关键信息（密钥、URL）没被混淆，先 `strings` 捞一遍，
   可能根本不需要去混淆。