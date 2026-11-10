/**
 * 技能质量判据的**单一来源**：谁要判「第二发覆盖率」，都从这里取，不各写一份。
 *
 * 为什么抽出来：第 111 轮实测踩到「生成器与闸门判据不一致」——`inject-second-shot` 见到
 * 标题里有「兜底」两字就认为作者已写失败分支而跳过，而闸门按「≥2 条分支条目」判，
 * 于是 3 个技能两边都放行、实际是空的（dir-bruteforce / kimi-webbridge）。判据分家就会这样。
 *
 * 分支条目 = 失败分支小节内，能独立成一条「换法」的行：
 *   · 编号项（1. / 2.）、项目符号（- / * / · / →）
 *   · **表格数据行**（`| 现象 | 原因 | 处理 |`）——常见坑多用表格写，同样是一条分支
 * 小节边界按**标题层级**判：进入小节后，其下的 ### / #### 仍属本小节，同级或更高级才结束
 * （否则 competition-* 那种「小节 + 子清单」会被误判成 0 条）。
 */

/** 失败分支类小节的标题特征 */
export const BRANCH_HEAD = /^(#{2,4})\s*.*(失败分支|第二发|打不出去|被拦|无回显|退路|兜底|不成立时|不通时|失败了|注意事项|常见坑|排查)/;

const ITEM = /^\s*(?:\d+[.、)]|[-*·→])\s+\S/;
const TABLE_ROW = /^\s*\|.*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|[\s:|-]+\|\s*$/;
const ANY_HEAD = /^(#{1,6})\s/;

/** 统计一个技能正文里的失败分支条目数 */
export function countBranches(text) {
  const lines = String(text || "").split(/\r?\n/);
  let branches = 0, sawSection = false, sectionLevel = 0;
  for (const line of lines) {
    const mh = ANY_HEAD.exec(line);
    if (mh) {
      const hm = BRANCH_HEAD.exec(line);
      if (hm) { sawSection = true; sectionLevel = hm[1].length; }
      else if (sectionLevel && mh[1].length <= sectionLevel) sectionLevel = 0;
      continue;
    }
    if (!sectionLevel) continue;
    if (ITEM.test(line)) { branches += 1; continue; }
    if (TABLE_ROW.test(line) && !TABLE_SEP.test(line)) {
      // 表头行（形如 | 现象 | 原因 | 处理 |）不算分支，其余数据行算
      const cells = line.split("|").map((x) => x.trim()).filter(Boolean);
      if (cells.length >= 2 && !/^(现象|问题|情况|症状|失败|item|case)$/i.test(cells[0])) branches += 1;
    }
  }
  return { branches, sawSection };
}
