@echo off
title MindQuest Portable Launcher
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [!] Node.js was not found on this computer.
  echo [*] Opening Solo Offline Edition directly in your browser...
  start "" "%~dp0public\offline-solo.html"
  exit /b 0
)

echo [*] Starting MindQuest Portable Server (Zero npm dependencies needed)...
echo [*] Opening http://localhost:3000 in your browser...
start "" "http://localhost:3000"
node server.mjs
pause
