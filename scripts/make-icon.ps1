param(
  [string]$SourcePng = 'src/renderer/assets/logo-marca.png',
  [string]$IcoPath = 'build/icon.ico',
  [string]$PngPath = 'build/icon.png'
)

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$root = (Get-Location).Path
$inputFile = Join-Path $root $SourcePng
$outputIco = Join-Path $root $IcoPath
$outputPng = Join-Path $root $PngPath

foreach ($target in @($outputIco, $outputPng)) {
  $folder = Split-Path -Parent $target
  if ($folder -and -not (Test-Path $folder)) {
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
  }
}

$logoBitmap = [System.Drawing.Bitmap]::FromFile($inputFile)
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$frames = @()

foreach ($size in $sizes) {
  $tile = New-Object System.Drawing.Bitmap($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($tile)
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $graphics.DrawImage($logoBitmap, $rect)
  $graphics.Dispose()

  $stream = New-Object System.IO.MemoryStream
  $tile.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $tile.Dispose()
  $bytes = $stream.ToArray()
  $stream.Dispose()

  $frames += @{ Size = $size; Bytes = $bytes }
  if ($size -eq 256) {
    [System.IO.File]::WriteAllBytes($outputPng, $bytes)
  }
}

$logoBitmap.Dispose()

$offset = 6 + (16 * $frames.Count)
$buffer = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($buffer)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]1)
$writer.Write([byte]0)
$writer.Write([byte]$frames.Count)
$writer.Write([byte]0)

foreach ($frame in $frames) {
  $dimension = if ($frame.Size -ge 256) { [byte]0 } else { [byte]$frame.Size }
  $writer.Write($dimension)
  $writer.Write($dimension)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]32)
  $writer.Write([uint32]$frame.Bytes.Length)
  $writer.Write([uint32]$offset)
  $offset += $frame.Bytes.Length
}

foreach ($frame in $frames) {
  $writer.Write($frame.Bytes)
}

$writer.Flush()
[System.IO.File]::WriteAllBytes($outputIco, $buffer.ToArray())
$writer.Dispose()
$buffer.Dispose()

Write-Host "icon: $outputIco"
Write-Host "png:  $outputPng"
