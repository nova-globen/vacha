<#
.SYNOPSIS
	Builds a release of Vacha into dist\ and zips it.

.DESCRIPTION
	Steps:
	  1. Optionally reinstall node modules (-CleanInstall).
	  2. Package the product with gulp into dist\win32-<arch>.
	  3. Smoke-check the produced executable (--version).
	  4. Zip the package to dist\Vacha-win32-<arch>-<version>.zip (-NoZip to skip).

.EXAMPLE
	.\scripts\release.ps1
	.\scripts\release.ps1 -Arch arm64 -CleanInstall
#>
[CmdletBinding()]
param(
	[ValidateSet('arm64', 'x64')]
	# Defaults to this machine's architecture
	[string]$Arch = $(if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }),
	[switch]$CleanInstall,
	[switch]$NoZip,
	# Release builds are minified by default; pass -NoMinify for a debuggable build
	[switch]$NoMinify,
	# Compile the Inno Setup user installer (requires ISCC.exe on PATH or in %LOCALAPPDATA%\Programs\Inno Setup 6).
	# Inno's licence allows commercial use with no fee; the vendor requests a paid licence (jrsoftware.org/isorder.php).
	[switch]$Installer,
	# Also package the Microsoft Store MSIX (scripts\package-msix.ps1, placeholder identity)
	[switch]$Msix
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$version = (Get-Content (Join-Path $repoRoot 'package.json') | ConvertFrom-Json).version
$destination = Join-Path $repoRoot "dist\win32-$Arch"

Write-Host "== Vacha release build v$version (win32-$Arch) ==" -ForegroundColor Cyan

$gitStatus = git status --porcelain
if ($gitStatus) {
	Write-Warning 'Working tree is not clean; the build will include uncommitted changes.'
}

if ($CleanInstall) {
	Write-Host '-- npm ci' -ForegroundColor Cyan
	npm ci
	if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }

	# Newer npm versions ignore the electron runtime settings in .npmrc, which
	# leaves native modules built against desktop Node and crashes the file
	# watcher utility process (0xC0000409). Rebuild explicitly for Electron.
	Write-Host '-- rebuilding native modules for Electron' -ForegroundColor Cyan
	$electronVersion = (Get-Content (Join-Path $repoRoot 'package.json') | ConvertFrom-Json).devDependencies.electron
	$env:npm_config_runtime = 'electron'
	$env:npm_config_target = $electronVersion
	$env:npm_config_disturl = 'https://electronjs.org/headers'
	$env:npm_config_build_from_source = 'true'
	npm rebuild @parcel/watcher
	if ($LASTEXITCODE -ne 0) { throw 'native module rebuild failed' }
}

$buildTask = if ($NoMinify) { "vscode-win32-$Arch" } else { "vscode-win32-$Arch-min" }
Write-Host "-- gulp $buildTask" -ForegroundColor Cyan
npm run gulp -- $buildTask
if ($LASTEXITCODE -ne 0) { throw "gulp $buildTask failed (a running Vacha.exe from dist\ locks the folder - close it and retry)" }

# Build the native forwarder shim (file associations point at it; it forwards
# opens to the running instance over the main named pipe in a few ms).
Write-Host '-- cargo build vacha_open (forwarder shim)' -ForegroundColor Cyan
$cargo = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
if (-not (Test-Path $cargo)) { $cargo = 'cargo' }
$env:VACHA_VERSION = $version
Push-Location (Join-Path $repoRoot 'native\vacha-open')
& $cargo build --release --quiet
$cargoExit = $LASTEXITCODE
Pop-Location
Remove-Item Env:VACHA_VERSION -ErrorAction SilentlyContinue
if ($cargoExit -ne 0) { throw 'cargo build for vacha_open failed' }
Copy-Item (Join-Path $repoRoot 'native\vacha-open\target\release\vacha_open.exe') (Join-Path $destination 'vacha_open.exe') -Force

# strip sourcemaps from the shipped output
Get-ChildItem -Path (Join-Path $destination 'resources\app\out') -Filter '*.map' -Recurse -ErrorAction SilentlyContinue | Remove-Item -Force
# the product UI is English-only; keep just the Electron en-US locale
Get-ChildItem -Path (Join-Path $destination 'locales') -Filter '*.pak' -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'en-US.pak' } | Remove-Item -Force
# Chromium's DirectX shader compiler serves WebGPU only (26 MB); the editor
# renders through the DOM and ANGLE (d3dcompiler_47.dll stays)
foreach ($webGpuOnly in 'dxcompiler.dll', 'dxil.dll') {
	Remove-Item -Path (Join-Path $destination $webGpuOnly) -Force -ErrorAction SilentlyContinue
}
# SwiftShader (software Vulkan, 6 MB): without a usable GPU, Chromium on
# Windows renders through ANGLE's d3d11-warp instead (verified with --disable-gpu)
foreach ($softwareVulkan in 'vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll') {
	Remove-Item -Path (Join-Path $destination $softwareVulkan) -Force -ErrorAction SilentlyContinue
}
# translation-tooling metadata; nothing reads it at runtime
Remove-Item -Path (Join-Path $destination 'resources\app\out\nls.metadata.json') -Force -ErrorAction SilentlyContinue
# The gulp task chain ends with a code-signing step that fails without
# signtool.exe; the package itself is complete once the executable exists.
$exe = Get-ChildItem -Path $destination -Filter '*.exe' -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch 'unins' } | Select-Object -First 1
if (-not $exe) { throw "Package not found in $destination" }

Write-Host '-- smoke check: bin\vacha.cmd --version' -ForegroundColor Cyan
# the GUI exe writes nothing to a captured stdout on Windows; the CLI wrapper does
$reported = & (Join-Path $destination 'bin\vacha.cmd') --version 2>$null | Select-Object -First 1
if (-not $reported) { throw 'smoke check failed: executable did not report a version' }
Write-Host "   reported version: $reported"

# SBOM (EU Cyber Resilience Act): CycloneDX over the shipped npm
# dependencies, plus the forwarder shim, which has no crate dependencies
Write-Host '-- SBOM (CycloneDX)' -ForegroundColor Cyan
$sbomPath = Join-Path $repoRoot "dist\Vacha-$version-sbom.cdx.json"
npx --yes '@cyclonedx/cyclonedx-npm@6.0.1' --omit dev --output-format JSON --output-file $sbomPath
if ($LASTEXITCODE -ne 0) { throw 'SBOM generation failed' }
$sbom = Get-Content $sbomPath -Raw | ConvertFrom-Json
$sbom.metadata.component.name = 'Vacha'
$sbom.metadata.component.version = $version
$sbom.metadata.component | Add-Member -Force -NotePropertyName supplier -NotePropertyValue @{ name = 'Nova Globen AB'; url = @('https://nova-globen.se') }
$sbom.components += [pscustomobject]@{
	type = 'application'
	'bom-ref' = 'vacha-open'
	name = 'vacha-open'
	version = $version
	description = 'Native forwarder shim (Rust, no crate dependencies)'
	licenses = @(@{ license = @{ id = 'GPL-3.0-or-later' } })
	supplier = @{ name = 'Nova Globen AB' }
}
$sbom | ConvertTo-Json -Depth 100 | Set-Content -Path $sbomPath -Encoding utf8NoBOM

if (-not $NoZip) {
	$zipPath = Join-Path $repoRoot "dist\Vacha-win32-$Arch-$version.zip"
	Write-Host "-- zipping to $zipPath" -ForegroundColor Cyan
	if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
	Compress-Archive -Path (Join-Path $destination '*') -DestinationPath $zipPath
	Write-Host "   $([math]::Round((Get-Item $zipPath).Length / 1MB, 1)) MB"
}

if ($Installer) {
	$iscc = (Get-Command ISCC.exe -ErrorAction SilentlyContinue)?.Source
	if (-not $iscc) {
		$candidate = Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'
		if (Test-Path $candidate) { $iscc = $candidate }
	}
	if (-not $iscc) { throw 'ISCC.exe not found; install Inno Setup 6 (https://jrsoftware.org/isinfo.php)' }
	Write-Host '-- compiling installer' -ForegroundColor Cyan
	& $iscc "/DArch=$Arch" "/DAppVersion=$version" "/DSourceDir=$destination" "/O$(Join-Path $repoRoot 'dist')" (Join-Path $repoRoot 'build\win32\vacha-setup.iss')
	if ($LASTEXITCODE -ne 0) { throw 'installer compilation failed' }
}

if ($Msix) {
	& (Join-Path $PSScriptRoot 'package-msix.ps1') -Arch $Arch
}

Write-Host "== Done: $destination ==" -ForegroundColor Green
