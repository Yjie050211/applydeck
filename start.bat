@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title ApplyDeck

where node >nul 2>nul
if errorlevel 1 (
  echo [error] Node.js not found.
  echo Please install Node.js 22 or newer: https://nodejs.org
  pause
  exit /b 1
)

echo Starting ApplyDeck (http://127.0.0.1:8788) ...
node server/index.mjs
echo.
echo Service stopped.
pause
