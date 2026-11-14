# 固件仿真与模糊测试：FirmAE/QEMU、补依赖、fuzz 入口与取舍

> 被 `firmware-pentest` 引用。仿真的价值在于**能动态验证静态发现的凭据/服务**，
> 不在于"让固件跑起来"这个动作本身。跑不起来是常态，要能快速判断该不该继续。

## 一、先决定：要不要仿真（成本收益判断）

| 情况 | 建议 |
| --- | --- |
| 目标是 web 后台默认口令 | **值得**，仿真能直接登录验证 |
| 目标是一个文件解析器（如 `libupnp`） | **值得**，用户态 QEMU 就够 |
| 目标是内核驱动/硬件寄存器 | 通常**不值得**，仿真无法正确模拟外设 |
| 目标是加密芯片/安全启动 | **不值得**，逻辑在硬件里 |
| 固件是 ARM64 且依赖大量专有库 | 成本高，先做静态，必要时再仿真 |

**判据**：如果静态分析已经能给出"这个口令 + 这个 URL"，仿真只是为了出截图证明，
那就用最小代价（用户态 QEMU 跑单个 binary）而不是全系统。

## 二、架构识别（错一步后面全废）

```bash
# 从 ELF 头读架构
file rootfs/usr/sbin/httpd
readelf -h rootfs/bin/busybox | grep -E 'Class|Data|Machine'
# 输出示例：
#   Class: ELF32   Data: 2's complement, little endian
#   Machine: MIPS R3000  → mipsel
#   Machine: ARM        → arm (32) 或 aarch64

# 批量统计（决定用哪个 qemu）
find rootfs -type f -exec file {} \; 2>/dev/null | grep -oE 'MIPS|ARM|Intel 80386|x86-64|AArch64' | sort | uniq -c

# 内核架构（若无 ELF，看内核镜像）
binwalk -A firmware.bin | head -20
strings -n 8 kernel.bin | grep -iE 'mips|arm|Linux version'
```

**架构 → qemu 映射表**：

| ELF Machine | qemu 用户态 | qemu 全系统 | 备注 |
| --- | --- | --- | --- |
| MIPS R3000 LE | `qemu-mipsel` | `qemu-system-mipsel` | 路由器最常见 |
| MIPS R3000 BE | `qemu-mips` | `qemu-system-mips` | 少 |
| MIPS64 LE | `qemu-mips64el` | — | 高端设备 |
| ARM (32) LE | `qemu-arm` | `qemu-system-arm` | IoT 常见 |
| AArch64 | `qemu-aarch64` | `qemu-system-aarch64` | 现代设备 |
| x86-64 | 本机可跑 | `qemu-system-x86_64` | — |

## 三、用户态 QEMU：跑单个 binary（最快出结果）

```bash
# 1) 找 qemu 与静态库
which qemu-mipsel-static qemu-arm-static
# 没有就装
sudo apt install qemu-user-static binfmt-support

# 2) 直接跑（-L 指定 rootfs 作为 sysroot）
sudo chroot . qemu-mipsel-static /usr/sbin/httpd -h 2>&1 | head

# 若不在 chroot 里（推荐，避免污染）
qemu-mipsel-static -L rootfs/ rootfs/usr/sbin/httpd
qemu-arm-static -L rootfs/ rootfs/usr/bin/nvram get http_username

# 3) 带 strace 看缺什么库
qemu-mipsel-static -strace -L rootfs/ rootfs/usr/sbin/httpd 2>&1 | head -40
```

**缺库的补法**（这是 90% 的失败原因）：

```bash
# 看依赖
readelf -d rootfs/usr/sbin/httpd | grep NEEDED
# 在 rootfs 里找缺失的 .so
find rootfs -name 'libc.so*' -o -name 'libnvram*' -o -name 'libcmm*'

# 典型缺失：厂商私有库（libnvram.so / libcmm.so / libshared.so）
# 处理顺序：
#   1) rootfs 里其实有，只是路径不对 → 设置 LD_LIBRARY_PATH
#   2) 真的没有 → 找同型号其它固件，或从设备上 dd 出来
#   3) 只有 stub → 自己写 stub（返回 0 / 返回假数据）
qemu-mipsel-static -L rootfs/ -E LD_LIBRARY_PATH=/lib:/usr/lib:/lib/private \
  rootfs/usr/sbin/httpd

# 写 stub（示例：libnvram.so 的 nvram_get 返回固定值）
cat > stub_nvram.c <<'EOF'
char *nvram_get(const char *k){ return "admin"; }
int nvram_set(const char *k, const char *v){ return 0; }
EOF
mipsel-linux-gnu-gcc -shared -fPIC -o libnvram.so stub_nvram.c
```

**NVRAM 类固件的关键点**：大量服务启动时读 NVRAM（`nvram_get("http_username")`），
没有 NVRAM 库直接段错误。要么补库，要么 `LD_PRELOAD` 自己的 stub。

## 四、全系统仿真：FirmAE / Firmadyne / FAT

```bash
# FirmAE（Firmadyne 的改进版，成功率更高）
git clone --recursive https://github.com/pr0v3rbs/FirmAE
cd FirmAE && ./download.sh && sudo ./install.sh
sudo ./run.sh -c <brand> -a <arch> -m <dir> firmware.bin    # 带网络
sudo ./run.sh -d <brand> -a <arch> firmware.bin             # debug 模式
# 输出：./scratch/<n>/ 下有 qemu 命令行、日志、网络配置
cat ./scratch/*/qemu.final.serial.log | tail -40

# Firmadyne（老但稳）
sudo ./fat.py firmware.bin
# 产物：images/<n>/ 与 qemu 启动脚本

# 纯手工 QEMU（可控性最好，但配置量大）
qemu-system-mipsel -M malta -kernel vmlinux -hda rootfs.img \
  -append "root=/dev/sda console=ttyS0" -nographic \
  -netdev user,id=n1,hostfwd=tcp::8080-:80 -device e1000,netdev=n1
```

**全系统仿真失败的三类原因**：

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 卡在 `Uncompressing Linux...` | 内核加载地址/机器类型不对 | 用 `-M` 换 machine，或 `-append` 改 `console=` |
| 内核 panic: `VFS: Unable to mount root fs` | rootfs 设备名错（`/dev/sda1` vs `/dev/mtdblock2`） | 改 `-append root=` |
| 启动到 init 就停 / 反复重启 | 缺 NVRAM / 硬件检测失败 / watchdog | 改 init 脚本，或 patch 掉硬件检查 |

```bash
# 快速看卡在哪
tail -f ./scratch/*/qemu.final.serial.log
# 进 initramfs 抢救
# -append 里加 "init=/bin/sh" 或 "rdinit=/bin/sh"
```

## 五、Fuzzing：先选入口，再选工具

### 5.1 入口分类（决定用哪种 fuzz）

| 入口类型 | 例子 | 工具 | 准备成本 |
| --- | --- | --- | --- |
| 网络服务（HTTP/UPnP/自定义 TCP） | `httpd`、`upnpd` | AFL++ + 网络 harness，或直接 `boofuzz` | 中 |
| 文件解析（配置/证书/上传） | `*.cfg` 解析、图片解码 | AFL++ 文件模式 | 低 |
| CGI 参数 | `/cgi-bin/*.cgi` | HTTP fuzz（wfuzz/ffuf）+ 崩溃监控 | 低 |
| ioctl/驱动 | 需真实硬件 | 通常不做 | 高 |

### 5.2 AFL++ 跑单个 binary（用户态 QEMU 模式）

```bash
# 1) 插桩编译（有源码时）
afl-clang-fast -o httpd_afl httpd.c

# 2) 无源码时用 QEMU 模式
afl-fuzz -Q -i in/ -o out/ -- qemu-mipsel-static -L rootfs/ rootfs/usr/sbin/httpd -f @@

# 3) 有源码时标准模式
afl-fuzz -i in/ -o out/ -m none -- ./httpd_afl @@

# 4) 崩溃复现
afl-showmap -Q -o /tmp/map -- qemu-mipsel-static -L rootfs/ rootfs/usr/sbin/httpd -f crash_file
```

```bash
# 造种子（不要给空文件）
mkdir -p in/
printf 'GET / HTTP/1.0\r\n\r\n' > in/http_basic
printf 'POST /cgi-bin/x HTTP/1.0\r\nContent-Length: 4\r\n\r\nAAAA' > in/http_post
# 从固件里的真实配置摘样本（最有价值）
cp rootfs/etc/httpd.conf in/conf_sample
```

### 5.3 网络服务 fuzz（boofuzz，适合协议型）

```python
# fuzz_http.py —— 最小可用模板
from boofuzz import *
session = Session(target=Target(connection=TCPSocketConnection("127.0.0.1", 8080)))
s_initialize("req")
s_string("GET")
s_delim(" ")
s_string("/")
s_delim(" ")
s_static("HTTP/1.0")
s_static("\r\n\r\n")
session.connect(s_get("req"))
session.fuzz()
```

```bash
pip install boofuzz
# 先确保服务在仿真环境里跑起来并监听
qemu-mipsel-static -L rootfs/ rootfs/usr/sbin/httpd -p 8080 &
python3 fuzz_http.py
```

### 5.4 崩溃判定（必须能自动区分）

```bash
# 用户态 QEMU 的崩溃信号
qemu-mipsel-static -L rootfs/ rootfs/usr/sbin/httpd -f crash 2>&1 | grep -E 'Segmentation|signal|SIGSEGV'
echo $?     # 139 = SIGSEGV, 134 = SIGABRT

# 用 core dump 定位（qemu-user 支持）
ulimit -c unlimited
qemu-mipsel-static -L rootfs/ -g 1234 rootfs/usr/sbin/httpd -f crash &
gdb-multiarch rootfs/usr/sbin/httpd -ex 'target remote :1234' -ex 'bt' -ex 'info registers'
```

**崩溃 vs 正常退出**：

| 返回码 | 含义 | 是否值得追 |
| --- | --- | --- |
| 139 (SIGSEGV) | 段错误 | 值得 |
| 134 (SIGABRT) | assert/堆损坏 | 值得 |
| 136 (SIGFPE) | 除零 | 可能 |
| 0 / 1 | 正常/参数错误 | 不值得 |
| 124 (timeout) | 挂起 | 单独记（DoS 类） |

## 六、取舍：什么该深追，什么该放弃

**值得深追**：
- 崩溃 PC 落在 `strcpy`/`memcpy`/`sprintf` 附近 → 溢出可控
- 崩溃输入可读（能找到 offset）→ 能构造 payload
- 崩溃可稳定复现 3 次以上
- 崩溃点在**网络可达**路径上

**放弃**：
- 崩溃需要本地文件写权限（固件里不可达）
- `-f` 参数触发的崩溃（启动时解析一次，无法远程）
- 崩溃点是 `free()` 里（堆损坏但难利用）
- 只在 QEMU 里崩、真机不崩（QEMU 的 syscall 实现差异导致的假崩溃）

```bash
# 判定"真机也会崩"：同一输入在真机/仿真各跑一次
# 若仿真崩真机不崩，多半是 QEMU 的 syscall 语义差异，不是漏洞
```

## 七、检测视角

| 手法 | 信号 |
| --- | --- |
| 设备被仿真 | 无（离线行为），但设备上出现**同 MAC/同序列号**的另一实例会触发云端告警 |
| 固件被 fuzz | 设备侧无日志，云侧可看"同型号设备异常重启/崩溃上报" |
| 通过仿真登录 | 设备的云管平台会看到登录 IP 与设备实际 IP 不符（仿真环境出口 IP 不同） |

## 八、验伤信号

| 声称 | 硬证据 | 假成功反例 |
| --- | --- | --- |
| 仿真成功 | 能 `curl` 到仿真服务的真实页面（含设备型号字符串） | QEMU 进程在跑但端口没监听 |
| 用默认口令登录成功 | 返回 `200` + 后台首页 HTML，且能执行一个需登录的操作 | 返回 `200` 但是登录页（只是重定向没跟随） |
| fuzz 找到崩溃 | 崩溃输入可复现，`gdb bt` 显示栈上可控数据 | 输入导致的 `assert`（不可利用） |
| 崩溃可利用 | 能控制 PC 或至少控制一个寄存器 | 只是 NULL 解引用 |

## 九、常见坑

1. **架构判错**。`mipsel` 用 `qemu-mips` 跑会报 `Invalid ELF image for this architecture`，
   这是最常见的第一步失败。
2. **`-L` 指向的不是 rootfs 根**。必须是包含 `/lib` 的那一层，不是解包目录的父目录。
3. **私有库缺失时直接放弃**。其实写 20 行 stub 就能跑起来，优先试这个。
4. **全系统仿真一跑就是几十分钟**。先用用户态 QEMU 验证单个服务，全系统只在必要时用。
5. **FirmAE 的 `-a` 架构参数写错**。`mipsel` / `mips` / `armel` / `armhf` 不能混。
6. **fuzz 在 QEMU 模式下速度极慢**（每秒几十 exec）。要么用 `-Q` 的 persistent 模式，
   要么只在关键路径上跑几分钟就够。
7. **崩溃不代表漏洞**。QEMU 的 `syscall` 实现与真机差异会导致假崩溃，
   必须用真机或已知 patch 状态交叉验证。