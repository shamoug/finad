# Removes Finad for the current user: the app, its shortcuts, "Start with Windows" and its Settings > Apps entry.
# Your data (%USERPROFILE%\.finad: articles, settings, holdings) is kept unless you delete that folder yourself.
$ErrorActionPreference = 'SilentlyContinue'
$dest = Join-Path $env:LOCALAPPDATA 'Programs\Finad'
Get-Process | Where-Object { try { $_.Path -and $_.Path.StartsWith($dest, [StringComparison]::OrdinalIgnoreCase) } catch { $false } } | Stop-Process -Force
Start-Sleep -Seconds 1
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'Shamoug.Finad', 'Finad', 'electron.app.Finad'
Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' | ForEach-Object { $_.PSObject.Properties } | Where-Object { "$($_.Value)" -like "*$dest*" } | ForEach-Object { Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name $_.Name }
Remove-Item -Force (Join-Path ([Environment]::GetFolderPath('Programs')) 'Finad.lnk'), (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Finad.lnk')
Remove-Item -Recurse -Force 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Finad'
# The uninstaller runs from inside the folder it removes: the removal finishes after it exits.
Start-Process -WindowStyle Hidden cmd.exe -ArgumentList '/c', "timeout /t 2 >nul & rmdir /s /q `"$dest`""
Write-Host 'Finad is uninstalled. Your data is kept in' (Join-Path $env:USERPROFILE '.finad')
