@echo off
rem ASCII ONLY - cmd.exe reads this file as ANSI; a UTF-8 BOM here makes
rem the first line "'BOM@echo' is not recognized" and nothing runs.
rem
rem Usage:  asar-switch.cmd            switch host to the patched app/ directory
rem         asar-switch.cmd on         roll back (app.asar.disabled -> app.asar)
rem         asar-switch.cmd dryrun     read-only check, changes nothing
rem
rem It starts a watcher process, then YOU quit DeepSeek normally.
rem The watcher waits for it to exit, renames app.asar, and launches it again.
rem Log: %USERPROFILE%\.dsh\dsh-purge\asar-switch.log
setlocal
set "MODE=%~1"
set "EXTRA="
if /I "%MODE%"=="dryrun" (
  set "MODE=off"
  set "EXTRA=-DryRun"
)
if "%MODE%"=="" set "MODE=off"
if /I not "%MODE%"=="off" if /I not "%MODE%"=="on" (
  echo Unknown mode "%MODE%". Use: asar-switch.cmd [off^|on^|dryrun]
  exit /b 2
)
start "dsh-purge asar switch" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0asar-switch.ps1" -Mode %MODE% %EXTRA%
echo Watcher started. Mode=%MODE%.
echo Now quit DeepSeek normally (tray icon - Exit). It will rename app.asar
echo and start the host again automatically.
echo Log: %USERPROFILE%\.dsh\dsh-purge\asar-switch.log
rem `timeout` fails when stdin is redirected ("Input redirection is not supported"),
rem so sleep with ping instead - it works in both interactive and piped runs.
ping -n 7 127.0.0.1 >nul