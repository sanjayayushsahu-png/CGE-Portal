@echo off
title CGE Form 1 & Form 2 Staff Census Software
cd /d "%~dp0"
echo Stopping any older server on port 3456...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3456 " ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>&1
)
echo Starting CGE Staff Census Software on http://localhost:3456 ...
start "" "http://localhost:3456"
node server.js
pause
