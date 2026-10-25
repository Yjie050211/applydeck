@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

schtasks /Query /TN "ApplyDeck Daily Reminder" >nul 2>nul
if errorlevel 1 goto :not_found

schtasks /Delete /F /TN "ApplyDeck Daily Reminder"
if errorlevel 1 goto :delete_failed

echo.
echo [OK] Task removed: "ApplyDeck Daily Reminder"
echo.
pause
exit /b 0

:not_found
echo.
echo [INFO] Task "ApplyDeck Daily Reminder" was not found - nothing to remove.
echo.
pause
exit /b 0

:delete_failed
echo.
echo [ERROR] Failed to delete the task (see the message above).
echo.
pause
exit /b 1
