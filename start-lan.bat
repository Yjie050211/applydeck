@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title ApplyDeck (LAN)

where node >nul 2>nul
if errorlevel 1 (
  echo [error] Node.js not found.
  echo Please install Node.js 22 or newer: https://nodejs.org
  pause
  exit /b 1
)

echo Starting ApplyDeck in LAN mode...
node server/index.mjs --lan
echo.
echo Service stopped.
pause
