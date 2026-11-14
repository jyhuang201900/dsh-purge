# 自动化循环模式：观察→假设→验证→落库，以及何时退出

> 被 `pentest-tools` 引用。循环的价值不在于"跑得多"，而在于**每一轮都让不确定性下降**。
> 不能缩小不确定性的循环就是在烧时间。

## 一、四步循环

```
[O] Observe   —— 收集当前状态（响应、日志、端口、代码）
  ↓
[H] Hypothesize —— 提出一个可被证伪的假设（"这里缺 owner 校验"）
  ↓
[V] Verify    —— 用一个最小动作验证（发一个请求）
  ↓
[R] Record    —— 落库（结论 + 证据 + 下一步）
  ↓
（回到 O，用新的信息更新地图）
```

**关键纪律**：

| 步 | 必须产出 | 禁止 |
| --- | --- | --- |
| Observe | 至少一条**新的**事实 | 重复看已知的东西 |
| Hypothesize | 一句话、可证伪 | "可能有漏洞"（不可证伪） |
| Verify | 一个动作、一个预期结果 | 一次发 20 个 payload（不知道哪个生效） |
| Record | 结论 + 证据路径 | 只在脑子里记 |

## 二、假设的写法（决定循环质量）

| 差的假设 | 好的假设 |
| --- | --- |
| "这里可能有 SQL 注入" | "`/api/items?sort=` 的 sort 参数进入 ORDER BY，用 `sort=(case when 1=1 then id else name end)` 应改变排序" |
| "可能有越权" | "订单详情只按 id 查，不校验 user_id；用 B 的 token 请求 A 的订单 1001 应返回 200 且含 A 的 email" |
| "存在 SSRF" | "`/fetch?url=` 未做白名单，指向 `http://169.254.169.254/latest/meta-data/` 应返回云元数据" |

**判据**：假设里必须有**具体的动作**和**可观测的结果**。

## 三、每轮的时间盒

| 阶段 | 时间盒 | 超时动作 |
| --- | --- | --- |
| 单个假设的验证 | 10-15 分钟 | 标记"未验证"，换下一个 |
| 单类漏洞的探索 | 30-45 分钟 | 记录"该类无发现" + 已试清单 |
| 单个目标的总时长 | 2-4 小时 | 出阶段性报告 |

```markdown
## 时间盒记录（示例）
- 10:00-10:15  BOLA on /orders          → 命中（evidence/bola_1.txt）
- 10:15-10:30  BOLA on /invoices        → 未命中（返回 403）
- 10:30-11:00  BFLA on /admin/*         → 命中 2 处（evidence/bfla_*.txt）
- 11:00-11:30  GraphQL 内省             → 关闭，转字段建议（clairoyance 重建失败）
- 11:30-12:00  SSTI 探测                → 未命中（3 个参数全试）
```

## 四、退出条件（五条，任一满足即退出）

| 条件 | 判据 |
| --- | --- |
| **收益归零** | 连续 3 轮无新发现 |
| **覆盖面达成** | 计划内的入口/漏洞类都测过 |
| **成本超限** | 超出时间盒/预算 |
| **风险升级** | 触发了告警/影响了业务 |
| **无新信息** | 每轮的 Observe 拿不到新事实 |

```markdown
## 退出检查
- [ ] 所有 identified 入口都测过？
- [ ] 每个发现都有 evidence？
- [ ] 未验证项都列出来了（含原因）？
- [ ] 下一步建议写了？
- [ ] 敏感数据已脱敏？
```

## 五、避免无限尝试的三道闸

### 闸 1：同 payload 变体上限

```bash
# 例：SQL 注入的变体，最多 15 个
# 超过就换注入点，而不是换 payload
```

### 闸 2：同一入口的重复次数

```bash
# 例：一个端点最多 50 个请求（含枚举）
# 超过就说明"这个入口已经榨干"
```

### 闸 3：失败模式识别

| 模式 | 含义 | 动作 |
| --- | --- | --- |
| 全部返回同一个错误页 | WAF 全拦 | 换编码/换入口 |
| 全部超时 | 网络/后端问题 | 停止，报障碍 |
| 全部 200 但内容相同 | SPA fallback | 换 Accept 头/换路径 |
| 结果随机 | 缓存/负载均衡 | 加随机参数/固定会话 |

## 六、自动化循环的脚本骨架

```python
#!/usr/bin/env python3
"""loop.py — 假设驱动的自动化循环骨架"""
import json, time, pathlib

STATE = pathlib.Path('state.json')
state = json.loads(STATE.read_text()) if STATE.exists() else {"rounds": [], "findings": []}

def observe():
    """返回当前状态摘要（新事实）"""
    return {"ts": time.time(), "note": "collect"}

def hypothesize(obs):
    """基于观察生成假设（可插 LLM 或规则）"""
    return [{"id": "h1", "desc": "...", "test": "...", "expect": "..."}]

def verify(h):
    """执行验证，返回 (ok, evidence)"""
    return False, None

def record(round_no, h, ok, ev):
    state["rounds"].append({"n": round_no, "hyp": h["id"], "ok": ok, "evidence": ev})
    if ok:
        state["findings"].append(h)
    STATE.write_text(json.dumps(state, indent=2, ensure_ascii=False))

def should_exit():
    r = state["rounds"]
    if len(r) >= 20: return "max rounds"
    if len(r) >= 3 and all(not x["ok"] for x in r[-3:]): return "no findings in 3 rounds"
    return None

n = len(state["rounds"])
while True:
    reason = should_exit()
    if reason:
        print("EXIT:", reason); break
    n += 1
    obs = observe()
    for h in hypothesize(obs):
        ok, ev = verify(h)
        record(n, h, ok, ev)
        print(f'[{n}] {h["id"]} {"HIT" if ok else "miss"}')
```

## 七、验伤：循环是否有效的判据

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| 循环有进展 | 每轮都有新事实/新结论写入 state | 跑了很多轮但 state 没变 |
| 假设可证伪 | 每个假设都有明确预期 | "可能有漏洞"这种无法证伪的 |
| 退出合理 | 有明确退出条件与理由 | 跑了一整天不知道为什么停 |

## 八、检测视角（自动化循环在防守方看来是什么）

自动化循环的**节奏特征**是最明显的指纹：

| 信号 | 特征 | 与人类的区别 |
| --- | --- | --- |
| 请求间隔方差 | 极小（±50ms） | 人类有明显停顿（几秒到几分钟） |
| 请求顺序 | 按字典顺序（`raft-medium` 的固定序） | 人类按语义跳转 |
| 会话状态 | 每个请求独立（不复用 cookie） | 人类会保持会话 |
| 错误处理 | 全部 404 仍继续（不调整） | 人类会看到 404 就换方向 |
| UA/指纹 | `python-requests`/`curl`/默认 nmap | 浏览器 UA 完整 |
| 时间分布 | 24 小时连续 | 有作息 |

```bash
# 从访问日志算"机器人度"
# 1) 请求间隔的标准差
awk '{print $4}' access.log | \
  python3 -c "
import sys, datetime, statistics
ts = []
for l in sys.stdin:
    try: ts.append(datetime.datetime.strptime(l.strip().strip('['), '%d/%b/%Y:%H:%M:%S').timestamp())
    except: pass
g = [b-a for a,b in zip(ts, ts[1:])]
print('n=', len(g), 'mean=', round(statistics.mean(g),2), 'stdev=', round(statistics.pstdev(g),2))
# stdev < 0.5 秒 → 高度自动化
"
```

**关键**：`stdev/mean < 0.1` 基本可判定为自动化。

## 九、常见坑

1. **没有 Observe 就直接 Verify**——不看当前状态就发包，等于盲打。
2. **假设不可证伪**——"可能存在配置问题"永远无法验证。必须具体到"发什么请求、期望什么响应"。
3. **一次验证多个假设**——同时改 5 个参数，成功了也不知道是哪个生效。
4. **不落库**——下一轮从零开始，重复劳动。
5. **无时间盒**——在一个假设上耗半天。
6. **不设退出条件**——无限枚举，直到被 WAF 封。
7. **忽略"未命中"的价值**——"试过但没有"同样是结论（缩小了攻击面）。
8. **状态文件不版本化**——多轮之间无法对比，也无法回溯。