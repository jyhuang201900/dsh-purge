# EMBA 自动化固件分析：装、跑、读结果、剔误报

> 被 `firmware-pentest` 引用。EMBA 是"固件界的扫描器"，它给的是**候选清单**，
> 不是结论。会用的人拿它做索引，不会用的人被它的 200 页报告淹死。

## 一、EMBA 是什么、不做什么

| 做 | 不做 |
| --- | --- |
| 解包、识别 OS、列服务、提 CVE 候选 | 证明漏洞可利用 |
| 找硬编码密钥/证书/口令 | 判断凭据是否真的被使用 |
| 查二进制加固（NX/PIE/RELRO/Canary） | 反编译、找逻辑漏洞 |
| 生成 HTML/JSON 报告 | 仿真、动态验证 |
| 比对已知 CVE 数据库 | 判断误报 |

**结论**：EMBA 的输出是**下一步要手工验证的清单**。

## 二、安装（Docker 优先，避免污染宿主）

```bash
# 方式 1：Docker（推荐）
docker pull embeddedanalytics/emba:latest
docker run --rm -it -v "$(pwd)":/workspace \
  embeddedanalytics/emba:latest \
  -l /workspace/logs -f /workspace/firmware.bin -p /workspace/scan-profiles/default-scan.emba

# 方式 2：源码安装（需要 root，会装一堆依赖）
git clone https://github.com/e-m-b-a/emba.git
cd emba
sudo ./installer.sh -d    # -d 是默认安装（含 docker 依赖）
sudo ./emba -l ./logs -f ./firmware.bin -p ./scan-profiles/default-scan.emba

# 方式 3：只跑静态（跳过 QEMU 仿真，快很多；具体 flag 用 -h 确认）
sudo ./emba -l ./logs -f ./firmware.bin -p ./scan-profiles/default-scan.emba -s
#   -s = 精简/跳过动态模块（各版本含义略有差异，先 -h）
```

**依赖检查**：

```bash
./emba -h | head -40        # 看参数
which binwalk unsquashfs cve-bin-tool checksec
```

## 三、关键参数（只列确认过的，其余用 `-h` 现查）

| 参数 | 作用 | 建议 |
| --- | --- | --- |
| `-l <dir>` | 日志/报告输出目录 | 必须有，且为空目录 |
| `-f <file>` | 固件路径 | 绝对路径 |
| `-p <profile>` | 扫描配置 | `default-scan.emba` 起步 |
| `-d` | 只做依赖检查后退出 | 首次跑先执行一次，确认没缺工具 |
| `-h` | 帮助 | **参数以本机 `-h` 输出为准**，版本间有差异 |

> EMBA 的参数在版本间会变（`-s`/`-t`/`-W` 在不同版本含义不同）。
> 不要凭记忆写参数，先 `./emba -h`，把确认过的参数记进任务日志再执行。

**Profile 的选择**：

```bash
ls scan-profiles/
# default-scan.emba        全量，最慢
# default-scan_slow.emba   更深的二进制分析
# quick-scan.emba          快速版，适合先摸底
# 具体文件名以本机 ls 结果为准
```

## 四、跑一次最小可用扫描

```bash
mkdir -p ~/fw/logs
sudo ./emba -l ~/fw/logs -f ~/fw/firmware.bin \
  -p ./scan-profiles/quick-scan.emba

# 跑之前先确认 profile 真实存在（名字会变）
ls ./scan-profiles/ | grep -i quick

# 中途看进度
tail -f ~/fw/logs/emba.log

# 完成后看目录结构（以本机实际输出为准）
ls ~/fw/logs/
# csv_logs/       结构化结果（最有用）
# html-report/    HTML 报告
# fw/             解包后的文件系统
# emba_logs/      各模块原始日志
```

**典型耗时**：精简静态扫描十几分钟到半小时，全量含动态 1~3 小时（取决于固件大小与 CPU 核数）。

## 五、读结果的正确顺序

**不要从 HTML 报告第一页开始读**，按下面顺序：

```bash
# ① 先看"这是什么"
cat ~/fw/logs/csv_logs/*/FW_*.csv 2>/dev/null | head
# 或
jq . ~/fw/logs/json_logs/*/fw_metadata.json 2>/dev/null | head -40

# ② 再看服务与端口（决定攻击面）
column -s, -t ~/fw/logs/csv_logs/*/S*.csv 2>/dev/null | head -40
# 关注：监听 0.0.0.0 的服务、telnet/ftp/tftp、调试接口

# ③ 再看 CVE（候选，不是结论）
ls ~/fw/logs/csv_logs/*/ | grep -i cve
column -s, -t ~/fw/logs/csv_logs/*/CVE_*.csv 2>/dev/null | head -40

# ④ 密钥/证书/口令
column -s, -t ~/fw/logs/csv_logs/*/P*.csv 2>/dev/null | head -40
grep -riE 'password|private key' ~/fw/logs/csv_logs/ | head -20

# ⑤ 二进制加固
column -s, -t ~/fw/logs/csv_logs/*/S10_*.csv 2>/dev/null | head -30
```

### 5.1 CVE 报告怎么读

```bash
# 找到 CVE 明细
find ~/fw/logs -name 'CVE_*' -o -name '*cve*' | head
```

CSV 通常包含：`binary, version, CVE, CVSS, description, file path`。

**关键判断**：

| 字段 | 怎么用 |
| --- | --- |
| `version` | **必须和实际二进制版本核对**（EMBA 靠 strings 猜版本，经常猜错） |
| `CVSS` | ≥ 7.0 才值得优先看 |
| `binary path` | 是否在**网络可达**的服务里（`/usr/sbin/httpd` 比 `/usr/bin/foo` 值钱） |
| `description` | 是不是"需要本地访问"、"需要特定配置" |

```bash
# 核对版本（这一步不能省）
strings ~/fw/logs/fw/rootfs/usr/sbin/httpd | grep -iE 'version|v[0-9]+\.[0-9]+'
~/fw/logs/fw/rootfs/usr/sbin/httpd --version 2>&1 | head -3
# 或查包管理元数据
cat ~/fw/logs/fw/rootfs/etc/*release* 2>/dev/null
find ~/fw/logs/fw/rootfs -name '*.ipk' -o -name 'opkg' | head
```

### 5.2 密钥/证书报告

```bash
# EMBA 会提取 PEM/私钥并尝试解析
find ~/fw/logs -path '*cert*' -o -path '*key*' | head
# 验证是真私钥
openssl rsa -in candidate.pem -check -noout 2>&1
openssl pkey -in candidate.pem -pubout 2>&1 | head -3

# 验证证书链
openssl x509 -in cert.pem -text -noout | head -20
```

### 5.3 二进制加固报告

```bash
column -s, -t ~/fw/logs/csv_logs/*/S10_*.csv | head -30
# 列通常有：binary, NX, PIE, RELRO, Canary, Fortify, Symbols
```

**判据**：`NX=No` + `PIE=No` + `Canary=No` 的**网络服务**二进制 = 栈溢出直接可控，
优先级最高。反过来 `Full RELRO + PIE + Canary` 的路径可以放后面。

## 六、哪些结果值得手追（按优先级）

| 优先级 | 结果类型 | 为什么 |
| --- | --- | --- |
| P0 | 网络服务的 `NX=No` + 已知 CVE | 直接可利用 |
| P0 | `telnetd` / `dropbear` 的默认口令 | 直接登录 |
| P0 | 私钥（能解析） | 可解密流量/伪造签名 |
| P1 | CGI 里的命令注入字符串（`system(`、`popen(`） | 常有洞 |
| P1 | 未授权 API（`/api/` 路径、`*.cgi`） | 直接打 |
| P1 | 硬编码的云 API key | 横向到云 |
| P2 | 过期的 CA/证书 | 中间人可行 |
| P2 | 弱哈希（MD5 存口令） | 可离线破解 |
| P3 | 内核版本旧 | 需要本地前提，优先级低 |
| P3 | 未使用的库有 CVE | 不可达，忽略 |

```bash
# 快速找命令注入候选
grep -rl 'system(' ~/fw/logs/fw/rootfs/usr/sbin/ 2>/dev/null | head
strings ~/fw/logs/fw/rootfs/usr/sbin/httpd | grep -E 'system|popen|execve|/bin/sh'

# 找 CGI
find ~/fw/logs/fw/rootfs -name '*.cgi' -o -path '*/cgi-bin/*' | head -20
```

## 七、常见误报（必须自己排除）

| 误报类型 | 表现 | 排除方法 |
| --- | --- | --- |
| **版本号猜错** | strings 里有多个 `1.2.3`，EMBA 选了错的 | 手工 `--version` / 查 changelog |
| **库存在但没链接** | 报告说 `libfoo 1.0` 有 CVE，但服务没链接它 | `readelf -d binary \| grep libfoo` |
| **二进制存在但没启动** | 报告列了 `telnetd` 的 CVE，但 init 里没启动它 | 查 `inittab` / `rcS` / `systemd/*.service` |
| **CVE 需要特殊配置** | 报告说可 RCE，实际需要 `enable_debug=1` | 读 CVE 描述 + 查固件配置 |
| **私钥是测试密钥** | 提取出私钥但只在工厂测试用 | 查私钥引用的代码路径 |
| **"password" 字符串是提示文案** | `strings` 里 `password` 实际是 UI 文案 | 看上下文（前后 50 字节） |
| **证书是公共 CA 的** | 报告"发现证书"，其实是系统 CA bundle | 看路径 `/etc/ssl/certs/` |
| **CVE 已 backport 修复** | 版本号未变但补丁已打 | 查发行版 changelog / 反汇编比对 |

```bash
# 排除"存在但没启动"的最快方法
cat ~/fw/logs/fw/rootfs/etc/inittab 2>/dev/null
ls ~/fw/logs/fw/rootfs/etc/init.d/ ~/fw/logs/fw/rootfs/etc/rc.d/ 2>/dev/null
grep -rn 'telnetd\|httpd\|upnp' ~/fw/logs/fw/rootfs/etc/ 2>/dev/null | head
```

## 八、EMBA 结果的"验伤"

EMBA 的结论本身不算证据，必须补一步：

| EMBA 说 | 你要补的证据 |
| --- | --- |
| "binary X 有 CVE-2023-1234" | 在仿真里发一个能触发崩溃的请求，或证明版本确实受影响 |
| "发现私钥" | `openssl` 能解析 + 找到引用它的代码/配置 |
| "hardcoded password: admin123" | 用它在仿真设备上登录成功 |
| "服务 telnetd 监听 23" | `nmap -p23` 打到 banner，或仿真里 `telnet` 进去 |
| "NX disabled" | `checksec` 复核 + 如果能，构造一个最小栈溢出证明 PC 可控 |

## 九、检测视角（防守方）

| 场景 | 检测 |
| --- | --- |
| 固件被批量扫描 | 无（离线行为） |
| 扫描结果的结论被用于攻击 | 看设备侧的登录失败日志、异常请求 |
| 固件本身的质量问题 | 把 EMBA 纳入 CI：出厂前跑一遍，P0/P1 项必须清零 |

## 十、常见坑

1. **日志目录非空会失败**。EMBA 要求 `-l` 指向空目录或加 `-r` 清理。
2. **Docker 里路径必须挂载**。`-f /workspace/firmware.bin` 而不是宿主路径。
3. **`-s` 跳过的模块可能正好是你要的**。跳过仿真后就没有"服务能否启动"的结论。
4. **CVE 匹配基于 strings 猜的版本**。这是最大的误报源，必须人工核对。
5. **报告里的路径是容器内的**。Docker 模式下 `/log/...` 对应宿主挂载点。
6. **EMBA 会改文件权限**。跑完 `~/fw/logs/fw/` 里的文件可能属主变成 root，
   后续手工操作前 `chown -R $USER`。