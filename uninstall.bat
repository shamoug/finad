@echo off
title Uninstall Finad
powershell -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\Programs\Finad\setup\uninstall.ps1"
pause
