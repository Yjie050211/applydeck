@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ApplyDeck daily reminder installer
echo.

set "NODE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"

if not defined NODE goto :no_node

echo Node: %NODE%
echo Task: "ApplyDeck Daily Reminder" - every day at 09:30 for the current user
echo.

schtasks /Create /F /SC DAILY /ST 09:30 /TN "ApplyDeck Daily Reminder" /TR "\"%NODE%\" \"%~dp0scripts\remind.mjs\""
if errorlevel 1 goto :create_failed

echo.
echo [OK] Task created: "ApplyDeck Daily Reminder"
echo.
echo Test the notification right now:
echo   node scripts\remind.mjs
echo Preview the text without a popup:
echo   node scripts\remind.mjs --dry-run
echo.
echo Remove it later with uninstall-reminder.bat
echo.
pause
exit /b 0

:no_node
echo.
echo [ERROR] Node.js was not found on PATH.
echo Install Node.js 22.5 or newer from https://nodejs.org and run this file again.
echo.
pause
exit /b 1

:create_failed
echo.
echo [ERROR] Failed to create the scheduled task (see the message above).
echo.
pause
exit /b 1
