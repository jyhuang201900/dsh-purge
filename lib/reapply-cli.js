import { reapplyInstalled } from "./reapply.js";

const result = await reapplyInstalled({ scheduleSwap: false }); // 命令行里不安排宿主重启（与 lib/index.js 的用法一致，避免默认值偷偷触发重启）
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exit(result.ok ? 0 : 1);
