# PCAP 协议分析：tshark 过滤、提取、还原会话

> 被 `competition-pcap-protocol` 引用。分析 pcap 的顺序永远是：**先看有哪些流 → 再挑一条
> 流看完整会话 → 最后才写过滤表达式**。上来就写复杂过滤器是最慢的路径。

## 一、第一遍：全景（30 秒内完成）

```bash
# 1) 概要：时间范围、包数、协议分布
capinfos capture.pcap

# 2) 协议分层统计
tshark -r capture.pcap -q -z io,phs

# 3) 会话列表（谁跟谁说话，多少字节）
tshark -r capture.pcap -q -z conv,tcp
tshark -r capture.pcap -q -z conv,udp
```

```bash
# 4) 端点排行（找出最活跃的）
tshark -r capture.pcap -q -z endpoints,ip | head -25

# 5) 专家信息（自动发现异常）
tshark -r capture.pcap -q -z expert
```

**判读**：

- `io,phs` 里出现非标准协议（`data`、`tcp`）→ 自定义协议，要手工解析
- `conv,tcp` 里某个会话字节数远超其他 → 是主要业务或文件传输
- `expert` 里的 `Malformed` / `Checksum` → 可能是刻意构造的攻击包

## 二、常用过滤表达式（按用途分类）

### 2.1 定位主机与端口

```
# 单 IP（任一方向）
ip.addr == 10.0.0.20

# 只看出站
ip.src == 10.0.0.20

# 排除噪音
! (ip.addr == 10.0.0.1 or arp or icmp)

# 端口
tcp.port == 8080
tcp.dstport == 443
udp.port == 53

# 端口范围
tcp.port >= 8000 && tcp.port <= 8100

# 内网到内网（横向）
ip.src == 10.0.0.0/8 && ip.dst == 10.0.0.0/8 && tcp.flags.syn == 1 && tcp.flags.ack == 0
```

### 2.2 HTTP

```
# 只看请求行
http.request

# 特定方法
http.request.method == "POST"

# 特定 host
http.host == "api.example.com"

# URI 含关键词
http.request.uri contains "login"

# 状态码
http.response.code >= 400

# 带 body 的请求
http.request.method == "POST" && http.content_length > 0

# 上传（multipart）
http.content_type contains "multipart/form-data"

# 特定 header 存在
http.authorization

# cookie
http.cookie contains "session"
```

### 2.3 TLS / 证书

```
# 握手（ClientHello）
tls.handshake.type == 1

# SNI（看访问了哪些域名）
tls.handshake.extensions_server_name

# 证书
tls.handshake.type == 11

# 只看 SNI 列表
```

```bash
tshark -r capture.pcap -Y 'tls.handshake.type==1' \
  -T fields -e ip.dst -e tls.handshake.extensions_server_name | sort -u
```

### 2.4 DNS

```
dns
dns.qry.name contains "evil"
dns.flags.rcode != 0
# 长域名（DNS 隧道特征）
# （tshark 没有直接的长度过滤，用 awk 后处理）
```

```bash
# 找可疑长域名（DNS 隧道）
tshark -r capture.pcap -Y 'dns.flags.response==0' -T fields -e dns.qry.name \
  | awk 'length($0)>50' | sort | uniq -c | sort -rn | head -20
```

### 2.5 TCP 层

```
# 重传
tcp.analysis.retransmission

# 零窗口（接收方卡住）
tcp.analysis.zero_window

# RST
tcp.flags.reset == 1

# SYN 无响应（扫描）
tcp.flags.syn == 1 && tcp.flags.ack == 0
```

## 三、提取文件与流（最常用的两个动作）

### 3.1 提取 HTTP 对象

```bash
# 导出所有 HTTP 对象到目录
tshark -r capture.pcap --export-objects http,./http_objects -q
ls -la ./http_objects/

# 提取 SMB 对象
tshark -r capture.pcap --export-objects smb,./smb_objects -q

# 提取 TFTP / DICOM / IMF 等（支持的协议列表见 --export-objects 帮助）
tshark -r capture.pcap --export-objects tftp,./tftp_objects -q
```

### 3.2 提取原始流

```bash
# 列出所有 TCP 流
tshark -r capture.pcap -T fields -e tcp.stream | sort -n | uniq

# 导出某条流（原始字节）
tshark -r capture.pcap -q -z follow,tcp,raw,3

# 导出为文本（可读）
tshark -r capture.pcap -q -z follow,tcp,ascii,3

# 导出 HTTP 流
tshark -r capture.pcap -q -z follow,http,ascii,3
```

```bash
# 把流 3 的原始字节存成文件（去掉 tshark 的格式标记）
tshark -r capture.pcap -q -z follow,tcp,raw,3 | \
  sed -n '/^Follow:/,/^====/p' | grep -E '^\s+[0-9a-f]' | \
  awk '{print $2}' | xxd -r -p > stream3.bin
```

### 3.3 只抓某个会话的包（再分析）

```bash
# 用流号过滤
tshark -r capture.pcap -Y 'tcp.stream == 3' -w stream3.pcap

# 用五元组
tshark -r capture.pcap -Y 'ip.addr==10.0.0.20 && tcp.port==9000' -w session.pcap
```

## 四、协议分层定位问题

### 4.1 逐层下钻

```bash
# L2：MAC / VLAN
tshark -r capture.pcap -Y 'vlan' -T fields -e vlan.id | sort | uniq -c

# L3：IP 层（TTL 可判断是否经过路由/NAT）
tshark -r capture.pcap -Y 'ip' -T fields -e ip.src -e ip.ttl | head -10

# L4：TCP 标志位分布
tshark -r capture.pcap -Y 'tcp' -T fields -e tcp.flags | sort | uniq -c | sort -rn

# L7：应用层
tshark -r capture.pcap -Y 'http' -T fields -e http.request.method -e http.request.uri
```

**TTL 的用途**：初始 TTL 64/128/255，每过一跳减 1。若看到的 TTL 是 61，说明过了 3 跳
（Linux 起点 64）。这能推断拓扑。

### 4.2 判断"谁在解析"

```bash
# 看是否有代理插入的头
tshark -r capture.pcap -Y 'http' -T fields -e http.request.line | grep -iE 'via|x-forwarded|forwarded'

# 看同一请求在客户端侧与服务端侧的差异（两侧都抓包时）
# 对比 tcp payload 的字节数
```

## 五、加密流量里能分析的部分

即使 TLS 加密，以下仍可见：

| 可见项 | 怎么看 |
| --- | --- |
| **SNI** | `tls.handshake.extensions_server_name` |
| **证书链** | `tls.handshake.type==11`；`tshark -Y 'tls.handshake.certificate'` |
| **TLS 版本/套件** | `tls.handshake.version`、`tls.handshake.ciphersuite` |
| **包大小/时序** | 可用于指纹（如 JA3） |
| **JA3 指纹** | 用 `tshark -T fields -e tls.handshake.ja3` |
| **DNS over TLS 的目标** | 853 端口 |
| **流量方向与节奏** | 突发/持续，可推断行为 |

```bash
# 提取 SNI + 证书主题
tshark -r capture.pcap -Y 'tls.handshake.type==1' \
  -T fields -e ip.dst -e tls.handshake.extensions_server_name | sort -u

tshark -r capture.pcap -Y 'tls.handshake.type==11' \
  -T fields -e x509sat.uTF8String -e x509ce.dNSName 2>/dev/null | sort -u | head -20

# JA3 指纹（识别客户端类型）
tshark -r capture.pcap -Y 'tls.handshake.type==1' -T fields -e tls.handshake.ja3 | sort | uniq -c
```

```bash
# 若有 SSLKEYLOGFILE（客户端导出的密钥），可直接解密
tshark -r capture.pcap -o tls.keylog_file:sslkeys.log -Y 'http' -T fields -e http.request.uri
```

## 六、还原一个完整会话（标准流程）

以自定义二进制协议为例：

```bash
# 步骤 1：找到目标流
tshark -r capture.pcap -q -z conv,tcp | grep 10.0.0.20

# 步骤 2：看该流的包序列（时间 + 长度 + 方向）
tshark -r capture.pcap -Y 'tcp.stream==3' \
  -T fields -e frame.time_relative -e ip.src -e tcp.len -e tcp.flags | head -40

# 步骤 3：导出 payload 并 hexdump
tshark -r capture.pcap -Y 'tcp.stream==3 && tcp.len>0' -T fields -e data.data | \
  while read h; do echo "$h" | xxd -r -p; echo; done | xxd | head -40
```

```bash
# 步骤 4：按协议分帧（Python 脚本，长度前缀）
python3 - <<'PY'
import subprocess, sys
out = subprocess.check_output([
    'tshark','-r','capture.pcap','-Y','tcp.stream==3 && tcp.len>0',
    '-T','fields','-e','data.data'], text=True)
buf = b''.join(bytes.fromhex(l) for l in out.split() if l)
i = 0
while i + 4 <= len(buf):
    magic = buf[i:i+2]
    n = int.from_bytes(buf[i+2:i+4], 'big')
    if i + 4 + n > len(buf):
        print(f'[truncated at {i}]'); break
    pkt = buf[i:i+4+n]
    print(f'#{i:04d} magic={magic.hex()} len={n} body={pkt[4:].hex()[:80]}')
    i += 4 + n
PY
```

**这是还原会话的核心**：把 TCP 字节流按协议重新分帧，然后逐包解释。

## 七、手工构造与重放（配合验伤）

```bash
# 用 editcap 切出单包
editcap -r capture.pcap one.pkt 12

# 用 tcpreplay 重放（授权范围内）
tcpreplay -i eth0 --pps=1 session.pcap

# 或用 Python scapy 精确构造
python3 - <<'PY'
from scapy.all import *
p = IP(dst='10.0.0.20')/TCP(dport=9000, sport=40000, flags='PA')/Raw(load=bytes.fromhex('1234...'))
send(p)
PY
```

## 八、验伤：PCAP 分析的"成功"

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| 协议已还原 | 能按帧边界切出完整包，且字段语义自洽（长度对得上） | 只是把字节切开但解释不通 |
| 提取到敏感文件 | 导出的文件**可打开**且含真实内容 | 导出的是残缺/加密的 blob |
| 找到凭据 | 明文口令/token + **能用它登录** | 只是看到类似字符串 |
| 确认攻击链 | 时间线完整（扫描 → 利用 → 落地）且因果清晰 | 只看到零散的可疑包 |
| 加密流量分析 | SNI/证书/JA3 有明确结论 | 猜测"这是 C2"但没有依据 |

**必须做的交叉验证**：把 pcap 的结论与**其他日志**（应用/系统/DNS）对齐时间戳。只有 pcap
孤证容易误判（比如把正常重传当攻击）。

## 九、检测视角

| 手法 | 信号 | 特征 |
| --- | --- | --- |
| 端口扫描 | SYN 无 ACK、大量短流 | 单源对多端口；`tcp.flags.syn==1 && ack==0` |
| 横向移动 | 内网到内网的 SMB/RDP/WinRM | 445/3389/5985 的非管理源 |
| 数据外传 | 大流量出站、非常规端口 | 单流 > 10MB 且目的地是公网 |
| DNS 隧道 | 长/高熵域名、高频 TXT | `length(qry)>50` 且随机 |
| 自定义协议 | `data` 协议、固定偏移的 magic | 非标准端口 + 二进制 |
| 加密 C2 | JA3 异常、固定间隔心跳 | 每 60s 一个固定大小包 |

```bash
# DNS 隧道检测
tshark -r capture.pcap -Y 'dns.flags.response==0' -T fields -e dns.qry.name \
  | awk '{ if (length($0)>50) print }' | head -20

# 大流量外传
tshark -r capture.pcap -q -z conv,tcp | sort -k5 -nr | head -10
```

## 十、常见坑

1. **一上来就写复杂过滤器**——先 `io,phs` + `conv,tcp` 看全景，再定向。
2. **抓包不全（snaplen 太小）**——`tcpdump -s 0` 抓全量。默认 262144 可能截断大数据包。
3. **只抓了一个方向**——镜像/分光配置错。`conv,tcp` 里某方向的包数为 0 就是这个问题。
4. **忘了 `tcp.stream` 是双向的**——同一条流包含两个方向，用 `ip.src` 再筛。
5. **`--export-objects` 提取的文件是残缺的**——流没结束或抓包截断。看 `http.response.code` 是否 200 且 `content_length` 匹配实际大小。
6. **TLS 解密忘了 keylog**——现代 TLS 1.3 不能靠 RSA 私钥解，必须 `SSLKEYLOGFILE`。
7. **乱序/重传干扰分帧**——先用 `tcp.analysis.retransmission` 排除重传包，再拼流。
8. **误把重传当攻击**——`tcp.analysis.retransmission` 是网络问题，不是攻击信号。**必须结合时间与业务上下文**。