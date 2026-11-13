<!-- 本文件从 http-smuggling.md 外移而来（2026-11-14 Progressive Disclosure 重构）。
     主文件只保留工作流；这里是查阅型内容，按需读取。 -->

# H1 真实案例

_共 38 份 HackerOne 已披露 High/Critical 报告命中本类，按 (赏金 + 投票×100) 排序取 Top 12_

| Severity | $ | 程序 | 标题（点击看原报告） | 摘要 |
|---|--:|---|---|---|
| High | 20000 usd | PayPal | [Bypass for #488147 enables stored XSS on https://paypal.com/signin again](https://hackerone.com/reports/510152) | Bypass for #488147 enables stored XSS on https://paypal.com/signin again |
| High | 18900 usd | PayPal | [Stored XSS on https://paypal.com/signin via cache poisoning](https://hackerone.com/reports/488147) | Stored XSS on https://paypal.com/signin via cache poisoning |
| Critical | — | Slack | [Mass account takeovers using HTTP Request Smuggling on https://slackb.com/ to steal session cookies](https://hackerone.com/reports/737140) | Hi Slack Security Team! My name is Evan and I'm a first time bug hunter to your platform :) Because you guys were running a mon… |
| High | — | LY Corporation | [Request smuggling on admin-official.line.me could lead to account takeover](https://hackerone.com/reports/740037) | Request smuggling on admin-official.line.me could lead to account takeover |
| Critical | — | Eternal | [Stealing Zomato X-Access-Token: in Bulk using HTTP Request Smuggling on api.zomato.com](https://hackerone.com/reports/771666) | Intro Hi Zomato Security Team! My name is Evan Custodio and this is my first time evaluating your platform. I specialize in loo… |
| Critical | 7500 usd | Basecamp | [HTTP Request Smuggling via HTTP/2](https://hackerone.com/reports/1211724) | HTTP Request Smuggling via HTTP/2 |
| High | — | Helium | [HTTP request Smuggling](https://hackerone.com/reports/867952) | When malformed or abnormal HTTP requests are interpreted by one or more entities in the data flow between the user and the web … |
| Critical | 6000 usd | Cloudflare Public Bug Bounty | [HTTP Request Smuggling in Transform Rules using hexadecimal escape sequences in the concat() func…](https://hackerone.com/reports/1478633) | HTTP Request Smuggling in Transform Rules using hexadecimal escape sequences in the concat() function |
| High | 750 usd | GSA Bounty | [HTTP Request Smuggling on https://labs.data.gov](https://hackerone.com/reports/726773) | Greetings, The application appears to be vulnerable to HTTP request smuggling due to a disagreement between the front-end and b… |
| High | 4660 usd | Internet Bug Bounty | [Possibility of Request smuggling attack](https://hackerone.com/reports/2280391) | Request smuggling was possible by throwing an IOException with the upper size limit of the trailer header |
| High | — | Node.js | [HTTP Request Smuggling due to CR-to-Hyphen conversion](https://hackerone.com/reports/922597) | NOTE! Thanks for submitting a report! Please replace *all* the [square] sections below with the pertinent details. Remember, th… |
| Critical | 5000 usd | Aiven Ltd | [Grafana RCE via SMTP server parameter injection](https://hackerone.com/reports/1200647) | Summary: This report is similar to #1180653, except with different parameter injection entrypoint |

**命中本类的 weakness 分布：**

- HTTP Request Smuggling：27 条
- CRLF Injection：5 条
- Uncategorized → 手工归类：4 条
- HTTP Response Splitting：2 条
