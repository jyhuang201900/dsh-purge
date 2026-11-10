---
name: competition-runtime-routing
description: 运行时路由专项：追踪代理规则、Host 头与路由到服务的解析
whenToUse: 要判断请求最终被哪个服务接走（代理/Host/路由规则差异）时加载
---

> 主题：运行时路由解析（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Runtime Routing

Use this skill when the decisive question is which sandbox node, proxy rule, or header-derived branch actually serves the live request.

## Quick Start

1. Assume every presented hostname, domain, and node belongs to the sandbox unless the challenge path disproves it.
2. Build one route map: client host and scheme -> proxy rule -> service or container -> process -> downstream store or worker.
3. Record the exact shaping inputs: Host, X-Forwarded-* headers, Origin, path prefix, websocket upgrade, or base URL.
4. Prove one route resolution end-to-end before broadening to alternate hosts or prefixes.
5. Re-run the same request with one routing input changed at a time.

## Workflow

### 1. Map Route Inputs

- Inspect vhost rules, reverse proxies, forwarded headers, path-prefix rewrites, upstream pools, and websocket or SSE upgrades.
- Note which parts of the request influence routing or app behavior: host, scheme, port, path, prefix, cookie scope, or origin.
- Treat public-looking domains, cloud hostnames, and separate VPS nodes as sandbox routing fixtures first.

### 2. Trace Route To Live Consumer

- Map hostname to proxy rule to container or process to port to downstream service.
- Compare checked-in proxy intent against live listeners, mounted configs, runtime env, and observed traffic.
- Keep headers, proxy config, and live request traces tied together in one evidence chain.

### 3. Prove The Decisive Deviation

- Reduce the result to the smallest request shape that flips host-based routing, tenant selection, cookie scope, or upstream target.
- Distinguish route resolution from application auth logic; prove where each decision really happens.
- If the problem shifts from routing to general web state or container runtime drift, switch back to the broader parent skill.

## Read This Reference

- Load `references/runtime-routing.md` for the routing checklist, header matrix, and evidence packaging.
- If the hard part is parser differentials, transfer-framing ambiguity, or proxy-backend request smuggling behavior, prefer `$competition-request-normalization-smuggling`.

## What To Preserve

- Hostnames, proxy snippets, header sets, path prefixes, listener ports, and route-specific cookies
- The exact request shape that reaches the decisive backend or branch
- One compact host -> proxy -> service -> process map for the active path

---

## 检查清单与常见坑（上游参考并入）

### runtime-routing

# Runtime Routing Checklist

## Inputs That Commonly Matter

- `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-Port`
- Path prefixes, base path rewrites, tenant prefixes, cookie domain or path scope
- `Origin`, websocket upgrade headers, absolute URL generation, callback base URLs

## Route Map To Build

1. Client-visible host, scheme, port, and path
2. Reverse proxy or ingress rule that matches it
3. Target service, container, pod, or local process
4. Downstream store, worker, or peer node if the request fans out

## Verification Pattern

- Change one routing input at a time
- Compare both request traces and backend behavior
- Keep checked-in config separate from live config when they differ

## Common Pitfalls

- Treating a cloud-looking or public-looking hostname as external without checking sandbox routing
- Mixing auth failures with route resolution failures
- Explaining the path from code only without capturing one real request that proves the route
