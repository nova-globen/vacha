<#
.SYNOPSIS
	Generates the MSIX logo set for the Microsoft Store package from the brand mark.

.DESCRIPTION
	Reads docs\brand\icon.png (the hexagon, taller than wide), centres it on a
	transparent square with a small margin, and writes every size the package
	manifest and Windows ask for into resources\win32\msix\Assets:
	  - Square44x44Logo (app list, taskbar): scale-100..400 and the
	    targetsize-16..256 icons, plated and unplated
	  - Square150x150Logo (Start tile): scale-100..400
	  - StoreLogo (Store and installer): scale-100..400
	The output is committed; rerun only when the brand mark changes.
#>
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$source = [Drawing.Image]::FromFile((Join-Path $repoRoot 'docs\brand\icon.png'))
$assets = Join-Path $repoRoot 'resources\win32\msix\Assets'
New-Item -ItemType Directory -Force $assets | Out-Null

# The mark fills this share of the square; the rest is transparent margin
$fill = 0.84

function Save-Logo([int]$size, [string]$name) {
	$bitmap = New-Object Drawing.Bitmap $size, $size
	$graphics = [Drawing.Graphics]::FromImage($bitmap)
	try {
		$graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
		$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
		$graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
		$graphics.Clear([Drawing.Color]::Transparent)
		$scale = [Math]::Min($size * $fill / $source.Width, $size * $fill / $source.Height)
		$width = [int][Math]::Round($source.Width * $scale)
		$height = [int][Math]::Round($source.Height * $scale)
		$graphics.DrawImage($source, [int](($size - $width) / 2), [int](($size - $height) / 2), $width, $height)
		$bitmap.Save((Join-Path $assets $name), [Drawing.Imaging.ImageFormat]::Png)
	} finally {
		$graphics.Dispose()
		$bitmap.Dispose()
	}
}

try {
	foreach ($scale in 100, 125, 150, 200, 400) {
		Save-Logo ([int][Math]::Round(44 * $scale / 100)) "Square44x44Logo.scale-$scale.png"
		Save-Logo ([int][Math]::Round(150 * $scale / 100)) "Square150x150Logo.scale-$scale.png"
		Save-Logo ([int][Math]::Round(50 * $scale / 100)) "StoreLogo.scale-$scale.png"
	}
	foreach ($target in 16, 24, 32, 48, 256) {
		Save-Logo $target "Square44x44Logo.targetsize-$target.png"
		Save-Logo $target "Square44x44Logo.targetsize-${target}_altform-unplated.png"
	}
} finally {
	$source.Dispose()
}
Get-ChildItem $assets | Measure-Object | ForEach-Object { "$($_.Count) assets in $assets" }
