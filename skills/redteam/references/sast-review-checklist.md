# SAST 人工复核清单：从数据流判定到按语言的真漏洞模式

> 被 `code-audit` 引用。SAST 的核心矛盾是**告警量 >> 人力**。目标是**在 20 分钟内排掉 80%
> 的噪声，把时间留给真正可控的数据流**。

## 一、三步排除法（先砍量，再看细节）

### 第 1 步：只有常量/字面量进入 sink → 必假

```bash
# 找 sink，看参数是不是字面量
grep -rnE '(exec|system|popen|Runtime\.getRuntime|eval|include|require)\s*\(' src/ | head -50
```

```python
# 例：这些全部是假阳性（参数是常量）
os.system("ls -la /tmp")                    # 常量
subprocess.run(["ls", "-la"])               # 列表 + 常量
cursor.execute("SELECT * FROM users WHERE id = %s", (uid,))  # 参数化 → 安全
eval("1 + 1")                               # 常量
```

### 第 2 步：框架已做转义/参数化 → 必假

| 场景 | 是否必假 | 依据 |
| --- | --- | --- |
| ORM 的 `.filter()`/`.where()` 用参数 | ✅ 假 | Django/SQLAlchemy/Prisma 参数化 |
| `cursor.execute(sql, params)` 且 sql 是常量 | ✅ 假 | DBAPI 参数化 |
| React 的 `{userInput}`（非 `dangerouslySetInnerHTML`） | ✅ 假 | JSX 自动转义 |
| Jinja2 的 `{{ x }}`（非 `\|safe`） | ✅ 假 | autoescape |
| Spring 的 `@RequestParam` 到 JPA 方法 | ✅ 假 | Spring Data 参数化 |
| 模板里 `${x}`（非 `#{}`）在 MyBatis | ✅ 假 | `${}` 才是拼接 |
| Go 的 `db.Query("... ?", x)` | ✅ 假 | 参数化 |

```bash
# 快速找出"真拼接"的模式（这些才要追）
grep -rnE '(execute|query|exec)\s*\(\s*["'"'"'].*(\+|%|\$\{|f")' src/
grep -rnE 'f"[^"]*(SELECT|INSERT|UPDATE|DELETE)' src/
grep -rnE 'String\.format\([^)]*(SELECT|INSERT|UPDATE)' src/
grep -rnE '"\s*\+\s*\w+\s*\+\s*"' src/ | grep -iE 'select|where|insert|update'
```

### 第 3 步：数据流不可控（来源是内部常量/配置）→ 假

```bash
# 追变量来源：它是否来自 request/params/body/header/cookie/file
grep -rnE '(request\.(args|form|json|GET|POST|params|body|headers|cookies|files))' src/
grep -rnE '(req\.(query|body|params|headers|cookies))' src/
grep -rnE 'HttpServletRequest|@RequestParam|@PathVariable|@RequestBody' src/
```

**三级排除的效果**：典型 Java 项目 2000 条告警 → 三步后剩 60-100 条。

## 二、真的值得追的数据流（四要素齐全）

```
[Source] 用户可控输入
   ↓ （中间是否有净化？）
[Sink] 危险操作
   ↑
[Path] 完整调用链（跨函数/跨文件）
   +
[Gap] 净化的缺口（黑名单不全/编码层不匹配/上下文错配）
```

```bash
# 用 semgrep 做数据流（比纯 grep 准得多）
pip install semgrep

# 例：Python 的 SQL 拼接
semgrep --config "p/python" --config "p/sql-injection" src/

# 自定义规则（找 tainted 到 sink）
cat > rule.yml <<'EOF'
rules:
  - id: tainted-sql
    languages: [python]
    message: user input reaches SQL string
    severity: ERROR
    mode: taint
    pattern-sources:
      - pattern: request.args.get(...)
      - pattern: request.form[...]
    pattern-sinks:
      - pattern: $DB.execute($SQL, ...)
    pattern-sanitizers:
      - pattern: int(...)
EOF
semgrep --config rule.yml src/
```

```bash
# CodeQL（更准，需要编译数据库）
# JS/TS
codeql database create db --language=javascript --source-root=src
codeql database analyze db codeql/javascript-queries:Security/CWE-089 --format=sarif-latest -o out.sarif

# Java
codeql database create db --language=java --command='mvn clean package -DskipTests'
codeql database analyze db codeql/java-queries:Security/CWE-089 --format=csv -o sqli.csv
```

## 三、按语言的高频真漏洞模式

### 3.1 Python

| 模式 | 代码 | 备注 |
| --- | --- | --- |
| SQL 拼接 | `f"SELECT * FROM t WHERE id={uid}"` | 最常见 |
| `os.system` / `subprocess(shell=True)` | `os.system("ping " + host)` | 命令注入 |
| `eval` / `exec` | `eval(request.json['x'])` | 直接 RCE |
| `pickle.loads` | 反序列化 | **能写数据 = RCE** |
| `yaml.load`（无 `SafeLoader`） | 反序列化 | PyYAML < 5.1 默认不安全 |
| `jinja2.Template(user_input)` | SSTI | 非 `render_template` |
| `flask.send_file(path)` | 路径穿越 | 若 path 可控 |
| `requests.get(user_url)` | SSRF | 无白名单 |
| `subprocess.run(cmd, shell=True)` | 命令注入 | — |
| `__import__(user_input)` | 任意导入 | — |

```bash
# 一把抓
grep -rnE '(os\.system|os\.popen|subprocess\.(run|call|Popen)\s*\([^)]*shell\s*=\s*True)' src/
grep -rnE '\b(eval|exec)\s*\(' src/ | grep -v 'ast.literal_eval'
grep -rnE 'pickle\.(loads|load)\s*\(' src/
grep -rnE 'yaml\.load\s*\([^,)]*\)' src/ | grep -v SafeLoader
grep -rnE 'Template\s*\(\s*[a-z_]' src/
```

### 3.2 Java

| 模式 | 代码 | 备注 |
| --- | --- | --- |
| SQL 拼接 | `"select ... where id=" + id` | MyBatis 的 `${}` 也要查 |
| `Runtime.exec` | `Runtime.getRuntime().exec(cmd)` | 命令注入 |
| `ProcessBuilder` | `new ProcessBuilder("sh","-c",user)` | 同上 |
| 反序列化 | `ObjectInputStream.readObject()` | gadget 链 |
| XXE | `DocumentBuilderFactory` 未禁用 DTD | — |
| SSTI | `Velocity.evaluate` / `Freemarker` 的 `Template` | — |
| 表达式注入 | `SpEL` 的 `SpelExpressionParser.parseExpression(user)` | — |
| 路径穿越 | `new File(base, userPath)` | — |
| SSRF | `new URL(user)` + `openConnection()` | — |
| `@PathVariable` 到 SQL | 同上 | — |

```bash
grep -rnE 'Runtime\.getRuntime\(\)\.exec' src/
grep -rnE 'new ProcessBuilder\(' src/
grep -rnE 'new ObjectInputStream\(' src/
grep -rnE 'DocumentBuilderFactory\.newInstance' src/
grep -rnE 'parseExpression\s*\(' src/
grep -rnE '\$\{[a-zA-Z_]' src/main/resources/  # MyBatis 的 ${}
```

```java
// XXE 的正确写法（若代码里没有这些 setFeature，就是漏洞）
DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
```

### 3.3 PHP

| 模式 | 代码 |
| --- | --- |
| 命令执行 | `system($_GET['c'])`、`exec`、`shell_exec`、`passthru`、`popen`、`proc_open`、反引号 |
| 代码执行 | `eval`、`assert($x)`（老版）、`create_function`、`preg_replace` 的 `/e` |
| 文件包含 | `include $_GET['f']`、`require` |
| 反序列化 | `unserialize($_COOKIE[...])` |
| 变量覆盖 | `extract($_GET)`、`parse_str($x, $$var)` |
| 文件读写 | `file_get_contents($u)`、`fopen` |
| SSRF | `curl_exec` 到用户 URL |

```bash
grep -rnE '\b(system|exec|shell_exec|passthru|popen|proc_open)\s*\(' src/
grep -rnE '\beval\s*\(' src/
grep -rnE '\b(include|require)(_once)?\s*\(?\s*\$' src/
grep -rnE '\bunserialize\s*\(' src/
grep -rnE '\bextract\s*\(\s*\$_(GET|POST|REQUEST)' src/
```

### 3.4 JavaScript / Node

| 模式 | 代码 |
| --- | --- |
| 命令执行 | `child_process.exec(user)`、`execSync` |
| 代码执行 | `eval`、`new Function`、`vm.runInContext` |
| 原型污染 | `obj[k] = v` 未过滤 `__proto__`/`constructor`/`prototype` |
| SQL 拼接 | `"SELECT ... " + req.query.id` |
| 路径穿越 | `path.join(base, req.params.f)` 未校验 |
| SSRF | `axios.get(req.query.url)` |
| 反序列化 | `node-serialize` 的 `unserialize` |
| 模板注入 | `ejs.render(userTpl)`、`pug.render` |

```bash
grep -rnE '(child_process|cp)\.(exec|execSync|spawn)\s*\(' src/
grep -rnE '\b(eval|new Function)\s*\(' src/
grep -rnE '(\[.*\]|\w+\[[^\]]+\])\s*=\s*' src/ | grep -iE 'req\.|body|query|params'
grep -rnE 'path\.(join|resolve)\s*\([^)]*(req\.|body|query|params)' src/
```

### 3.5 Go

| 模式 | 代码 |
| --- | --- |
| SQL 拼接 | `fmt.Sprintf("select ... %s", id)` 传给 `db.Query` |
| 命令执行 | `exec.Command("sh","-c",user)` |
| 路径穿越 | `filepath.Join(base, user)` 未 `filepath.Clean` + 前缀校验 |
| SSRF | `http.Get(user)` |
| 模板注入 | `template.HTML(user)`（绕过转义） |

```bash
grep -rnE 'exec\.Command\(' src/ | grep -E 'sh|bash|cmd'
grep -rnE 'fmt\.Sprintf\([^)]*(SELECT|INSERT|UPDATE|DELETE)' src/
grep -rnE 'template\.(HTML|JS|URL|CSS)\(' src/
```

## 四、五类"看起来危险其实安全"的必假模式

| 看起来 | 实际 | 原因 |
| --- | --- | --- |
| `eval(json.dumps(...))` | 安全 | 常量 |
| `eval("1+1")` | 安全 | 常量 |
| `subprocess.run(["ls", target])` | 安全 | 列表形式不经过 shell |
| `db.query("... WHERE id = ?", [id])` | 安全 | 参数化 |
| `innerHTML = escapeHtml(x)` | 安全（若 escapeHtml 真做了） | 需确认实现 |
| `include("config/" + name + ".php")` | 需看 name 是否白名单 | — |
| `os.path.join(base, user)` | 不安全（可 `..`） | 这是**真漏洞** |
| `render_template("x.html", name=user)` | 安全 | 模板路径是常量 |
| `render_template_string(user)` | **不安全** | SSTI |
| `new URL(user).host` 校验后 `fetch(user)` | 需看是否重定向 | 可能被 302 绕过 |

```js
// escapeHtml 一定要看实现，常见错误：
function escapeHtml(s) {
  return s.replace(/</g, '&lt;');   // ← 只转义 <，' " & 都没处理
}
// 正确的（用于 HTML 文本上下文）
// & < > " ' 全部转义
```

## 五、上下文错配（最容易漏的真漏洞）

同一个"净化"在不同上下文里是不够的：

| 上下文 | 需要的编码 | 常见错误 |
| --- | --- | --- |
| HTML 文本 | `& < > " '` | 只转 `<` |
| HTML 属性（引号内） | 同上 + 属性引号 | 未转 `"` 就放 `value="x"` |
| HTML 属性（无引号） | 同上 + 空格/等号 | `value=x` |
| URL 参数 | percent-encoding | 直接拼 `?a=` + 用户值 |
| JS 字符串 | `\` 转义 + `</script` | 只做 HTML 转义 |
| CSS | CSS escape | 少见但存在 |
| SQL | 参数化（不是转义） | `mysql_real_escape_string` 在 GBK 下可绕 |

```java
// 典型错配：HTML 转义后放进 JS 字符串
String safe = htmlEscape(userInput);
out.write("<script>var x = '" + safe + "';</script>");
// payload: </script><script>alert(1)</script>  —— HTML 转义不处理这个
```

```bash
# 找这类代码
grep -rnE '(<script>|onclick=|onerror=).*\+' src/ | head -30
grep -rnE '(style=|href=|src=)["\x27]?\s*\+' src/
```

## 六、验伤：SAST 结论的"成功"

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| 命令注入 | 构造的输入在**实际运行**中执行了命令（回显/OOB） | 只是代码里有拼接 |
| SQL 注入 | 报错注入拿到版本，或布尔盲注有差异 | 只是字符串拼接但已被 ORM 处理 |
| 反序列化 RCE | 弹出计算器/回连 | 只是有 `readObject` |
| 路径穿越 | 读到 `/etc/passwd` | 只是 `path.join` |
| SSRF | 打到内网服务/元数据 | 只是 `fetch(user)` |

**核心原则**：**代码里有 sink ≠ 漏洞**。必须有完整的数据流 + 缺口 + 实际验证。

```bash
# 最小验证：把代码里的逻辑抽出来，在本地复现
# 例：Java 的 SQL 拼接
cat > T.java <<'EOF'
public class T {
  public static void main(String[] a) {
    String id = "1 OR 1=1";
    String sql = "SELECT * FROM users WHERE id = " + id;
    System.out.println(sql);
  }
}
EOF
javac T.java && java T
# 输出 SELECT * FROM users WHERE id = 1 OR 1=1  → 拼接成立
```

## 七、检测视角（代码审计的"防守方"视角）

| 信号 | 说明 |
| --- | --- |
| 编码规范检查 | CI 里禁止 `eval`/`os.system`/`${}`（MyBatis） |
| 依赖扫描 | 已知 CVE 的库版本（SCA） |
| 密钥扫描 | 仓库里的硬编码密钥（gitleaks/trufflehog） |
| 提交审计 | 谁在什么时候加了 sink（git log -S） |

```bash
# 用 git 找"什么时候引入了危险代码"
git log -S 'Runtime.getRuntime().exec' --oneline -- src/
git log -S 'eval(' --oneline -- '*.js'

# 密钥扫描
gitleaks detect --source . -v
trufflehog filesystem . --only-verified
```

## 八、常见坑

1. **只看 sink 不看 source**——`exec(cmd)` 里 cmd 是常量就是安全的。必须先追来源。
2. **把参数化当拼接**——`execute(sql, params)` 是安全的。看第二个参数。
3. **漏了框架的自动转义**——React/Jinja2/Django 模板默认转义。只有 `dangerouslySetInnerHTML`/`|safe`/`mark_safe` 才有问题。
4. **MyBatis 的 `${}` 与 `#{}`**——`#{}` 是参数化（安全），`${}` 是拼接（危险）。这是 Java 项目最高频的真漏洞。
5. **`escapeHtml` 的自定义实现**——一定要看实现，很多只转 `<`。
6. **上下文错配**——HTML 转义后放 JS 字符串里仍可 XSS。要看输出位置。
7. **忽略了反序列化的可达性**——`readObject` 存在但入口不可控也是安全的。要找"用户数据能到哪"。
8. **告警当漏洞报**——SAST 是**线索**不是结论。每条都要人工确认数据流，并在实际环境验证。