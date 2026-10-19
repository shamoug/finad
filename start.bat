@echo off
title Finad
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Run install.bat first, or get Node from https://nodejs.org
  pause
  exit /b 1
)
node server.js
pause
