<#
  Draws Finad's icon at every size the app needs (desktop .ico/.png, tray, website, Android launcher icons).
  Run once after changing the design:  powershell -ExecutionPolicy Bypass -File scripts\make-icons.ps1
#>
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot

function New-Icon([int]$size, [bool]$background = $true, [double]$scale = 1.0) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([System.Drawing.Color]::Transparent)
  $s = $size / 64.0
  if ($background) {
    $r = 14 * $s; $d = 2 * $r
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc(0, 0, $d, $d, 180, 90); $p.AddArc($size - $d, 0, $d, $d, 270, 90)
    $p.AddArc($size - $d, $size - $d, $d, $d, 0, 90); $p.AddArc(0, $size - $d, $d, $d, 90, 90); $p.CloseFigure()
    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush ([System.Drawing.Point]::new(0, 0)), ([System.Drawing.Point]::new($size, $size)), ([System.Drawing.Color]::FromArgb(255, 20, 36, 62)), ([System.Drawing.Color]::FromArgb(255, 9, 16, 30))
    $g.FillPath($bg, $p)
  }
  # Content is drawn around the centre, shrunk by $scale (Android's adaptive icons keep a safe zone).
  $g.TranslateTransform($size / 2, $size / 2); $g.ScaleTransform($scale, $scale); $g.TranslateTransform(-$size / 2, -$size / 2)
  $green = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 46, 194, 126)), ([float](5.5 * $s))
  $green.StartCap = 'Round'; $green.EndCap = 'Round'; $green.LineJoin = 'Round'
  $pts = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(12 * $s, 45 * $s), [System.Drawing.PointF]::new(24 * $s, 32 * $s),
    [System.Drawing.PointF]::new(32 * $s, 39 * $s), [System.Drawing.PointF]::new(50 * $s, 18 * $s))
  $g.DrawLines($green, $pts)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 46, 194, 126))), [float](45.5 * $s), [float](13.5 * $s), [float](9 * $s), [float](9 * $s))
  $red = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 240, 100, 90)), ([float](4.5 * $s))
  $red.StartCap = 'Round'; $red.EndCap = 'Round'
  $g.DrawLine($red, [float](12 * $s), [float](21 * $s), [float](23 * $s), [float](21 * $s))
  $g.DrawLine($red, [float](12 * $s), [float](29 * $s), [float](18 * $s), [float](29 * $s))
  $g.Dispose()
  return $bmp
}

function Save-Png($bmp, [string]$path) {
  New-Item -ItemType Directory -Force (Split-Path -Parent $path) | Out-Null
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}

# Windows .ico holding PNG images (allowed since Vista).
function Save-Ico([int[]]$sizes, [string]$path) {
  $images = foreach ($sz in $sizes) { $b = New-Icon $sz; $ms = New-Object IO.MemoryStream; $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose(); ,$ms.ToArray() }
  $out = New-Object IO.MemoryStream; $w = New-Object IO.BinaryWriter $out
  $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
  $offset = 6 + 16 * $sizes.Count
  for ($i = 0; $i -lt $sizes.Count; $i++) {
    $sz = $sizes[$i]; $len = $images[$i].Length
    $w.Write([byte]($(if ($sz -ge 256) { 0 } else { $sz }))); $w.Write([byte]($(if ($sz -ge 256) { 0 } else { $sz })))
    $w.Write([byte]0); $w.Write([byte]0); $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$len); $w.Write([uint32]$offset)
    $offset += $len
  }
  foreach ($img in $images) { $w.Write($img) }
  [IO.File]::WriteAllBytes($path, $out.ToArray())
}

Save-Png (New-Icon 256) (Join-Path $root 'desktop\icon.png')
Save-Png (New-Icon 32) (Join-Path $root 'desktop\tray.png')
Save-Ico @(16, 24, 32, 48, 64, 128, 256) (Join-Path $root 'desktop\icon.ico')
Save-Png (New-Icon 192) (Join-Path $root 'public\icon.png')
Save-Png (New-Icon 512) (Join-Path $root 'docs\assets\icon.png')
Save-Png (New-Icon 64) (Join-Path $root 'docs\favicon.png')

$res = Join-Path $root 'android\app\src\main\res'
$densities = @{ mdpi = 48; hdpi = 72; xhdpi = 96; xxhdpi = 144; xxxhdpi = 192 }
foreach ($k in $densities.Keys) {
  $sz = $densities[$k]
  Save-Png (New-Icon $sz) (Join-Path $res "mipmap-$k\ic_launcher.png")
  # Adaptive icon foreground: 108dp canvas, content inside the 66dp safe zone.
  Save-Png (New-Icon ([int]($sz * 108 / 48)) $false 0.62) (Join-Path $res "mipmap-$k\ic_launcher_foreground.png")
}
Write-Host 'Icons written.'
