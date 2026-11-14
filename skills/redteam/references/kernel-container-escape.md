# 内核与容器逃逸：版本判定、CVE 类、前置条件与验伤

> 被 `competition-kernel-container-escape` 引用。逃逸的难点不在"有没有 exp"，
> 而在**前置条件是否齐、打完之后怎么证明越过了边界**。

## 一、先判定内核身份与补丁状态

```bash
uname -a
cat /proc/version
cat /etc/os-release
# 发行版补丁级别（比 upstream 版本号更重要）
rpm -qa --last | grep -i kernel | head          # RHEL/CentOS
dpkg -l | grep -E 'linux-image|linux-generic'   # Debian/Ubuntu
apt list --installed 2>/dev/null | grep linux-image

# 内核配置（很多 exp 依赖某个编译开关）
zcat /proc/config.gz 2>/dev/null | grep -E 'CONFIG_(USER_NS|NF_TABLES|IO_URING|OVERLAY_FS|KALLSYMS|BPF|FUSE)'
ls /boot/config-$(uname -r) && grep -E 'CONFIG_(USER_NS|NF_TABLES|IO_URING|OVERLAY_FS)' /boot/config-$(uname -r)

# 已加载模块 / 可用模块
lsmod | head -20
cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null   # Debian 系
cat /proc/sys/kernel/unprivileged_bpf_disabled 2>/dev/null
cat /proc/sys/kernel/kptr_restrict /proc/sys/kernel/dmesg_restrict
```

**判据表**（逃逸可行性）：

| 条件 | 值 | 影响 |
| --- | --- | --- |
| `unprivileged_userns_clone` | 1 | 大多数内核 CVE 可在容器内自建 user ns 触发 |
| `CONFIG_USER_NS` | y | 同上；为 n 时大量 exp 直接不可用 |
| `Seccomp` | 0 或无 `clone`/`unshare` 过滤 | 可建 ns；被拦时 exp 会在 `unshare` 处 EPERM |
| `kptr_restrict` | 0 | 可读内核符号地址，KASLR 绕过更容易 |
| `dmesg_restrict` | 0 | 能看 oops 信息，便于调试 exp |
| LSM | AppArmor/SELinux  enforcing | 限制 mount、`/proc/sys` 写 |

## 二、CVE 类与判定方法（按"能不能在容器里触发"分类）

### 2.1 文件系统 / 页缓存类

**Dirty Pipe（CVE-2022-0847，5.8 ≤ kernel < 5.16.11 / 5.15.25 / 5.10.102）**

```bash
# 判定
uname -r
# 前置：无需特权，只需能读目标文件（只读文件也可写）
# 特征：可覆写 page cache，不改 mtime、不改文件大小 → 极隐蔽
# 容器内可用：只要内核未打补丁，且目标文件在容器可见的挂载内（含只读 bind mount）
```

利用要点（不贴完整 exp，说明判定链）：
1. 打开目标文件 `O_RDONLY`；
2. `splice()` 一字节到 pipe 制造 `PIPE_BUF_FLAG_CAN_MERGE`；
3. 再 `write()` 到 pipe，数据落到 page cache 对应 offset。

**成功标志**：`/etc/passwd` 里的 root 口令字段被改写后 `su` 能进；或 SUID 程序的字节被改。
**失败原因**：目标 offset 落在页边界（不能跨页写）、文件系统不支持 splice、内核已补。

**overlayfs 类（CVE-2021-3493 Ubuntu、CVE-2023-0386）**

```bash
# CVE-2023-0386：overlayfs 拷贝 up 时未校验 setuid → 容器内可造 SUID root 文件到宿主
# 前置：内核 6.2 之前的未修复版本（各发行版 backport 时间不同），需 overlayfs 可挂 + user ns
# 判定
grep overlay /proc/filesystems
uname -r
# 容器内检测：能否 unshare -Ur -m 成功
unshare -Ur -m sh -c 'id; mount -t overlay overlay -o lowerdir=/l,upperdir=/u,workdir=/w /m'
```

**成功标志**：在宿主路径（如 `hostPath` 挂的目录）出现 `-rwsr-xr-x root root` 文件，
且宿主上执行它得到 `uid=0`。

### 2.2 网络子系统类

**nf_tables（CVE-2023-32233 / CVE-2024-1086）**

```bash
# 前置：CAP_NET_ADMIN（很多容器默认不给，需要 unshare -Urn 自建 net ns）
capsh --print | grep net_admin
unshare -Urn sh -c 'nft list ruleset'   # 能跑说明 nf_tables 可用

# CVE-2023-32233：nftables 批量替换时的 UAF → 内核 LPE
# CVE-2024-1086：nf_tables 双重释放 → 本地提权（影响 5.14 ~ 6.6 系列，各发行版 backport 不同）
```

**成功标志**：在容器内 `id` 变成 `uid=0`，且该 root 是**宿主命名空间**的 root
（能 `cat /proc/1/root/etc/shadow`，`/proc/1/ns/pid` 与宿主的相同）。

**失败原因**：`CAP_NET_ADMIN` 缺失且 userns 被禁（`unprivileged_userns_clone=0`）；
内核已 backport 补丁（发行版版本号没变但已修）；`nft` 二进制在容器里不存在
（可以静态编译带入，或用 `setsockopt` 直接构造 netlink）。

**CVE-2022-32250 / CVE-2022-1015**（nf_tables 越界写）：同类前置，判定方式一致。

### 2.3 io_uring 类

```bash
# 判定
cat /proc/sys/kernel/io_uring_disabled 2>/dev/null   # 2 = 完全禁用
ls /proc/sys/kernel/ | grep io_uring
grep CONFIG_IO_URING /boot/config-$(uname -r)

# 相关 CVE：CVE-2021-41073、CVE-2022-29582、CVE-2023-0461（UAF 类）
# 前置：通常需要能创建 io_uring 实例（seccomp 常拦 io_uring_setup）
```

**成功标志**：稳定提权到 root 且不掉内核；**注意** io_uring 类 exp 很多只做到 UAF，
实际利用需要堆喷（msg_msg、pipe_buffer）配合，成功率低，容易 panic。

### 2.4 其它高频类

| CVE | 类型 | 内核范围 | 容器内前置 |
| --- | --- | --- | --- |
| CVE-2022-0185 | fs_context 堆溢出 | 5.1 ~ 5.16 | `CAP_SYS_ADMIN` 或 userns + 能 `fsconfig` |
| CVE-2021-22555 | netfilter 堆溢出 | 2.6.19 ~ 5.12 | userns + `CAP_NET_ADMIN` |
| CVE-2022-0492 | cgroup release_agent 提权 | < 5.16 | userns + cgroup v1 可写 |
| CVE-2023-2640/32629 | Ubuntu overlayfs | Ubuntu 特定内核 | 能挂 overlay |
| CVE-2024-21626 | runc fd 泄漏（非内核） | runc ≤ 1.1.11 | 见运行时篇 |

> **上表的内核范围只用于初筛，不能当判据**。发行版 backport 会让"版本号在新范围内
> 但已修复"成为常态。最终判定必须查该发行版的 changelog：
> `apt changelog linux-image-$(uname -r) | grep -i cve` 或
> `rpm -q --changelog kernel-$(uname -r) | grep -i cve`。

## 三、"看起来能逃"其实不能：先排除配置型假象

很多人把**配置型逃逸**误当成内核漏洞。分清这两类，报告才不会写错根因：

| 现象 | 真实原因 | 是否需要内核 CVE |
| --- | --- | --- |
| `cat /proc/1/root/etc/shadow` 成功 | hostPID/hostMount 配置 | 否 |
| `nsenter -t 1` 进宿主 | privileged + hostPID | 否 |
| 挂载 `/dev/sda1` 成功 | privileged 或 CAP_SYS_ADMIN | 否 |
| 写 `release_agent` 成功 | cgroup v1 + CAP_SYS_ADMIN | 否 |
| `unshare -Ur` 后仍 uid 0 但看不到宿主 | user ns 内 root，**不是宿主 root** | 否 |

**关键判据**：宿主 root 的标志是能看到**宿主命名空间**的对象——
`/proc/1/cmdline` 是 `systemd` 或 `kubelet`，`/proc/1/ns/pid` 与容器内不同，
`ls /proc/1/root/var/lib/kubelet` 有内容。user ns 里的 root 看这些全是权限拒绝。

## 四、执行纪律（避免把节点打挂）

```bash
# 1) 先备份关键状态，便于事后证明和恢复
uname -a > /tmp/before.txt; cat /proc/self/status >> /tmp/before.txt
id >> /tmp/before.txt; ls -l /proc/1/ns >> /tmp/before.txt

# 2) exp 先在本地同版本内核的 VM 里跑通（这是硬要求）
#    容器内直接跑未验证 exp，panic 概率极高，节点重启 = 事故

# 3) 限制 panic 影响（如果环境允许）
cat /proc/sys/kernel/panic_on_oops
# 评估中不要修改宿主 sysctl，这是越界
```

**红线**：不要在有业务负载的节点上直接跑未验证的内核 exp。CTF/靶场可以，
生产评估必须先有书面允许 + 维护窗口。

## 五、检测视角

| 手法 | 日志/信号 | 特征 |
| --- | --- | --- |
| unshare/userns | auditd `SYSCALL=unshare` | 容器内进程建 user+mount ns；Falco `Unprivileged Delegation` |
| nf_tables 异常 | auditd netlink、dmesg | 大量 `nft` netlink 消息后紧跟 oops |
| 内核 oops/panic | `dmesg`、`/var/log/kern.log` | `BUG: unable to handle kernel paging request` |
| Dirty Pipe | 文件完整性 | 关键文件 mtime 不变但 hash 变了（page cache 被改） |
| overlayfs 提权 | auditd | 容器内 `mount -t overlay`，宿主出现 SUID 文件 |
| io_uring | seccomp/audit | `io_uring_setup` 调用（默认策略常拦） |
| 提权后落点 | Falco | 容器内进程 `uid=0` 且父进程是 exp；`/proc/1/root` 访问 |

```bash
# 快速自查（防守方视角）
dmesg -T | grep -iE 'oops|BUG:|general protection|UAF' | tail
ausearch -m SYSCALL -sc unshare -ts today 2>/dev/null | tail
grep -c 'apparmor="DENIED"' /var/log/syslog
```

## 六、验伤信号

| 声称 | 硬证据 | 假成功反例 |
| --- | --- | --- |
| 内核 LPE 成功 | 容器内 `id` = `uid=0`，且 `/proc/1/root/etc/shadow` 可读 | `unshare -Ur` 后 `id` 是 0，但 `/proc/1/root` 拒绝 → 只是 userns root |
| 越过 mount 边界 | 宿主路径出现新文件，宿主机上 `ls -l` 能看到 | 文件写在了 overlay upper 层，宿主看不到 |
| SUID 落点有效 | 宿主执行该文件 `id` = root | 文件有 s 位但挂载带 `nosuid` |
| 稳定（未 panic） | 提权后 5 分钟内系统正常、`dmesg` 无 oops | 提权成功但 30 秒后节点重启（延迟 panic） |
| 拿到宿主凭据 | 读到宿主 `/etc/shadow` 或 `/root/.ssh/id_rsa` | 读到的是容器内同名文件（先 `readlink /proc/1/root` 确认） |

**必做对偶**：逃逸前 `cat /proc/1/cmdline; readlink /proc/1/ns/{pid,mnt}`，
逃逸后再存一份，两份不同才算跨界。

## 七、常见坑

1. **把 user namespace root 当宿主 root**。这是最高频误判。`unshare -Ur` 后 `id` 是 0，
   但 `/proc/1/root`、`/proc/sys` 全拒绝。判定标准只有一条：能不能看宿主 ns 的对象。
2. **发行版版本号骗人**。`5.15.0-91-generic` 看起来旧，实际已 backport 补丁；
   反之定制内核可能版本号新但缺关键补丁。用 `apt changelog`/`rpm -q --changelog` 查具体 CVE。
3. **seccomp 静默拦 syscall**。exp 在 `clone3`/`unshare`/`io_uring_setup` 处 `EPERM`，
   表现为"exp 不工作"，不是内核已修。用 `strace -f` 确认哪一步被拒。
4. **CAP_NET_ADMIN 缺失**。nf_tables 类 exp 全部要求它；很多容器 drop 了。
   先 `capsh --print`，再决定是否走 userns 路线。
5. **exp 只在特定内核配置下稳定**。`CONFIG_SLAB_FREELIST_RANDOM`、`CONFIG_RANDOMIZE_BASE`
   会显著改变堆布局，同一 exp 在不同发行版成功率差异极大，必须先在目标同版本内核验证。
6. **panic 之后证据全丢**。节点重启会清 `/tmp`、`dmesg` 可能丢；先把 exp 输出
   `tee` 到持久化路径（如果环境允许），或用串口/带外日志。