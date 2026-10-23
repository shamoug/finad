<#
.SYNOPSIS
  Installs or updates Finad for the current Windows user, without a setup program or admin rights. Run by install.bat.

.DESCRIPTION
  1. The app runtime (Electron): downloaded from its official GitHub release and checked against its SHA-256, only
     when it is missing or a different version. Its program file is renamed Finad.exe.
  2. The app's files are copied into %LOCALAPPDATA%\Programs\Finad\resources\app.
  3. Start Menu and Desktop shortcuts, and an entry in Settings > Apps to uninstall it.
  4. Starts Finad. On its first start it registers itself to start with Windows (in the tray); untick
     "Start with Windows" in its tray menu to stop that.

  Your data (%USERPROFILE%\.finad) is never touched.
#>
[CmdletBinding()]
param([switch]$NoDesktopIcon, [switch]$NoLaunch)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ElectronVersion = '44.5.1'
$dest = Join-Path $env:LOCALAPPDATA 'Programs\Finad'
$appDir = Join-Path $dest 'resources\app'
$exe = Join-Path $dest 'Finad.exe'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Finad'
$port = 4747

function Write-Step([string]$t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }
function Write-Ok([string]$t) { Write-Host "   OK   $t" -ForegroundColor Green }
function Write-Info([string]$t) { Write-Host "        $t" }
function Stop-Setup([string]$t) { throw [System.Exception]::new($t) }

# The app's files: next to this folder when packed to share (..\app), or the project this script is in (..).
function Find-AppSource {
  foreach ($p in (Join-Path $PSScriptRoot '..\app'), (Join-Path $PSScriptRoot '..')) {
    if (Test-Path (Join-Path $p 'server.js')) { return (Resolve-Path $p).Path }
  }
  Stop-Setup "The app's files were not found next to the installer (no server.js)."
}

function Stop-Finad {
  Get-Process -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -and $_.Path.StartsWith($dest, [StringComparison]::OrdinalIgnoreCase) } catch { $false } } |
    Stop-Process -Force -ErrorAction SilentlyContinue
  # A copy started from the project ("node server.js") holds the same port.
  try {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop | ForEach-Object {
      $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
      if ($p -and $p.ProcessName -match '^(node|electron|Finad)$') { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; Write-Info "Stopped $($p.ProcessName) on port $port" }
    }
  } catch {}
  Start-Sleep -Milliseconds 800
}

function New-Shortcut([string]$Path, [string]$Target, [string]$Icon) {
  New-Item -ItemType Directory -Force (Split-Path -Parent $Path) | Out-Null
  $l = (New-Object -ComObject WScript.Shell).CreateShortcut($Path)
  $l.TargetPath = $Target; $l.WorkingDirectory = Split-Path -Parent $Target
  $l.IconLocation = "$Icon,0"; $l.Description = 'Finad - news to stock signals'
  $l.Save()
}

# Copies the app's files, leaving out what only the project needs (Android source, website, git).
function Copy-AppFiles([string]$From, [string]$To) {
  $skip = @('.git', '.github', 'android', 'docs', 'dist', 'node_modules')
  New-Item -ItemType Directory -Force $To | Out-Null
  Get-ChildItem -Force $From | Where-Object { $skip -notcontains $_.Name -and $_.Name -notmatch '\.(bat|sh|md)$' } | ForEach-Object {
    Copy-Item -Recurse -Force $_.FullName (Join-Path $To $_.Name)
  }
}

try {
  $src = Find-AppSource
  $version = [string](Get-Content -Raw (Join-Path $src 'package.json') | ConvertFrom-Json).version
  Write-Host ''
  Write-Host "  Finad $version  -  installing for $env:USERNAME" -ForegroundColor White
  Write-Info "From: $src"
  Write-Info "To:   $dest"

  Write-Step 'Checking this computer'
  $arch = switch ($env:PROCESSOR_ARCHITECTURE) { 'ARM64' { 'arm64' } 'AMD64' { 'x64' } default { if ($env:PROCESSOR_ARCHITEW6432 -eq 'AMD64') { 'x64' } else { 'x86' } } }
  if ($arch -eq 'x86') { Stop-Setup 'Finad needs 64-bit Windows.' }
  Write-Ok "Windows $([Environment]::OSVersion.Version), $arch"

  Write-Step "App runtime (Electron $ElectronVersion)"
  $runtimeFile = Join-Path $dest 'runtime.txt'
  $have = if (Test-Path $runtimeFile) { (Get-Content -Raw $runtimeFile).Trim() } else { '' }
  $needRuntime = -not (Test-Path $exe) -or $have -ne "$ElectronVersion $arch"
  if ($needRuntime) {
    $base = "https://github.com/electron/electron/releases/download/v$ElectronVersion"
    $zipName = "electron-v$ElectronVersion-win32-$arch.zip"
    $tmp = Join-Path $env:TEMP "finad-setup"
    New-Item -ItemType Directory -Force $tmp | Out-Null
    $zip = Join-Path $tmp $zipName
    $sums = (Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").Content
    if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
    $line = ($sums -split "`n") | Where-Object { $_ -match [regex]::Escape($zipName) + '\s*$' } | Select-Object -First 1
    if (-not $line) { Stop-Setup "No checksum for $zipName in the Electron release." }
    $sha = ($line -split '\s+')[0].Trim()
    if (-not ((Test-Path $zip) -and (Get-FileHash -Algorithm SHA256 $zip).Hash -eq $sha)) {
      Write-Info "Downloading $zipName (about 110 MB)â€¦"
      Invoke-WebRequest -UseBasicParsing "$base/$zipName" -OutFile $zip
    }
    if ((Get-FileHash -Algorithm SHA256 $zip).Hash -ne $sha.ToUpper()) { Remove-Item -Force $zip; Stop-Setup 'The runtime download does not match its SHA-256. Run install.bat again.' }
    Write-Ok 'Downloaded and checked (SHA-256)'
  } else { Write-Ok 'Already installed' }

  Write-Step 'Installing the app'
  Stop-Finad
  if ($needRuntime) {
    if (Test-Path $dest) { Get-ChildItem -Force $dest | Where-Object { $_.Name -ne 'resources' } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue }
    New-Item -ItemType Directory -Force $dest | Out-Null
    Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force
    for ($i = 0; $i -lt 10; $i++) {
      try { if (Test-Path $exe) { Remove-Item -Force $exe }; Rename-Item (Join-Path $dest 'electron.exe') 'Finad.exe' -ErrorAction Stop; break }
      catch { if ($i -eq 9) { Stop-Setup "Could not rename electron.exe ($($_.Exception.Message))." }; Start-Sleep -Seconds 2 }
    }
    Remove-Item -Force (Join-Path $dest 'resources\default_app.asar') -ErrorAction SilentlyContinue
    Set-Content -Encoding ASCII $runtimeFile "$ElectronVersion $arch"
  }
  $new = "$appDir.new"
  if (Test-Path $new) { Remove-Item -Recurse -Force $new }
  Copy-AppFiles $src $new
  for ($i = 0; $i -lt 10 -and (Test-Path $appDir); $i++) { try { Remove-Item -Recurse -Force $appDir -ErrorAction Stop } catch { Start-Sleep -Seconds 1 } }
  if (Test-Path $appDir) { Stop-Setup "Could not replace $appDir. Quit Finad from the tray and run this again." }
  Move-Item $new $appDir
  $setupDir = Join-Path $dest 'setup'
  New-Item -ItemType Directory -Force $setupDir | Out-Null
  Copy-Item -Force (Join-Path $PSScriptRoot 'uninstall.ps1') $setupDir
  Get-ChildItem -Recurse -File $dest | Unblock-File -ErrorAction SilentlyContinue
  Write-Ok "Finad $version installed"

  Write-Step 'Shortcuts'
  $icon = Join-Path $appDir 'desktop\icon.ico'
  New-Shortcut (Join-Path ([Environment]::GetFolderPath('Programs')) 'Finad.lnk') $exe $icon
  Write-Ok 'Start Menu'
  $desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Finad.lnk'
  if ($NoDesktopIcon) { Remove-Item -Force $desktopLnk -ErrorAction SilentlyContinue } else { New-Shortcut $desktopLnk $exe $icon; Write-Ok 'Desktop' }

  New-Item -Force $uninstallKey | Out-Null
  $size = [int]((Get-ChildItem -Recurse -File $dest | Measure-Object Length -Sum).Sum / 1KB)
  $values = @{
    DisplayName = 'Finad'; DisplayVersion = $version; Publisher = 'Aladdin Shamoug'; DisplayIcon = $icon; InstallLocation = $dest
    UninstallString = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$setupDir\uninstall.ps1`""
    URLInfoAbout = 'https://shamoug.github.io/finad/'; InstallDate = (Get-Date -Format 'yyyyMMdd')
  }
  foreach ($k in $values.Keys) { New-ItemProperty -Force -Path $uninstallKey -Name $k -Value $values[$k] -PropertyType String | Out-Null }
  foreach ($k in 'NoModify', 'NoRepair') { New-ItemProperty -Force -Path $uninstallKey -Name $k -Value 1 -PropertyType DWord | Out-Null }
  New-ItemProperty -Force -Path $uninstallKey -Name EstimatedSize -Value $size -PropertyType DWord | Out-Null
  Write-Ok 'Listed in Settings > Apps (uninstall from there)'

  Write-Host ''
  Write-Host '  Finad is installed. It starts with Windows and keeps reading the news from the system tray.' -ForegroundColor Green
  Write-Info 'Optional: install Ollama (ollama.com) and run "ollama pull qwen3:4b-instruct" so a local AI also reads the headlines.'
  if (-not $NoLaunch) { Start-Process $exe; Write-Info 'Starting Finad.' }
  exit 0
} catch {
  Write-Host ''
  Write-Host "  INSTALL FAILED: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
