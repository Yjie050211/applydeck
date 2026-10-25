@echo off
setlocal
cd /d "%~dp0"

if not exist "data\server.pid" (
  echo ApplyDeck is not running: data\server.pid not found.
  pause
  exit /b 0
)

set /p APP_PID=<data\server.pid
tasklist /FI "PID eq %APP_PID%" /NH 2>nul | find /I "node.exe" >nul
if errorlevel 1 (
  echo ApplyDeck is not running: stale pid file removed.
  del /q "data\server.pid" >nul 2>nul
  pause
  exit /b 0
)

echo Stopping ApplyDeck (pid %APP_PID%) ...
taskkill /PID %APP_PID% /F >nul 2>nul
if exist "data\server.pid" del /q "data\server.pid" >nul 2>nul
echo Done.
timeout /t 2 >nul
