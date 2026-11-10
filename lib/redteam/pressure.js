/**
 * 「该不该停下来核对授权」的判定器。
 *
 * 为什么需要（实测缺口，第 124 轮）：上一轮把越界趋势做进了 summary 与战报，但它只是**一行数**，
 * 完全没有影响「下一步」——检测到了却不据此改行动，等于心电图画出来没人看。
 * 更糟的是原逻辑：越界越频繁，`next` 仍然照样指「继续打这一发」。
 *
 * 判据要说清三件事，缺一件就等于没判：
 *   ① **什么时候该停**（不是在「有拦截」时就停——正常摸边界本来就会撞线）；
 *   ② **为什么停**（趋势：在加速 / 同一类理由反复 / 集中在极短时间）；
 *   ③ **停下来做什么**（核对授权范围 or 换手法 or 找人确认，不是笼统的「注意一下」）。
 *
 * 这里的阈值都是**可解释的常数**，不是拍的：
 *   · 加速且后半段每桶 ≥ 3 次 → 说明持续拿不合法的东西在试，停；
 *   · 同一理由占比 ≥ 80% 且总数 ≥ 6   → 说明**根本没看边界**（不是试探，是瞎打），停；
 *   · 单桶内 ≥ 10 次                   → 一次性撞线太密，先停下核对清单，别继续堆；
 *   · 「在收敛」不停           → 已经摸清边界，是正常过程，继续。
 */

/** 判定是否需要暂停。返回 { must: boolean, level: 'stop'|'caution'|'', why: string, todo: string } */
export function judgeScopePressure(summary = {}) {
  const total = Number(summary.total || 0);
  if (total === 0) return { must: false, level: "", why: "", todo: "" };

  const trend = String(summary.trend || "");
  const byReason = Array.isArray(summary.byReason) ? summary.byReason : [];
  const byBucket = Array.isArray(summary.byBucket) ? summary.byBucket : [];
  const peak = byBucket.reduce((m, b) => Math.max(m, Number(b.n || 0)), 0);
  const top = byReason[0] || { reason: "", n: 0 };
  const topShare = total > 0 ? Number(top.n || 0) / total : 0;

  // ② 为什么停：优先报「最确定的那一条」，不要堆一堆理由让人不知道先改哪个
  if (/在加速/.test(trend)) {
    const m = /后半段每桶 ([\d.]+) 次/.exec(trend);
    const rate = m ? Number(m[1]) : 0;
    if (rate >= 3) {
      return {
        must: true, level: "stop",
        why: `越界在加速（后半段每桶 ${rate} 次），说明一直在拿不合法的目标或手法在试`,
        todo: "先停手：op=summary 看授权边界，把目标与技法改到清单内再打——继续只会一直在撞线",
      };
    }
    return {
      must: true, level: "caution",
      why: `越界在加速（后半段每桶 ${rate} 次）`,
      todo: "打之前先对一遍授权边界，确认目标与技法都在清单内",
    };
  }

  if (total >= 6 && topShare >= 0.8 && top.reason) {
    // 同一理由高占比说明「根本没看边界」。但若同时还出现「单桶撞线过密」，
    // 后者更具体（说的是**怎么撞的**），优先报后者——见下面的 peak 判定。
    // 这里先不 return，落到 peak 检查；peak 没过再回来报这条。
    if (peak < 10) {
      return {
        must: true, level: "stop",
        why: `${total} 次拦截里有 ${top.n} 次是同一个原因（${top.reason}，占 ${Math.round(topShare * 100)}%）——这不是在试探边界，是没看边界`,
        todo: "停下来重读授权：目标/技法/时间窗三项逐条对，改完再动手；同一原因再撞第三次就是白打",
      };
    }
  }

  if (peak >= 10) {
    return {
      must: true, level: "stop",
      why: `单个时间桶内被拦 ${peak} 次——撞线太密，不像在试探，像在批量试错`,
      todo: "先停手核对目标清单，别继续堆请求；批量试错会把时间全花在被拦的动作上",
    };
  }

  if (/在收敛/.test(trend)) {
    // 在收敛是**正常过程**：摸清了边界。明确说「不用停」，免得模型过度自我审查。
    return { must: false, level: "", why: "越界在收敛（已摸清边界），属正常过程", todo: "" };
  }

  // 有拦截但没到停的程度：给一句 caution 而不是 stop
  if (total >= 3) {
    return {
      must: true, level: "caution",
      why: `已累计 ${total} 次拦截（最多：${top.reason}×${top.n}）`,
      todo: "继续前对一眼授权边界，别在同一类理由上反复撞",
    };
  }
  return { must: false, level: "", why: "", todo: "" };
}

/**
 * 把判定渲染成「下一步」前面的一行；不需要停时返回 ""（不硬塞噪音）。
 * @param {object} judge
 * @param {{ short?: boolean }} opts - short=true 时只留「为什么」，不给行动（供 stop 场景下
 *   紧接着还有一行「→ 下一步：先核对授权…」时用，避免两行说同一句话）
 */
export function renderPressure(judge = {}, opts = {}) {
  if (!judge || !judge.must) return "";
  const tag = judge.level === "stop" ? "⛔ 先停手" : "⚠ 注意";
  if (opts.short) return `${tag}：${judge.why}`;
  return `${tag}：${judge.why}。${judge.todo}`;
}

/** stop 场景下「下一步」该写什么（与 renderPressure 的 short 形式配对，不重复理由） */
export function pressureNext(judge = {}) {
  return judge && judge.must && judge.level === "stop" ? `先核对授权再动手 —— ${judge.todo}` : "";
}
