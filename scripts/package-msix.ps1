<#
.SYNOPSIS
	Packages a built Vacha (dist\win32-<arch>) as an MSIX for the Microsoft Store.

.DESCRIPTION
	Run after `scripts\release.ps1 -Arch <arch>` (or as its -Msix step). Steps:
	  1. Copy dist\win32-<arch> to dist\msix-win32-<arch>, minus what the
	     package replaces: bin\ (the `vacha` command is an execution alias)
	     and the Start tile manifest (the package declares its own).
	  2. Make it the Store variant: product.json loses the update manifest URL
	     (the Store delivers updates) and gains win32StorePackage, so the app
	     writes nothing to the registry. It also gets its own user data,
	     ~\.vacha-store folders, pipe and mutex, apart from a site install.
	  3. Add the logo set (resources\win32\msix\Assets), the package manifest
	     (build\win32\msix\AppxManifest.xml with the identity filled in) and
	     resources.pri, which maps the scaled logos.
	  4. makeappx pack into dist\Vacha-<arch>-<version>.msix, unsigned: the
	     Store signs what it publishes.

	The identity defaults are placeholders for local builds; a Store upload
	must use the values from Partner Center > Product identity.

.EXAMPLE
	.\scripts\package-msix.ps1 -Arch x64
	.\scripts\package-msix.ps1 -IdentityName 12345NovaGlobenAB.Vacha -Publisher 'CN=...' -PublisherDisplayName 'Nova Globen AB'
#>
[CmdletBinding()]
param(
	[ValidateSet('arm64', 'x64')]
	[string]$Arch = $(if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }),
	# Partner Center > Product identity > Package/Identity/Name
	[string]$IdentityName = 'NovaGlobenAB.Vacha',
	# Partner Center > Product identity > Package/Identity/Publisher
	[string]$Publisher = 'CN=Nova Globen AB',
	# Partner Center > Product identity > Package/Properties/PublisherDisplayName
	[string]$PublisherDisplayName = 'Nova Globen AB'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

$version = (Get-Content (Join-Path $repoRoot 'package.json') | ConvertFrom-Json).version
$source = Join-Path $repoRoot "dist\win32-$Arch"
$staging = Join-Path $repoRoot "dist\msix-win32-$Arch"
$msixPath = Join-Path $repoRoot "dist\Vacha-$Arch-$version.msix"
if (-not (Test-Path (Join-Path $source 'Vacha.exe'))) { throw "No build in $source; run scripts\release.ps1 -Arch $Arch first" }

# The Store wants major.minor.build.0; the fourth part is reserved for it
$packageVersion = "$version.0"
if ($packageVersion -notmatch '^\d+\.\d+\.\d+\.0$') { throw "package.json version $version does not make an MSIX version" }

# makeappx and makepri ship with the Windows SDK
$sdkBin = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Directory -ErrorAction SilentlyContinue |
	Where-Object { Test-Path (Join-Path $_.FullName 'x64\makeappx.exe') } | Sort-Object Name | Select-Object -Last 1
if (-not $sdkBin) { throw 'makeappx.exe not found; install the Windows SDK' }
$makeappx = Join-Path $sdkBin.FullName 'x64\makeappx.exe'
$makepri = Join-Path $sdkBin.FullName 'x64\makepri.exe'

Write-Host "== Vacha MSIX v$packageVersion (win32-$Arch) ==" -ForegroundColor Cyan

Write-Host "-- staging $staging" -ForegroundColor Cyan
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
Copy-Item $source $staging -Recurse
Remove-Item (Join-Path $staging 'bin') -Recurse -Force -ErrorAction SilentlyContinue
# The startup task's target: the shim under this name starts Vacha hidden
Copy-Item (Join-Path $staging 'vacha_open.exe') (Join-Path $staging 'vacha_resident.exe')
Remove-Item (Join-Path $staging 'Vacha.VisualElementsManifest.xml') -Force -ErrorAction SilentlyContinue

Write-Host '-- Store variant (product.json)' -ForegroundColor Cyan
$productPath = Join-Path $staging 'resources\app\product.json'
$product = Get-Content $productPath -Raw | ConvertFrom-Json
$product.PSObject.Properties.Remove('tondUpdateManifestUrl')
$product | Add-Member -Force -NotePropertyName win32StorePackage -NotePropertyValue $true
# Its own settings folders, single-instance pipe and mutex: a site install
# beside it must not receive its files or share its profile
$product | Add-Member -Force -NotePropertyName userDataFolderName -NotePropertyValue 'Vacha Store'
$product.dataFolderName = '.vacha-store'
$product.sharedDataFolderName = '.vacha-store-shared'
$product.win32MutexName = 'vacha-store'
$product | ConvertTo-Json -Depth 100 | Set-Content -Path $productPath -Encoding utf8NoBOM

Write-Host '-- manifest, logos, resources.pri' -ForegroundColor Cyan
$manifest = (Get-Content (Join-Path $repoRoot 'build\win32\msix\AppxManifest.xml') -Raw).
	Replace('@@IdentityName@@', $IdentityName).
	Replace('@@Publisher@@', [Security.SecurityElement]::Escape($Publisher)).
	Replace('@@PublisherDisplayName@@', [Security.SecurityElement]::Escape($PublisherDisplayName)).
	Replace('@@Version@@', $packageVersion).
	Replace('@@Arch@@', $Arch)
Set-Content -Path (Join-Path $staging 'AppxManifest.xml') -Value $manifest -Encoding utf8NoBOM -NoNewline
Copy-Item (Join-Path $repoRoot 'resources\win32\msix\Assets') (Join-Path $staging 'Assets') -Recurse

# Index only the logos: a resources.pri over the whole app would list every file
$priRoot = Join-Path ([IO.Path]::GetTempPath()) "vacha-pri-$PID"
New-Item -ItemType Directory $priRoot -Force | Out-Null
try {
	Copy-Item (Join-Path $staging 'Assets') (Join-Path $priRoot 'Assets') -Recurse
	Copy-Item (Join-Path $staging 'AppxManifest.xml') $priRoot
	& $makepri createconfig /cf (Join-Path $priRoot 'priconfig.xml') /dq lang-en-US /pv 10.0.0 /o | Out-Null
	if ($LASTEXITCODE -ne 0) { throw 'makepri createconfig failed' }
	# One package, no resource packs: keep every scale in the one resources.pri
	$priConfig = [xml](Get-Content (Join-Path $priRoot 'priconfig.xml') -Raw)
	$packaging = $priConfig.SelectSingleNode('//packaging')
	if ($packaging) { [void]$packaging.ParentNode.RemoveChild($packaging) }
	$priConfig.Save((Join-Path $priRoot 'priconfig.xml'))
	& $makepri new /pr $priRoot /cf (Join-Path $priRoot 'priconfig.xml') /mn (Join-Path $priRoot 'AppxManifest.xml') /of (Join-Path $staging 'resources.pri') /o | Out-Null
	if ($LASTEXITCODE -ne 0) { throw 'makepri new failed' }
} finally {
	Remove-Item $priRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "-- makeappx pack $msixPath" -ForegroundColor Cyan
$packOutput = & $makeappx pack /d $staging /p $msixPath /o
if ($LASTEXITCODE -ne 0) { $packOutput | Select-Object -Last 20 | Write-Host; throw 'makeappx pack failed' }
Write-Host "   $([math]::Round((Get-Item $msixPath).Length / 1MB, 1)) MB, unsigned (the Store signs it)"

Write-Host "== Done: $msixPath ==" -ForegroundColor Green
