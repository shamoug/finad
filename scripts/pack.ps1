<#
  Packs a Finad release into docs\downloads (the website's download folder):
    Finad-Installer.zip  install.bat + scripts + app\   (what people download)
    Finad-app.zip        the app's files only           (what installed copies download to update themselves)
    desktop.json         version, address and SHA-256 of Finad-app.zip (read by lib/updater.js)
  Run:  powershell -ExecutionPolicy Bypass -File scripts\pack.ps1 [-Notes "what changed"]
#>
param([string]$Notes = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -Raw (Join-Path $root 'package.json') | ConvertFrom-Json).version
$out = Join-Path $root 'docs\downloads'
$stage = Join-Path $env:TEMP "finad-pack-$version"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $out, "$stage\installer\app", "$stage\installer\scripts" | Out-Null

$appFiles = 'server.js', 'package.json', 'lib', 'public', 'desktop'
foreach ($f in $appFiles) { Copy-Item -Recurse (Join-Path $root $f) "$stage\installer\app\" }
New-Item -ItemType Directory -Force "$stage\installer\app\scripts" | Out-Null
Copy-Item (Join-Path $root 'scripts\selftest.js') "$stage\installer\app\scripts\"
Copy-Item (Join-Path $root 'scripts\install.ps1'), (Join-Path $root 'scripts\uninstall.ps1') "$stage\installer\scripts\"
Copy-Item (Join-Path $root 'install.bat'), (Join-Path $root 'uninstall.bat') "$stage\installer\"
Set-Content -Encoding UTF8 "$stage\installer\README.txt" "Finad $version`r`n`r`nDouble-click install.bat. It installs Finad for you (no admin rights), adds Start Menu and Desktop shortcuts, and starts it.`r`nFinad then starts with Windows and keeps reading the news from the system tray.`r`n`r`nhttps://shamoug.github.io/finad/"

$installer = Join-Path $out 'Finad-Installer.zip'
$app = Join-Path $out 'Finad-app.zip'
Remove-Item -Force $installer, $app -ErrorAction SilentlyContinue
Compress-Archive -Path "$stage\installer\*" -DestinationPath $installer
Compress-Archive -Path "$stage\installer\app\*" -DestinationPath $app
$sha = (Get-FileHash -Algorithm SHA256 $app).Hash.ToLower()
$info = [ordered]@{ version = $version; url = 'https://shamoug.github.io/finad/downloads/Finad-app.zip'; sha256 = $sha; notes = $Notes; date = (Get-Date -Format 'yyyy-MM-dd') }
[IO.File]::WriteAllText((Join-Path $out 'desktop.json'), ($info | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
Remove-Item -Recurse -Force $stage
Get-ChildItem $out | Select-Object Name, Length | Format-Table -AutoSize
