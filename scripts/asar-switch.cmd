@echo off
rem 用途：双击即用的入口——拉起一个**独立于宿主**的看门进程，然后你在界面里正常退出宿主即可。
rem 看门进程会：等宿主退出 → 把 app.asar 改名成 app.asar.disabled → 自动重新拉起宿主 → 写日志。
rem 日志：%USERPROFILE%\.dsh\dsh-purge\asar-switch.log
rem 回滚：把 -Mode off 改成 -Mode on 再跑一次。
setlocal
set MODE=%1
if "%MODE%"=="" set MODE=off
start "dsh-purge asar switch" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0asar-switch.ps1" -Mode %MODE%
echo 看门进程已启动（模式=%MODE%）。现在请在 DeepSeek 界面里正常退出宿主。
echo 它会等你退出，然后改名并自动重新启动宿主。日志见 %%USERPROFILE%%\.dsh\dsh-purge\asar-switch.log
timeout /t 8 >nul