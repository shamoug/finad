@echo off
rem Installs or updates Finad for this Windows user: downloads the app runtime, installs the app to
rem %LOCALAPPDATA%\Programs\Finad and adds Start Menu and Desktop shortcuts. No admin rights, no setup program.
title Install Finad
cd /d "%~dp0"
set "FINAD_DIR=%~dp0"
rem A zip received from a browser marks its files as downloaded, which can stop PowerShell from running them.
powershell -NoProfile -Command "Get-ChildItem -LiteralPath $env:FINAD_DIR -Recurse -File | Unblock-File -ErrorAction SilentlyContinue"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\install.ps1" %*
echo.
pause
