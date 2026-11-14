# SBOM 与软件成分分析：格式、生成、匹配、误报

> 被 `supply-chain-security` 引用。SBOM 回答"这个产物里有什么"，
> SCA 回答"这些东西有没有已知漏洞"。**两者都不能回答"能不能被利用"**。

## 一、SBOM 的两种主流格式

| 维度 | SPDX | CycloneDX |
| --- | --- | --- |
| 标准组织 | Linux Foundation | OWASP |
| 最新版本 | 2.3 / 3.0 | 1.5 / 1.6 |
| 表达力 | 强（许可证、关系） | 强（VEX、服务、配方） |
| 工具支持 | `syft`、`spdx-sbom-generator` | `syft`、`cdxgen`、`trivy` |
| 典型用途 | 合规/法务 | 安全/VEX |
| 文件 | `*.spdx.json` / `*.spdx` | `bom.json` / `*.cdx.json` |

**最小结构对照**：

```json
// CycloneDX 1.5 核心字段
{
  "bomFormat": "CycloneDX",
  "specVersion": "1.5",
  "metadata": { "timestamp": "...", "component": { "name": "myapp", "version": "1.2.3" } },
  "components": [
    { "type": "library", "name": "lodash", "version": "4.17.20",
      "purl": "pkg:npm/lodash@4.17.20",
      "hashes": [{ "alg": "SHA-256", "content": "..." }] }
  ],
  "dependencies": [ { "ref": "pkg:npm/myapp@1.2.3", "dependsOn": ["pkg:npm/lodash@4.17.20"] } ]
}
```

```json
// SPDX 2.3 核心字段
{
  "spdxVersion": "SPDX-2.3",
  "SPDXID": "SPDXRef-DOCUMENT",
  "name": "myapp",
  "packages": [
    { "SPDXID": "SPDXRef-Package-lodash", "name": "lodash", "versionInfo": "4.17.20",
      "externalRefs": [{ "referenceCategory": "PACKAGE-MANAGER",
        "referenceType": "purl", "referenceLocator": "pkg:npm/lodash@4.17.20" }] }
  ],
  "relationships": [
    { "spdxElementId": "SPDXRef-DOCUMENT", "relationshipType": "DESCRIBES",
      "relatedSpdxElement": "SPDXRef-Package-lodash" }
  ]
}
```

**关键：`purl` 是跨格式的通用标识**。所有匹配、关联、漏洞映射都靠它。

```text
pkg:npm/lodash@4.17.20
pkg:pypi/requests@2.31.0
pkg:maven/org.apache.logging.log4j/log4j-core@2.14.1
pkg:golang/github.com/gin-gonic/gin@v1.9.0
pkg:oci/nginx@sha256:abc...?repository_url=registry.local/nginx
pkg:deb/debian/openssl@1.1.1n?arch=amd64
```

## 二、生成 SBOM（真实命令）

### 2.1 syft（最通用）

```bash
# 目录
syft dir:. -o cyclonedx-json=bom.json
syft dir:. -o spdx-json=bom.spdx.json

# 容器镜像（远端）
syft registry:registry.local/app:1.2.3 -o cyclonedx-json=bom.json
# 本地 docker
syft docker:myapp:latest -o table

# 归档文件
syft file:app.tar.gz -o cyclonedx-json=bom.json

# 指定 cataloger（只扫 npm + python；参数名随版本变化，先 syft --help）
syft dir:. --select-catalogers "npm,python" -o cyclonedx-json=bom.json

# 输出到 stdout 看摘要
syft dir:. -o table | head -30
```

**syft 的 `-o table` 输出列**：`NAME VERSION TYPE`，最快看"有什么"。

### 2.2 cdxgen（多语言，CycloneDX 深度）

```bash
npm install -g @cyclonedx/cdxgen

# 自动识别语言
cdxgen -o bom.json .

# 指定类型
cdxgen -t java -o bom.json .
cdxgen -t python -o bom.json .
cdxgen -t nodejs -o bom.json .
cdxgen -t docker -o bom.json .            # 会生成镜像 SBOM

# 容器镜像
cdxgen -t docker -o bom.json registry.local/app:1.2.3

# 生成 VEX（漏洞可利用性声明）
cdxgen -t java --vex-output vex.json .
```

### 2.3 trivy（顺带生成 SBOM）

```bash
trivy image --format cyclonedx --output bom.json registry.local/app:1.2.3
trivy fs --format spdx-json --output bom.spdx.json .
trivy sbom bom.json                     # 对已有 SBOM 做漏洞扫描
```

## 三、漏洞匹配（SCA）

```bash
# grype（对 SBOM 或目录）
grype sbom:bom.json -o table
grype dir:. -o json > vulns.json
grype registry:registry.local/app:1.2.3 --fail-on high

# trivy
trivy sbom bom.json --severity HIGH,CRITICAL
trivy image registry.local/app:1.2.3 --scanners vuln --format json

# osv-scanner（OSV.dev 生态，对开源生态最准）
osv-scanner --lockfile=package-lock.json
osv-scanner --sbom=bom.json
osv-scanner -r .
```

**输出的关键字段**（必须读懂再看）：

```text
NAME        VERSION   TYPE    VULNERABILITY   SEVERITY   FIXED-IN
lodash      4.17.20   npm     CVE-2021-23337  High       4.17.21
log4j-core  2.14.1    java    CVE-2021-44228  Critical   2.15.0
```

| 字段 | 为什么重要 |
| --- | --- |
| `VERSION` | 必须与实际运行版本一致（SBOM 里可能写的是声明版本） |
| `FIXED-IN` | 有修复版本 = 可操作；空 = 无补丁 |
| `SEVERITY` | CVSS 的基础分，**不等于实际风险** |
| `TYPE` | 生态（npm/pypi/maven），决定匹配规则 |

## 四、依赖混淆与 typosquat 的识别

### 4.1 依赖混淆（dependency confusion）

**原理**：内网私有包 `company-utils@1.0.0`，如果构建时 registry 配置允许回退到公网，
攻击者在 npm 上抢注同名包并发布 `99.0.0`，包管理器会选**版本更高**的公网包。

```bash
# 检测点 1：.npmrc / pip.conf 是否配置了 fallback
cat .npmrc                      # 看 registry= 是否只有内网
cat ~/.pip/pip.conf
cat .yarnrc.yml

# 危险配置
# registry=https://registry.npmjs.org/     ← 只有公网，内网包会 404 然后失败（安全）
# 但如果有 multiple registry 或 scope 未限定，就可能混淆

# 检测点 2：package.json 里是否有未加 scope 的内网包
grep -E '"(@?[a-z0-9-]+)":' package.json | grep -v '@company/'

# 检测点 3：内网包名是否在公网存在
for p in $(jq -r '.dependencies | keys[]' package.json); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://registry.npmjs.org/$p")
  [ "$code" = "200" ] && echo "PUBLIC EXISTS: $p"
done
```

**修复**：

```ini
# .npmrc —— 用 scope 隔离
@company:registry=https://npm.company.internal/
registry=https://registry.npmjs.org/
```

```bash
# pip —— 用 --index-url 而非 --extra-index-url
pip install --index-url https://pypi.company.internal/simple/ company-utils
# 危险：--extra-index-url 会同时查两个源，取版本高的
```

### 4.2 typosquat / brandjacking

```bash
# 常见手法：单字符替换、连字符、复数、后缀
#   requests → request、reqeusts、requests2
#   lodash → lodahs、lodash-es（后者是真实包，需确认）
#   @angular/core → @angular-core、@angulars/core

# 检测：对依赖名做编辑距离，找与知名包相近但不在白名单的
python3 - <<'PY'
import json, difflib
known = ["lodash","express","requests","numpy","react","axios","chalk","debug"]
deps = list(json.load(open("package.json")).get("dependencies", {}).keys())
for d in deps:
    m = difflib.get_close_matches(d, known, n=1, cutoff=0.85)
    if m and m[0] != d:
        print(f"SUSPECT: {d} ~ {m[0]}")
PY
```

**判据**：
- 包名与知名包编辑距离 ≤ 2 且作者/下载量异常低 → 高度可疑
- 新发布（< 30 天）+ 无 README + 有 `postinstall` → 高度可疑

```bash
# 查包元数据（npm）
curl -s https://registry.npmjs.org/<pkg> | jq '{time: .time.created, maintainers: .maintainers, versions: (.versions|keys|length)}'
# 查 pypi
curl -s https://pypi.org/pypi/<pkg>/json | jq '.info | {author, home_page, version}'
```

## 五、SBOM 的可见性缺口（这是最该写进报告的一段）

| 缺口 | 说明 | 影响 |
| --- | --- | --- |
| **传递依赖不全** | 只扫直接依赖，漏掉 transitive | 大部分漏洞在深层依赖 |
| **静态链接库** | Go/Rust/C 的静态库不进 SBOM | 二进制里的漏洞完全不可见 |
| **vendor 目录** | `vendor/` 里的代码常被当源码 | 版本不可知 |
| **系统包** | 基础镜像的 apt/apk 包，需单独扫 | OS 层漏洞漏掉 |
| **运行时下载** | 启动时 `pip install` 的包 | SBOM 生成时不存在 |
| **构建期生成** | 代码生成器引入的库 | 不在 lockfile |
| **SBOM 自身过期** | 生成后依赖又变了 | 与实际不符 |
| **无 purl 的手工组件** | 内部库没有规范标识 | 无法匹配 CVE |

```bash
# 检查传递依赖覆盖度
syft dir:. -o json | jq '.artifacts | length'
jq '.packages | length' package-lock.json 2>/dev/null
# 两者差距大 = SBOM 不全

# 检查静态链接（Go 二进制）
go version -m ./app                      # 列出编译进的模块
strings ./app | grep -E 'go1\.[0-9]+' | head

# 检查基础镜像的 OS 包
trivy image --scanners vuln --list-all-pkgs registry.local/app:1.2.3 | head -40
```

## 六、误报处理（SCA 最耗时的部分）

| 误报类型 | 表现 | 处理 |
| --- | --- | --- |
| **版本猜错** | SBOM 写的版本与实际二进制不符 | 用 `strings`/`go version -m` 核对 |
| **不可达代码** | 漏洞函数没被调用 | 用 VEX 标注 `not_affected`，或做可达性分析 |
| **仅构建期依赖** | devDependency 不进产物 | 过滤 `dev` scope |
| **已 backport** | 版本号旧但补丁已打 | 查发行版 changelog |
| **误匹配** | purl 相似但不同包 | 核对 `purl` 全名 |
| **CVSS 高但需特殊条件** | 需特定配置/本地访问 | 读 CVE 描述 |
| **重复计数** | 同一 CVE 在多个扫描器出现 | 去重（按 purl + CVE） |

```bash
# 去重
jq -r '.matches[] | "\(.artifact.purl)\t\(.vulnerability.id)"' vulns.json | sort -u | wc -l

# 只看有修复方案的
grype sbom:bom.json -o json | jq -r '
  .matches[] | select(.vulnerability.fix.versions | length > 0) |
  "\(.artifact.name)\t\(.artifact.version)\t\(.vulnerability.id)\t\(.vulnerability.fix.versions[0])"'

# 过滤 dev 依赖（需要 SBOM 里有 scope 信息）
jq -r '.components[] | select(.scope != "excluded") | .purl' bom.json
```

**VEX 的正确用法**（这是把误报变成"有依据的排除"的唯一方法）：

```json
{
  "bomFormat": "CycloneDX",
  "vulnerabilities": [{
    "id": "CVE-2021-44228",
    "analysis": {
      "state": "not_affected",
      "justification": "code_not_reachable",
      "detail": "log4j-core 仅用于构建期日志，产物中未打包"
    }
  }]
}
```

`state` 的合法值：`resolved` / `resolved_with_pedigree` / `exploitable` /
`in_triage` / `false_positive` / `not_affected`。

## 七、检测视角

| 场景 | 信号 |
| --- | --- |
| 依赖混淆被利用 | 构建日志里出现"从公网 registry 拉取内网包名" |
| typosquat 安装 | lockfile 里出现新包 + 安装时间与提交时间吻合 |
| SBOM 与实际不符 | 产物的 `go version -m` / `strings` 与 SBOM 版本不一致 |
| 供应链投毒 | 同一包的版本在短时间内被重发布（registry 的 publish 日志） |

```bash
# 产物验证（最硬的证据）
go version -m ./app | head -20            # Go
strings ./app | grep -E '@[0-9]+\.[0-9]+' | head   # 版本字符串
trivy image --format json app:1.2.3 | jq '.Results[].Vulnerabilities | length'
```

## 八、验伤信号

| 声称 | 硬证据 | 假成功反例 |
| --- | --- | --- |
| SBOM 完整 | `syft` 组件数 ≈ `package-lock.json` 的包数 | 只扫了直接依赖 |
| 发现漏洞 | `FIXED-IN` 有值 + 该组件确实在运行路径上 | 只有 CVE 号，没确认版本/可达性 |
| 依赖混淆可行 | 能在公网 registry 看到同名包，且构建配置允许 fallback | 公网包存在但 CI 用 `--index-url` 单源 |
| 拿到 SBOM 缺口 | 产物里有 SBOM 未列出的库（`go version -m` 对比） | 只是"没扫到"，不是"不存在" |

## 九、常见坑

1. **SBOM 不是"扫一次就完"**。依赖每天在变，要在 CI 里每次构建都生成。
2. **`syft dir:.` 会扫到 `node_modules`**。这其实是好事（能看传递依赖），
   但要设 `-c` 限定生态，否则会很慢。
3. **trivy 的 `--scanners vuln` 不生成 SBOM**，要 `--format cyclonedx` 才是 SBOM。
4. **`--extra-index-url` 是依赖混淆的根因**。审计时要专门 grep 这个参数。
5. **CVSS 9.8 不等于必须修**。要看是否可达、是否有缓解措施，报告里写清判断依据。
6. **VEX 是可辩论的**。`not_affected` 需要有证据（代码路径分析），
   不能因为"看起来没用"就标。
7. **静态链接是最大的盲区**。Go/Rust 的 SBOM 必须用 `go version -m` / `cargo auditable` 补。