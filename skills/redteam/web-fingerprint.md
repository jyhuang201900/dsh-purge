---
name: web-fingerprint
description: Web 服务指纹识别：框架、中间件、CMS、组件版本，为漏洞检测准备弹药
whenToUse: 已发现 HTTP/HTTPS 服务，需要识别技术栈时
role: assess
enabled: true
---

# Web 指纹识别（框架 / 中间件 / CMS / 组件版本）

## 方法（从便宜到贵，顺序别反）

1. **响应头**：`Server`、`X-Powered-By`、`Set-Cookie` 名（`JSESSIONID`=Java、`PHPSESSID`=PHP、`ASP.NET_SessionId`=.NET、`laravel_session`、`connect.sid`）、`X-AspNet-Version`、`X-Runtime`。
2. **页面与路径特征**：报错页、`robots.txt`、`favicon.ico` 哈希、默认 404 页、静态资源目录结构、`/manager/html`（Tomcat）、`/phpmyadmin/`、`/actuator/health`（Spring Boot）、`/api-docs`、`/swagger-ui.html`。
3. **批量存活 + 技术栈**（首选，一条命令出全表）：

```bash
~/.local/bin/pd-httpx -l runs/alive-urls.txt \
  -title -status-code -tech-detect -web-server -follow-redirects \
  -silent -json -o runs/httpx-fp.jsonl
# 只看某类栈
jq -r 'select((.tech|join(","))|test("tomcat|spring|jenkins|nginx|iis";"i")) | [.url,.tech,.title]|@tsv' runs/httpx-fp.jsonl
```

> ⚠️ **ProjectDiscovery 版必须用 `pd-httpx` 或绝对路径 `~/.dsh/redteam/toolkit/httpx/httpx`；`/usr/bin/httpx` 是 Python httpx 库的 CLI，参数完全不同。**

4. **nuclei 技术模板**（httpx 判不出时补刀）：

```bash
nuclei -u http://TARGET -tags tech -silent -json -o runs/tech.jsonl
nuclei -u http://TARGET -s critical,high -t ~/.local/nuclei-templates -json -o runs/nuclei-fp.jsonl
```

5. **favicon 哈希反查**：

```bash
curl -s http://TARGET/favicon.ico | base64 -w0 | head -c 64; echo
# 拿 hash 去 https://wiki.owasp.org/index.php/OWASP_Favicon_Database 或 fofa 查：
#   icon_hash=="<hash>"      （fofa 语法，见技能 fofa-recon）
```

6. **前端 JS 里的栈与接口**（SPA 必做，技能 `browser-automation`）：

```bash
curl -s http://TARGET/ | grep -oE 'src="[^"]+\.js"' | sed 's/.*="//;s/"//' | head -20
curl -s http://TARGET/<bundle>.js | grep -oE '"/api/[a-zA-Z0-9_/{}.-]+"' | sort -u > runs/api.txt
# 版本线索
curl -s http://TARGET/<bundle>.js | grep -oE '(angular|vue|react|webpack)[^"]{0,20}' | sort -u | head
```

7. **大网段批量指纹**用技能 `gogo-intranet`（`gogo -i <cidr> -p top2 -v --af`，主动指纹要加 `-v`）。

## 命中即定版本（指纹 → 可打性）

| 指纹信号 | 下一步 |
| --- | --- |
| Spring Boot + `/actuator` 开放 | 未授权信息泄露 / log4j / 已知 CVE，转 `unauth-exploit`、`nuclei-scan` |
| Tomcat 管理台 / `manager/html` | 弱口令爆破，转 `credential-attack` |
| 已知 CMS（dedecms / phpmyadmin / wordpress / javakey） | 直接查 Nday，转 `nuclei-scan` |
| `X-Powered-By: PHP/5.x` 或 `Server: Apache/2.2` | 老栈，优先反序列化与已知 RCE |
| Jenkins / Concourse / GitLab 面板 | 未授权 + 已知 CVE，优先级最高 |
| 中文登录页 + 非常规端口（4430/8443/2663）+ 版权含厂商名 | **先当安全设备认**：深信服/H3C/奇安信/TOPSEC/堡垒机/邮件网关 → 转 `secdev-boundary`（边界突破与集权系统是最贵的分） |
| 554/8000/37777 端口、ISAPI、ONVIF、snapshot.cgi | 摄像头 / NVR → 转 `iot-iiot-netdev`（`iot-platform` 得分） |
| 502/102/4840/9600 端口 | 工控（Modbus/S7/OPC-UA）→ 转 `iot-iiot-netdev`（`iiot` 得分，只读优先） |
| 23/161/2601 端口、SNMP 响应带型号 | 网络设备（路由器/交换机）→ 转 `iot-iiot-netdev`（`netdev` 得分，public community 一发即出内网地图） |

## 失败分支

- **CDN 挡在前面**（标题/指纹全是 CF）→ 别急着定栈：先找源 IP（历史解析、`/api` 直连、邮件头、证书 SAN，见 `passive-recon`），再对源 IP 重新指纹。
- **httpx 判不出栈** → 上 `nuclei -tags tech`；再不行手工看 cookie 名 + 报错页 + 静态资源路径。
- **WAF 吞掉特征头** → 换 HTTP/2、加随机 UA、直接请求特征路径（`/actuator/health`、`/manager/html`）看状态码差异。
- **HTTPS 证书自签 / 链不全** → `pd-httpx -no-ssl` 或 `curl -k`，别因为证书报错就跳过整站。

## 落库要求

- 每个识别结果 `redteam_asset_add`：`ports[].product`（组件名）、`ports[].version`（版本，未知写"未知"不要编）、`ports[].url`、`note` 写**证据**（哪个头 / 哪个路径 / 哪个哈希）。
- `category` 分：框架 / 中间件 / CMS / 组件 / 语言运行时。
- 有指纹没版本 = 半成品：标 `version=unknown` 并写清下一步怎么定版本。
- `redteam_chain_add`：`stage_code=assess`，`tool` 写实际命令原文，`result` 写"识别出 N 个栈，其中 M 个有已知 CVE"。
