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
if (-not (Test-Path (Join-Path $appDir 'package.json'))) {
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
  Log "改名失败——什么都没变，宿主可以照常启动（回滚点未动）"
  exit 5
}
if ($Mode -eq 'off') { Log "已改名：app.asar → app.asar.disabled（内容未动）" }
else { Log "已回滚：app.asar.disabled → app.asar" }

Log "启动宿主：$Exe"
Start-Process -FilePath $Exe
Log "完成。若宿主起不来：直接再跑一次 -Mode on 即回到原状（或手动把 app.asar.disabled 改回 app.asar）"