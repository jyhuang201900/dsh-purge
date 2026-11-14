# 供应链攻击全链：源码、构建、分发、签名，以及"产物来源"的证明

> 被 `competition-supply-chain` 引用。核心问题只有一句：
> **"这个产物是谁、在哪一步、用什么输入构建的？"**
> 证明不了这一步，所有关于投毒的讨论都是猜测。

## 一、六段链路（每一段都是独立的攻击面）

```text
① source        仓库、分支、提交
② resolve       版本解析、lockfile、registry、镜像源
③ build         CI 环境、构建脚本、构建缓存、secret
④ package       打包、签名、产物 hash
⑤ publish       发布到 registry / 存储桶 / CDN
⑥ consume       下游拉取、运行时加载
```

**溯源的关键**：找出**最早发生偏移的那一段**。下游看到的所有异常都源于此。

```bash
# 每段的最小证据
① git log -1 --format='%H %an <%ae> %ad %s'
② jq -r '.packages["node_modules/foo"].version' package-lock.json
③ cat .github/workflows/*.yml | grep -nE 'run:|uses:'
④ sha256sum dist/*
⑤ curl -s https://registry.npmjs.org/pkg/1.2.3 | jq '.dist'
⑥ docker inspect app:1.2.3 | jq '.[0].RepoDigests'
```

## 二、源码投毒

| 手法 | 特征 | 检测 |
| --- | --- | --- |
| 直接提交恶意代码 | commit author 与历史不一致 | 签名提交 + 双人 review |
| 依赖替换（同名 fork） | `git+https://evil/pkg.git` | 审计 lockfile 的 resolved URL |
| 恶意 PR 混入 | 大 PR 里夹带一行 | diff 审查 + CODEOWNERS |
| CI 脚本注入 | 改 `Makefile` / `setup.py` | 构建脚本单列审查 |
| 隐藏字符/同形字 | `і`（西里尔）vs `i` | 检测非 ASCII 标识符 |

```bash
# 可疑提交（历史上没改过这个文件的人突然改了）
git log --format='%H %an' --follow -- path/to/file | head

# 依赖指向 git 而非 registry（高危）
jq -r '.packages | to_entries[] | select(.value.resolved // "" | test("git\\+|http://")) |
  "\(.key) -> \(.value.resolved)"' package-lock.json

# 同形字检测（在标识符里找非 ASCII）
grep -rPn '[^\x00-\x7F]' --include='*.py' --include='*.js' src/ | head
```

**判据**：`resolved` 指向非官方 registry 或 `git+` = 供应链可疑点。
源码投毒的"决定性证据"是：**能在产物里找到这段代码**（不只是 commit 存在）。

## 三、构建投毒

| 手法 | 说明 | 检测 |
| --- | --- | --- |
| `postinstall` / `setup.py` | 安装依赖时执行任意脚本 | `npm ci --ignore-scripts` |
| build cache 投毒 | 污染共享缓存，后续构建复用 | cache key 绑定 lockfile hash |
| CI 环境变量泄露 | 构建日志打印 secret | 日志脱敏 |
| 构建脚本替换 | 改 `webpack.config.js` 注入 | 构建配置 diff |
| 编译器/工具链投毒 | 替换 `tsc`/`gcc` | 工具链 pin + 校验 |
| 构建时机攻击 | 在 publish 前修改产物 | 产物 hash 与构建日志绑定 |

```bash
# 找 install hook
jq -r '.scripts // {}' package.json
grep -nE 'cmdclass|install_requires|setup\(' setup.py
grep -rn 'postinstall\|preinstall\|prepare' package.json

# 构建脚本里是否有网络请求（外带特征）
grep -rnE 'curl|wget|fetch\(|http' Makefile scripts/ build/ 2>/dev/null | head

# 检查 CI 是否用 --ignore-scripts
grep -n 'npm ci\|npm install\|yarn' .github/workflows/*.yml
```

**npm 的 `--ignore-scripts` 局限**：有些包依赖 `postinstall` 做原生编译，全关会构建失败。
更实际的做法是 **allowlist**（`@lavamoat/allow-scripts`）或在隔离容器里构建。

## 四、分发投毒

| 渠道 | 手法 | 检测 |
| --- | --- | --- |
| npm | 抢注同名包、接管废弃包、盗号发布 | `npm audit signatures`、provenance |
| PyPI | 同 npm；`setup.py` 执行 | `pip --require-hashes` |
| Docker Hub | 官方镜像被替换 tag | digest pin |
| GitHub Releases | 二进制被替换 | 校验和 + 签名 |
| 内部 Nexus/Artifactory | 代理缓存被投毒 | 上游校验 |
| CDN | JS 文件被篡改 | SRI（Subresource Integrity） |
| 镜像仓库 | tag 可变 | 只用 digest |

```bash
# npm 的 provenance（npm 9+，能证明"由哪个 CI 构建"）
npm audit signatures
# 输出：verified / missing / invalid

# 查看包的 provenance attestation
curl -s https://registry.npmjs.org/-/npm/v1/attestations/lodash@4.17.21 | jq .

# Docker 用 digest 而非 tag
docker pull nginx@sha256:abc...       # 安全
docker pull nginx:latest               # 不安全

# 校验 GitHub Release
curl -sL https://github.com/org/repo/releases/download/v1.2.3/app-linux-amd64 -o app
curl -sL https://github.com/org/repo/releases/download/v1.2.3/app-linux-amd64.sha256 -o app.sha256
sha256sum -c app.sha256

# SRI（网页）
# <script src="https://cdn/x.js" integrity="sha384-...">
grep -rn 'integrity=' index.html | head
```

**判据**：`npm audit signatures` 返回 `missing` = 该包没有 provenance，
不能证明来源；有 `verified` 才能说"由官方 CI 构建"。

## 五、签名与验证：sigstore / cosign / notary

### 5.1 cosign（最常用）

```bash
# 生成密钥对（keyless 模式可跳过）
cosign generate-key-pair

# 签名镜像（keyless，走 OIDC，签名记录在 Rekor 透明日志）
cosign sign --yes registry.local/app@sha256:abc...

# 用密钥签名
cosign sign --key cosign.key registry.local/app@sha256:abc...

# 生成 SBOM 并附加
cosign attach sbom --sbom bom.json registry.local/app@sha256:abc...

# 验证
cosign verify --key cosign.pub registry.local/app@sha256:abc...
cosign verify-attestation --type spdxjson --key cosign.pub registry.local/app@sha256:abc...

# keyless 验证（校验 OIDC issuer + subject）
cosign verify \
  --certificate-identity-regexp '^https://github.com/org/repo/.github/workflows/build.yml@refs/heads/main$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  registry.local/app@sha256:abc...
```

**keyless 验证的判据是最严格的**：`certificate-identity` 必须精确匹配 workflow 路径 + 分支。
写 `.*` 等于不验证。

```bash
# 检查镜像有没有签名
cosign verify registry.local/app@sha256:abc... 2>&1 | head
# 报 "no signatures found" = 未签名

# 检查是否有 attestation（SLSA provenance）
cosign download attestation registry.local/app@sha256:abc... | jq -r '.payload' | base64 -d | jq .
```

### 5.2 notary / TUF

| 项目 | 用途 | 命令 |
| --- | --- | --- |
| Notary v1 | 镜像签名（Docker Content Trust） | `export DOCKER_CONTENT_TRUST=1` |
| Notary v2 / Notation | OCI artifact 签名 | `notation sign` / `notation verify` |
| TUF | 元数据防篡改（更新链） | 通常内置于包管理器 |

```bash
# Notation（Notary v2）
notation cert generate-test --default "test"
notation sign registry.local/app@sha256:abc...
notation verify registry.local/app@sha256:abc...

# Docker Content Trust（老）
export DOCKER_CONTENT_TRUST=1
docker pull registry.local/app:1.2.3     # 会校签名
```

### 5.3 SLSA provenance（"谁在哪一步构建"的正式答案）

```bash
# 查看 SLSA provenance（GitHub Actions 生成）
cosign download attestation registry.local/app@sha256:abc... \
  | jq -r '.payload' | base64 -d | jq '.predicate.buildDefinition'

# 关键字段
#   buildType: https://slsa.dev/provenance/v1
#   externalParameters.source.uri / digest
#   resolvedDependencies: 构建时实际用的依赖与 hash
#   builder.id: 构建者的身份（如 GitHub Actions workflow）
```

**判据**：`resolvedDependencies` 里的 hash 与 lockfile 一致，且 `builder.id` 是
预期的 workflow，才能说"这个产物由这个流水线构建"。否则只能说"有个签名"。

## 六、怎么证明"这个产物是谁在哪一步构建的"

这是本 skill 的**唯一验收标准**。完整的证据链：

```text
1. 产物 digest（不可变标识）
   docker inspect → RepoDigests / sha256sum

2. 签名与 attestation
   cosign verify → 签名者身份（OIDC subject 或公钥）
   cosign download attestation → SLSA provenance

3. provenance 里的构建输入
   source.uri + source.digest（git commit）
   resolvedDependencies（每个依赖的 hash）

4. 与仓库核对
   git cat-file -p <commit> → 确认 commit 存在且内容一致
   lockfile 的 hash 与 resolvedDependencies 对比

5. 与运行时核对
   实际跑起来的镜像 digest == 被验证的 digest
```

```bash
# 完整验证脚本（可直接用）
IMG=registry.local/app
DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' $IMG:1.2.3 | cut -d@ -f2)
echo "digest: $DIGEST"

cosign verify --key cosign.pub "$IMG@$DIGEST" || echo "NOT SIGNED"

cosign download attestation "$IMG@$DIGEST" \
  | jq -r '.payload' | base64 -d > prov.json

jq -r '.predicate.buildDefinition.externalParameters.source' prov.json
jq -r '.predicate.buildDefinition.resolvedDependencies[] | "\(.uri)\t\(.digest.gitCommit // .digest.sha256)"' prov.json | head

# 与 git 核对
git -C repo cat-file -t $(jq -r '.predicate.buildDefinition.externalParameters.source.digest.gitCommit' prov.json)
```

**反例（看起来证明了其实没有）**：

| 看起来 | 实际 |
| --- | --- |
| `cosign verify` 通过 | 只证明"有签名"，不证明"签名者可信"（keyless 的 identity 没校验） |
| 有 SBOM | SBOM 可以是构建后手工生成的，与产物无绑定 |
| 有 provenance | provenance 可能是伪造的（生成者不受信） |
| tag 是 `v1.2.3` | tag 可变，必须用 digest |
| hash 一致 | 只证明"传过来的没坏"，不证明"来源正确" |

## 七、检测视角

| 手法 | 日志/信号 | 特征 |
| --- | --- | --- |
| 源码投毒 | git 审计 | 非 CODEOWNER 改了受保护文件；force push |
| 依赖替换 | CI 日志 | `resolved` 指向非白名单 registry |
| install hook 外带 | 构建日志 / 出向流量 | `postinstall` 里有 curl |
| 分发投毒 | registry 审计 | 同一版本被重复 publish（版本号不可变应报错） |
| 签名缺失 | admission controller | 未签名镜像被拒绝（Kyverno/Connaisseur） |
| provenance 不符 | 供应链平台 | builder.id 不是预期 workflow |
| 依赖混淆 | registry 日志 | 内网包名从公网拉取 |

```yaml
# Kyverno 策略：只允许签名的镜像
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata: {name: verify-images}
spec:
  validationFailureAction: Enforce
  rules:
  - name: check-signature
    match:
      any:
      - resources: {kinds: [Pod]}
    verifyImages:
    - imageReferences: ["registry.local/*"]
      attestors:
      - entries:
        - keys:
            publicKeys: |-
              -----BEGIN PUBLIC KEY-----
              ...
              -----END PUBLIC KEY-----
```

## 八、验伤信号

| 声称 | 硬证据 | 假成功反例 |
| --- | --- | --- |
| 找到投毒代码 | 产物二进制/包里有该代码（`strings` 或反编译可见） | 只在 commit 里有，但产物没包含 |
| 依赖混淆可行 | 公网同名包存在，且构建时真的拉到了它（CI 日志的 resolved URL） | 公网包存在但配置单源，拉不到 |
| 拿到签名密钥 | 能用它签出新镜像且 `cosign verify` 通过 | 只找到 `.pub` 公钥 |
| provenance 伪造成功 | 用伪造的 provenance 通过验证策略 | 只是生成了一份 json，策略没校验 |
| 镜像被替换 | `docker pull` 到的 digest 与官方不同 | tag 相同但没比 digest |

## 九、常见坑

1. **tag 不是身份**。`app:1.2.3` 可以被覆盖，只有 digest 不可变。报告里必须写 digest。
2. **`cosign verify` 不加 identity 校验等于没验**。keyless 模式必须校验
   `--certificate-identity` 和 `--certificate-oidc-issuer`。
3. **SBOM 与产物的绑定关系**。`cosign attach sbom` 才是绑定；单独一个 `bom.json` 文件不算。
4. **npm 的 `latest` tag 会被移动**。`npm install pkg` 装的是 latest，不是固定版本。
5. **私有 registry 的代理缓存**。Nexus/Artifactory 代理 npm 时，上游投毒会同步到缓存，
   内网用户无感。
6. **`git+https` 依赖不经过 registry 校验**。`npm audit signatures` 对这类无效。
7. **SLSA level 不是自证的**。项目自称 "SLSA L3" 但 provenance 由自己生成（非受信 builder）时，
   实际只有 L1。