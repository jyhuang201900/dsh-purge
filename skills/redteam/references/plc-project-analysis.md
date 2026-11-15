# PLC / SCADA 工程文件分析

被 `plc-controller-attack`（PLC 工程）与 `scada-hmi-attack`（SCADA 工程）引用。

**为什么这一步价值最高**：拿到工程文件 = 拿到**全部 Tag 语义**（哪些是设定值、哪些是联锁、
哪些可写），而且**完全离线**，零风险。它比任何在线探测都安全，信息量却更大。

---

## 一、先认文件类型

| 扩展名 | 产品 | 本质 | 怎么读 |
| --- | --- | --- | --- |
| `.ap16` / `.ap17` / `.ap19` | Siemens TIA Portal | **ZIP**（内含 SQLite） | `unzip` 后 sqlite3 |
| `.zap16` | TIA Portal（压缩归档） | ZIP（再套一层） | 先解压再按上面处理 |
| `.L5X` | Rockwell Studio 5000 | **XML**（明文） | 直接 grep / xmllint |
| `.L5K` | Rockwell（文本格式） | 文本 | 直接读 |
| `.ACD` | Rockwell（二进制） | 专有二进制 | 需 Studio 5000 导出成 L5X |
| `.MCP` | Siemens WinCC | 专有 + 伴随 `.db` | 看伴随目录 |
| `.IFD` / `.PDB` | GE iFIX | 专有 | 需 iFIX 导出 |
| `config.idb` | Ignition | **SQLite** | sqlite3 |
| `.CTZ` | Schneider Citect | ZIP/专有 | 先试 unzip |
| `.S7P` / `.S7D` | 老 Siemens S7 | 二进制 | 需 STEP7 |

**第一步永远是 `file`**：

```bash
file project.ap16 project.L5X project.ACD
# 输出 "Zip archive data" → 按 zip 处理
# 输出 "XML 1.0 document" → 直接读
# 输出 "data" / "SQLite 3.x database" → 分别处理
```

---

## 二、TIA Portal（`.ap16`）—— 本质是 ZIP + SQLite

```bash
mkdir -p tia && cd tia
unzip -o ../project.ap16
find . -type f | head -30
```

典型结构：

```text
ProjectFiles/
  *.db                    ← SQLite，工程主数据库
  UserFiles/              ← HMI 画面、脚本
  System/                 ← 系统配置
```

```bash
# 找所有 db
find . -name "*.db" -exec sh -c 'echo "=== $1 ==="; sqlite3 "$1" ".tables"' _ {} \;
```

**关键表**（各版本表名有差异，用 `.tables` 先看）：

```sql
-- 典型表名（可能带前缀）
SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%Block%';
SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%Tag%';

-- PLC 程序块
SELECT * FROM ProgramBlocks LIMIT 5;

-- Tag 定义（最关键的：哪些 Tag 可写、类型是什么）
SELECT Name, DataType, Comment FROM Tags LIMIT 20;

-- HMI 画面绑定的 Tag（决定「HMI 能操作什么」）
SELECT * FROM HmiTags LIMIT 20;
```

**从 TIA 项目里要提取什么**：

```text
□ Tag 清单 + 数据类型 + 注释（注释常直接说明用途，如"3号泵启动"）
□ 哪些 Tag 是 Input（只读）/ Output（可写）/ InOut（读写）
□ HMI 画面绑定的 Tag（= 操作员能改的范围）
□ 联锁逻辑（在 SCL/LAD 代码块里搜 "interlock" / "permissive" / "ESD"）
□ 硬编码凭据（连接数据库/HMI 的字符串）
```

```bash
# 在 SCL 源码里搜联锁与安全相关
grep -riE "interlock|permissive|emergency|ESD|SIL" ProjectFiles/ | head -20

# 搜硬编码凭据
grep -riE "password|pwd|connectionstring|userid" ProjectFiles/UserFiles/ | head -10
```

---

## 三、Rockwell Studio 5000（`.L5X`）—— 明文 XML，最容易读

```bash
# L5X 是 XML，结构清晰。先看顶层
head -50 project.L5X
```

关键元素：

```xml
<RSLogix5000Content>
  <Controller Use="Context" Name="MainPLC">
    <Tags>
      <Tag Name="Valve_3_Position" TagType="Base" DataType="REAL" ...>
        <Description>3号阀开度设定值</Description>   <!-- 注释常有语义 -->
      </Tag>
    </Tags>
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <Rung Number="0" Type="N">
              <Text>XIC(Start_PB)OTE(Pump_Run)</Text>   <!-- 梯形图逻辑 -->
            </Rung>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>
```

```bash
# 提取全部 Tag + 描述（这一条最有价值）
python3 - <<'PY'
import xml.etree.ElementTree as ET
t = ET.parse("project.L5X")
for tag in t.iter("Tag"):
    name = tag.get("Name")
    desc = tag.findtext("Description") or ""
    dtype = tag.get("DataType")
    print(f"{name:30} {dtype:10} {desc}")
PY

# 找联锁（在梯形图文本里）
grep -oE '<Text>[^<]*(XIO|XIC|OTL|OTU)[^<]*</Text>' project.L5X | grep -iE "interlock|permit|safety" | head
```

**L5X 的优势**：明文，不需要任何专有软件。**这是所有工程文件里最容易分析的格式** ——
如果能拿到 L5X，优先用它，不要去啃 ACD。

**`.ACD` 怎么办**：它是二进制，需要 Studio 5000 或 RSLogix 打开后「另存为 L5X」。
没有软件时只能 `strings` 粗看：

```bash
strings project.ACD | grep -iE "setpoint|interlock|valve|pump|recipe" | head -20
# 判据：能看出工艺语义的词说明 Tag 名是明文存储的
```

---

## 四、Ignition（`config.idb`）—— SQLite，直接读

```bash
sqlite3 config.idb ".tables"
```

```sql
-- 关键表
SELECT * FROM sqlth_partitions LIMIT 5;          -- 历史分区
SELECT * FROM sqlth_te;                          -- Tag 引擎
SELECT name FROM sqlite_master WHERE type='table';
```

Ignition 的工程结构在 `data/projects/<name>/` 下（不是 idb 里）：

```bash
ls data/projects/
# 每个项目下：ignition/ 下有 named-query/、script-python/（Jython 脚本）
find . -name "*.py" -o -name "*.xml" | head -20
grep -riE "password|connectionString" . | head -10
```

---

## 五、SCADA 工程目录（WinCC / iFIX / Citect）

### WinCC

```text
<项目名>.MCP           ← 主项目文件（专有）
<项目名>/              ← 伴随目录
  ScriptLib/           ← C 脚本（.pas / .bmo）
  Global Script/       ← 全局动作
  TagLogging/          ← 历史配置
  *.db                 ← SQL Server 或 SQLite
```

```bash
# WinCC 的脚本是 C 风格，直接搜
grep -riE "SetTag|GetTag|Password|Login" "项目名/ScriptLib/" | head -20
```

### iFIX

```text
*.IFD    ← 画面
*.PDB    ← 过程数据库（Tag 定义）
*.CSV    ← 常有导出的 Tag 清单
```

```bash
# PDB 可以用 iFIX 的导出工具；没工具时 strings 粗看 Tag 名
strings process.PDB | grep -E "^[A-Z][A-Za-z_]{3,20}$" | head -30
```

### Citect

```text
*.CTZ    ← 编译后的项目（ZIP 或专有）
*.DBF    ← 表（Tag 定义、报警配置）
```

```bash
# DBF 可以用 python 读
python3 -c "
from dbfread import DBF
for r in DBF('tags.dbf'): print(r)
"
```

---

## 六、从工程文件反推攻击面（这一步决定报告质量）

拿到工程文件后，**不是"看完了"就完事**，要产出一张表：

| Tag 名 | 类型 | 语义 | 可写吗 | 影响 |
| --- | --- | --- | --- | --- |
| `Valve_3_SP` | REAL, Output | 3号阀开度设定值 | HMI 可写 | **工艺偏移（阀门动作）** |
| `Pump_Run` | BOOL, Output | 主泵启停 | HMI 可写 | **启停设备** |
| `Interlock_Override` | BOOL, Output | 联锁旁路 | PLC 内部可写 | **绕过安全保护（最高危）** |
| `Tank_Level` | REAL, Input | 液位（只读） | 否 | 无（但改它值会误导操作员） |
| `Alarm_HH_Setpoint` | REAL, Output | 高高报阈值 | 工程师可写 | **让报警失效（掩盖事故）** |

**判据**：
- 「HMI 可写」+ 「联锁/旁路/阈值」= 最高危（改它 = 绕过安全保护）
- 「HMI 可写」+ 「设定值」= 高危（工艺偏移）
- 「只读」= 改它无意义，但**篡改显示值**（Manipulation of View）会误导操作员

---

## 七、常见坑

1. **`.ap16` 直接当文本打开会看到乱码** —— 它是 ZIP。先 `file` 再 `unzip`。
2. **TIA 的 db 表名随版本变** —— V15 和 V17 的表名不一样。用 `.tables` 看，不要硬编码。
3. **L5X 可能很大（几十 MB）** —— `ElementTree` 读全量会占几百 MB 内存。用 `iterparse` 流式。
4. **`.ACD` 里 strings 看到的不一定是 Tag** —— 可能是注释、错误信息。要交叉验证。
5. **SCADA 工程目录常在「文档」而非「程序」目录** —— `C:\Users\<user>\Documents\` 下比
   `C:\Program Files\` 更常见（工程师习惯）。
6. **工程文件的时间戳是金矿** —— `mtime` 能看出「上次谁改的、什么时候改的」。
   改过逻辑但没走变更流程 = 可能是前人留的后门。
7. **不要改工程文件的原件** —— 复制一份再分析。改了原件会让对方下次编译时发现异常。