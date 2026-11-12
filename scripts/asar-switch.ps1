# 用途：在「宿主加载 app.asar」与「宿主加载 resources/app 目录」之间切换，且**不依赖任何会话**。
# 为什么要有它：这条命令必须由宿主之外的进程执行——改名的前提是宿主已退出，而 Agent 本身跑在宿主里，
# 宿主一退 Agent 就没了，没人去改名、也没人去重新拉起。所以把它做成一个独立看门进程：
#   ① 由你启动 → ② 你在界面里正常退出宿主 → ③ 它检测到进程消失 → ④ 改名 → ⑤ 自动拉起宿主 → ⑥ 写日志。
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\asar-switch.ps1 -Mode off
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\asar-switch.ps1 -Mode on
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\asar-switch.ps1 -Mode off -DryRun   # 只看不动
param(
  [ValidateSet('off', 'on')][string]$Mode = 'off',
  [string]$Exe = 'E:\Program Files\harness\DeepSeek Harness.exe',
  [int]$WaitSec = 900,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$logDir = Join-Path $env:USERPROFILE '.dsh\dsh-purge'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$log = Join-Path $logDir 'asar-switch.log'
function Log([string]$m) {
  $line = "{0} {1}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $m
  $line | Tee-Object -FilePath $log -Append | Out-Host
}

if (-not (Test-Path $Exe)) { Log "找不到宿主可执行文件：$Exe"; exit 2 }
$resources = Join-Path (Split-Path $Exe -Parent) 'resources'
$asar = Join-Path $resources 'app.asar'
$parked = Join-Path $resources 'app.asar.disabled'
$appDir = Join-Path $resources 'app'
$procName = 'DeepSeek Harness'

Log "模式=$Mode｜resources=$resources｜DryRun=$DryRun"
# 只在「切到目录形态」时要求目录完整；回滚（on）时本来就要把目录挪走，不能要求它还在。
if ($Mode -eq 'off' -and -not (Test-Path (Join-Path $appDir 'package.json'))) {
  Log "resources\app 不完整（缺 package.json）——不切，避免把宿主切成起不来的形态"
  exit 3
}

if ($DryRun) {
  Log "DryRun：不做任何改动。当前 app.asar=$(Test-Path $asar)｜app.asar.disabled=$(Test-Path $parked)｜宿主在跑=$([bool](Get-Process $procName -ErrorAction SilentlyContinue))"
  exit 0
}

if ($Mode -eq 'off') {
  if (-not (Test-Path $asar)) { Log "app.asar 已不在（已是目录形态），无需处理"; exit 0 }
} else {
  if (-not (Test-Path $parked)) { Log "没有 app.asar.disabled，无需回滚"; exit 0 }
}

# 等宿主退出：Agent 也在这个进程里，所以这里必须等，不能自己先动手。
Log "等待宿主退出（最多 $WaitSec 秒）……请现在退出 DeepSeek Harness"
$waited = 0
while ($waited -lt $WaitSec) {
  $p = Get-Process $procName -ErrorAction SilentlyContinue
  if (-not $p) { break }
  Start-Sleep -Seconds 2
  $waited += 2
}
if (Get-Process $procName -ErrorAction SilentlyContinue) {
  Log "等待超时（$WaitSec 秒）宿主仍在跑——什么都没改，退出。重跑即可。"
  exit 4
}
Log "宿主已退出（等待 ${waited}s），开始改名"

# 进程刚退时文件句柄可能还没完全释放，重试几次而不是一次失败就放弃。
$done = $false
# 回滚（on）必须先把目录挪走：asar 与 resources/app 并存是**已知会崩**的形态
# （2026-11-12 实测：shell 与 host 子进程来自不同根，首个 IPC 事件不合 schema，三次启动全报 invalid IPC event）。
$staleDir = ""
if ($Mode -eq 'on' -and (Test-Path $appDir)) {
  $staleDir = Join-Path $resources ("app.dshpurge-stale-" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
  try { Rename-Item -LiteralPath $appDir -NewName (Split-Path $staleDir -Leaf) -ErrorAction Stop; Log "已把 resources\app 挪开 → $(Split-Path $staleDir -Leaf)（避免混合态）" }
  catch { Log "挪开 resources\app 失败：$($_.Exception.Message)——中止，不做半切换"; exit 6 }
}
for ($i = 1; $i -le 10; $i++) {
  try {
    if ($Mode -eq 'off') { Rename-Item -LiteralPath $asar -NewName 'app.asar.disabled' -ErrorAction Stop }
    else { Rename-Item -LiteralPath $parked -NewName 'app.asar' -ErrorAction Stop }
    $done = $true
    break
  } catch {
    Log "第 $i 次改名失败：$($_.Exception.Message)（500ms 后重试）"
    Start-Sleep -Milliseconds 500
  }
}
if (-not $done) {
  # 审计 C2：on 模式在前面已经把 resources\app 挪成 stale，这里再打印「什么都没变」就是撒谎——
  # 此刻两边都没有（目录被挪走、asar 仍叫 .disabled），宿主起来只会二次崩。所以先放回目录，再按真实三态报。
  $restored = $false
  if ($staleDir -and (Test-Path $staleDir) -and -not (Test-Path $appDir)) {
    try { Rename-Item -LiteralPath $staleDir -NewName 'app' -ErrorAction Stop; $restored = $true }
    catch { Log "放回 resources\\app 也失败：$($_.Exception.Message)" }
  }
  Log "改名失败，宿主未启动。真实形态：app.asar=$(Test-Path $asar)｜app.asar.disabled=$(Test-Path $parked)｜resources\\app=$(Test-Path $appDir)｜目录已放回=$restored"
  exit 5
}
if ($Mode -eq 'off') { Log "已改名：app.asar → app.asar.disabled（内容未动）" }
else { Log "已回滚：app.asar.disabled → app.asar" }

Log "启动宿主：$Exe"
Start-Process -FilePath $Exe

# **看门狗**：切完如果 90 秒内起不来，自动回到已知可用形态（asar 密封）。
# 为什么要有它：2026-11-12 那次崩机就是切完起不来、而人不在旁边，只能事后手工修。
$up = $false
for ($i = 1; $i -le 45; $i++) {
  Start-Sleep -Seconds 2
  if (Get-Process $procName -ErrorAction SilentlyContinue) { $up = $true; break }
}
if ($up) {
  Log "宿主已启动 ✓ 切换完成（模式=$Mode）"
  exit 0
}

Log "宿主 90 秒内没起来 —— 自动回滚到已知可用形态（asar 密封）"
try {
  if ($Mode -eq 'off') {
    # 审计 C3：这里原来只把 parked 改回 app.asar，不挪 resources\app → 正好造出混合态，
    # 然后按该形态重启，日志还说「已按回滚形态重新启动」。先把目录挪开，再恢复 asar。
    if (Test-Path $appDir) {
      $lateStale = Join-Path $resources ("app.dshpurge-stale-" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
      try { Rename-Item -LiteralPath $appDir -NewName (Split-Path $lateStale -Leaf) -ErrorAction Stop; Log "已把 resources\\app 挪开 → $(Split-Path $lateStale -Leaf)（避免回滚造出混合态）" }
      catch { Log "挪开 resources\\app 失败：$($_.Exception.Message)"; exit 8 }
    }
    if (Test-Path $parked) { Rename-Item -LiteralPath $parked -NewName 'app.asar' -ErrorAction Stop; Log "已恢复 app.asar" }
  } else {
    if (Test-Path $asar) { Rename-Item -LiteralPath $asar -NewName 'app.asar.disabled' -ErrorAction Stop; Log "已放回 app.asar.disabled" }
    if ($staleDir -and (Test-Path $staleDir)) { Rename-Item -LiteralPath $staleDir -NewName 'app' -ErrorAction Stop; Log "已把挪开的目录放回 resources\app" }
  }
} catch {
  Log "回滚失败：$($_.Exception.Message)（手工修：把 app.asar.disabled 改回 app.asar，再删/改名 resources\app）"
  exit 8
}
Start-Process -FilePath $Exe
Log "已按回滚形态重新启动宿主，请检查是否能打开"
exit 7