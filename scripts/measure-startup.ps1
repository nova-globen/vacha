<#
.SYNOPSIS
	Measures Vacha's cold start and warm open on a packaged build.

.DESCRIPTION
	Cold start: the wall clock from just before the process is created until the
	window is interactive, i.e. the file passed on the command line is rendered
	in the editor and two animation frames have run after that (the second
	requestAnimationFrame fires after the frame showing the text was produced).
	Vacha is driven over the Chrome DevTools Protocol (--remote-debugging-port)
	with a scratch --user-data-dir, so the owner's own Vacha and its profile are
	never touched. The start timestamp is taken in this script and the end
	timestamp in the renderer (Date.now()); both read the same system clock.
	The renderer's `code/didStartWorkbench` perf mark is reported as well,
	converted to the same clock through performance.timeOrigin.

	Warm open: Vacha is resident (already running on the scratch profile). Each
	run writes a new file, starts `vacha_open.exe <file>` (the native forwarder
	next to Vacha.exe) and stops the clock when that file's tab is the active tab,
	its text is rendered, and two animation frames have run.

	Every run is appended to a JSONL results file together with the machine
	(CPU, arch, OS build, power), the build (version, commit, exe) and whether
	the CDP inspector was attached (it always is: it is how the end of a run is
	observed). A short Markdown summary (median, min, max) is written next to it.

	Process hygiene: only processes this script started are stopped - the PID it
	launched (checked against the exe path) and processes whose command line
	contains the scratch user-data-dir. An installed Vacha (e.g.
	%LOCALAPPDATA%\Programs\vacha) is never touched. Vacha registers itself as a
	login item on startup (HKCU Run\Vacha); the script snapshots that value and
	restores it after every run.

.EXAMPLE
	.\scripts\measure-startup.ps1
	.\scripts\measure-startup.ps1 -Exe C:\src\vacha\dist\win32-x64\Vacha.exe -Runs 10
	.\scripts\measure-startup.ps1 -Mode Warm -Runs 20
#>
#Requires -Version 7
[CmdletBinding()]
param(
	[string]$Exe,
	[ValidateRange(1, 100)]
	[int]$Runs = 5,
	[ValidateSet('Both', 'Cold', 'Warm')]
	[string]$Mode = 'Both',
	# Cold runs before the measured ones; the first one also creates the scratch profile
	[ValidateRange(0, 10)]
	[int]$WarmupRuns = 1,
	[string]$ResultsFile,
	[string]$SummaryFile,
	# Free-form note stored with every record (e.g. "on battery", "after reboot")
	[string]$Label = '',
	[int]$TimeoutSec = 60,
	[int]$CooldownMs = 1500,
	[switch]$KeepScratch
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $Exe) { $Exe = Join-Path $repoRoot 'dist\win32-x64\Vacha.exe' }
if (-not $ResultsFile) { $ResultsFile = Join-Path $repoRoot 'docs\perf\startup.jsonl' }
if (-not $SummaryFile) { $SummaryFile = Join-Path $repoRoot 'docs\perf\startup-summary.md' }

$Exe = (Resolve-Path $Exe).Path
$appDir = Split-Path -Parent $Exe
$shim = Join-Path $appDir 'vacha_open.exe'
if ($Mode -ne 'Cold' -and -not (Test-Path $shim)) { throw "vacha_open.exe not found next to $Exe" }

$sessionId = [guid]::NewGuid().ToString('n').Substring(0, 12)
$scratch = Join-Path ([IO.Path]::GetTempPath()) "vacha-bench-$sessionId"
$userDataDir = Join-Path $scratch 'user-data'
$filesDir = Join-Path $scratch 'files'
New-Item -ItemType Directory -Force $userDataDir, $filesDir | Out-Null

function Get-EpochMs { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }

# -- machine and build -------------------------------------------------------

function Get-PeArch([string]$path) {
	$bytes = [IO.File]::ReadAllBytes($path)[0..4095]
	$peOffset = [BitConverter]::ToInt32([byte[]]$bytes, 0x3C)
	switch ([BitConverter]::ToUInt16([byte[]]$bytes, $peOffset + 4)) {
		0x8664 { 'x64' }
		0xAA64 { 'arm64' }
		0x014C { 'x86' }
		default { 'unknown' }
	}
}

function Get-MachineInfo {
	$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
	$os = Get-CimInstance Win32_OperatingSystem
	$cs = Get-CimInstance Win32_ComputerSystem
	$nt = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
	$battery = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
	$scheme = (powercfg /getactivescheme) -replace '^.*\((.*)\)\s*$', '$1'
	[ordered]@{
		cpu          = $cpu.Name.Trim()
		cores        = $cpu.NumberOfCores
		threads      = $cpu.NumberOfLogicalProcessors
		ramGB        = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
		osArch       = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLower()
		os           = $os.Caption
		osBuild      = "$($os.BuildNumber).$($nt.UBR)"
		osVersion    = $nt.DisplayVersion
		power        = if (-not $battery) { 'no battery' } elseif ($battery.BatteryStatus -eq 2) { 'AC' } else { 'battery' }
		powerScheme  = $scheme
		model        = "$($cs.Manufacturer) $($cs.Model)".Trim()
	}
}

function Get-BuildInfo {
	$product = Get-Content (Join-Path $appDir 'resources\app\product.json') -Raw | ConvertFrom-Json
	$package = Get-Content (Join-Path $appDir 'resources\app\package.json') -Raw | ConvertFrom-Json
	[ordered]@{
		exe       = $Exe
		exeArch   = Get-PeArch $Exe
		version   = $package.version
		commit    = $product.commit
		builtAt   = (Get-Item $Exe).LastWriteTime.ToString('o')
		shim      = if (Test-Path $shim) { 'vacha_open.exe' } else { $null }
	}
}

# -- login item guard ----------------------------------------------------------
# Vacha calls app.setLoginItemSettings({ name: 'Vacha' }) on every start, which
# would repoint (or delete) the owner's start-at-login entry.

$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$approvedKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'

function Save-LoginItem {
	@{
		run      = (Get-ItemProperty $runKey -Name 'Vacha' -ErrorAction SilentlyContinue).Vacha
		approved = (Get-ItemProperty $approvedKey -Name 'Vacha' -ErrorAction SilentlyContinue).Vacha
	}
}

function Restore-LoginItem($saved) {
	foreach ($entry in @(@{ key = $runKey; value = $saved.run; kind = 'String' }, @{ key = $approvedKey; value = $saved.approved; kind = 'Binary' })) {
		if (-not (Test-Path $entry.key)) { continue }
		if ($null -eq $entry.value) {
			Remove-ItemProperty $entry.key -Name 'Vacha' -ErrorAction SilentlyContinue
		} else {
			Set-ItemProperty $entry.key -Name 'Vacha' -Value $entry.value -Type $entry.kind
		}
	}
}

# -- processes -----------------------------------------------------------------

function Get-OwnProcesses([int[]]$launchedIds) {
	$needle = $userDataDir.ToLowerInvariant()
	Get-CimInstance Win32_Process -Filter "Name='Vacha.exe' OR Name='vacha_open.exe'" | Where-Object {
		($_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($needle)) -or
		($launchedIds -contains $_.ProcessId -and $_.ExecutablePath -and ($_.ExecutablePath -ieq $Exe -or $_.ExecutablePath -ieq $shim))
	}
}

function Stop-OwnProcesses([int[]]$launchedIds) {
	$deadline = (Get-Date).AddSeconds(15)
	do {
		$own = @(Get-OwnProcesses $launchedIds)
		foreach ($proc in $own) { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue }
		if ($own.Count -eq 0) { return }
		Start-Sleep -Milliseconds 200
	} while ((Get-Date) -lt $deadline)
	throw "processes from this run are still alive: $((Get-OwnProcesses $launchedIds).ProcessId -join ', ')"
}

function Start-Exe([string]$path, [string[]]$arguments) {
	$info = [Diagnostics.ProcessStartInfo]::new($path)
	foreach ($argument in $arguments) { $info.ArgumentList.Add($argument) }
	$info.UseShellExecute = $false
	# keep Electron's main-process log out of this console (drained and dropped)
	$info.RedirectStandardOutput = $true
	$info.RedirectStandardError = $true
	$process = [Diagnostics.Process]::Start($info)
	$process.BeginOutputReadLine()
	$process.BeginErrorReadLine()
	$process
}

# -- CDP -----------------------------------------------------------------------

function Get-FreePort {
	$excluded = foreach ($line in (netsh interface ipv4 show excludedportrange protocol=tcp)) {
		if ($line -match '^\s*(\d+)\s+(\d+)') { , @([int]$Matches[1], [int]$Matches[2]) }
	}
	$used = (Get-NetTCPConnection -ErrorAction SilentlyContinue).LocalPort
	foreach ($port in (Get-Random -InputObject (9300..9899) -Count 600)) {
		if ($used -contains $port) { continue }
		if ($excluded | Where-Object { $port -ge $_[0] -and $port -le $_[1] }) { continue }
		return $port
	}
	throw 'no free port for --remote-debugging-port'
}

$http = [Net.Http.HttpClient]::new()
$http.Timeout = [TimeSpan]::FromMilliseconds(1000)

function Wait-PageTarget([int]$port, [datetime]$deadline) {
	while ((Get-Date) -lt $deadline) {
		try {
			$targets = $http.GetStringAsync("http://127.0.0.1:$port/json/list").GetAwaiter().GetResult() | ConvertFrom-Json
			$page = $targets | Where-Object { $_.type -eq 'page' -and $_.url -like '*workbench*' -and $_.webSocketDebuggerUrl } | Select-Object -First 1
			if ($page) { return $page.webSocketDebuggerUrl }
		} catch {
			# not listening yet
		}
		Start-Sleep -Milliseconds 5
	}
	throw "no workbench page on CDP port $port"
}

class Cdp {
	[Net.WebSockets.ClientWebSocket]$Socket
	[int]$NextId = 0

	Cdp([string]$url) {
		$this.Socket = [Net.WebSockets.ClientWebSocket]::new()
		$this.Socket.Options.KeepAliveInterval = [TimeSpan]::Zero
		$this.Socket.ConnectAsync([uri]$url, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
	}

	[int] Send([string]$method, [hashtable]$params) {
		$id = ++$this.NextId
		$json = @{ id = $id; method = $method; params = $params } | ConvertTo-Json -Depth 10 -Compress
		$bytes = [Text.Encoding]::UTF8.GetBytes($json)
		$this.Socket.SendAsync([ArraySegment[byte]]::new($bytes), 'Text', $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
		return $id
	}

	[object] Receive([int]$id, [int]$timeoutMs) {
		$cancel = [Threading.CancellationTokenSource]::new($timeoutMs)
		$buffer = [byte[]]::new(1MB)
		while ($true) {
			$stream = [IO.MemoryStream]::new()
			do {
				$result = $this.Socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), $cancel.Token).GetAwaiter().GetResult()
				$stream.Write($buffer, 0, $result.Count)
			} while (-not $result.EndOfMessage)
			$message = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
			if ($message.id -eq $id) { return $message }
		}
		return $null
	}

	# Evaluates an expression in the page; awaits it when it is a promise.
	[object] Evaluate([string]$expression, [int]$timeoutMs) {
		$id = $this.Send('Runtime.evaluate', @{ expression = $expression; awaitPromise = $true; returnByValue = $true })
		$reply = $this.Receive($id, $timeoutMs)
		if ($reply.error) { throw "CDP error: $($reply.error.message)" }
		if ($reply.result.exceptionDetails) { throw "page exception: $($reply.result.exceptionDetails.exception.description)" }
		return $reply.result.result.value
	}

	[void] Close() {
		try { $this.Socket.Abort() } catch { }
		$this.Socket.Dispose()
	}
}

# Resolves once `name` is the active tab, a line containing `token` is rendered
# and two animation frames have run since. The second rAF callback runs after
# the frame that contained the text was produced.
function Get-ReadyScript([string]$name, [string]$token) {
	@"
new Promise(resolve => {
	const name = $(ConvertTo-Json $name), token = $(ConvertTo-Json $token);
	const ready = () => {
		const tab = document.querySelector('.tabs-container .tab.active');
		if (!tab || !(tab.getAttribute('aria-label') || tab.textContent || '').includes(name)) { return false; }
		return [...document.querySelectorAll('.monaco-editor .view-lines')].some(lines => lines.textContent.includes(token));
	};
	const presentAtAttach = ready();
	const done = () => requestAnimationFrame(() => requestAnimationFrame(() => {
		const mark = performance.getEntriesByName('code/didStartWorkbench')[0];
		resolve({
			end: Date.now(),
			timeOrigin: performance.timeOrigin,
			didStartWorkbench: mark ? mark.startTime : null,
			presentAtAttach
		});
	}));
	if (presentAtAttach) { done(); return; }
	const observer = new MutationObserver(() => { if (ready()) { observer.disconnect(); done(); } });
	observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-label'] });
})
"@
}

function New-BenchFile([string]$name) {
	$token = "vachabench$([guid]::NewGuid().ToString('n'))"
	$path = Join-Path $filesDir $name
	Set-Content -Path $path -Value "$token`r`nVacha startup benchmark file.`r`n" -NoNewline -Encoding utf8NoBOM
	@{ path = $path; name = $name; token = $token }
}

# Starts Vacha on the scratch profile with `file` and waits for it to be
# interactive. Returns the timings plus the live process and CDP session.
function Start-Vacha($file) {
	$port = Get-FreePort
	$arguments = @("--user-data-dir=$userDataDir", "--remote-debugging-port=$port", $file.path)

	$t0 = Get-EpochMs
	$process = Start-Exe $Exe $arguments
	$deadline = (Get-Date).AddSeconds($TimeoutSec)

	$url = Wait-PageTarget $port $deadline
	$attached = Get-EpochMs
	$cdp = [Cdp]::new($url)

	# The page target can be listed before workbench.html has its JS context;
	# an evaluation that loses its context to a navigation is simply retried.
	while ($true) {
		try {
			$value = $cdp.Evaluate((Get-ReadyScript $file.name $file.token), [int]($deadline - (Get-Date)).TotalMilliseconds)
			break
		} catch {
			if ((Get-Date) -ge $deadline) { throw }
			Start-Sleep -Milliseconds 5
		}
	}

	$workbench = if ($null -ne $value.didStartWorkbench) { [math]::Round($value.timeOrigin + $value.didStartWorkbench - $t0) } else { $null }
	@{
		process = $process
		cdp     = $cdp
		port    = $port
		timings = [ordered]@{
			wallMs                = $value.end - $t0
			didStartWorkbenchMs   = $workbench
			rendererClockMs       = if ($null -ne $value.didStartWorkbench) { [math]::Round($value.didStartWorkbench) } else { $null }
			rendererOriginMs      = [math]::Round($value.timeOrigin - $t0)
			cdpAttachMs           = $attached - $t0
			editorPresentAtAttach = $value.presentAtAttach
		}
	}
}

# -- records ---------------------------------------------------------------------

$machine = Get-MachineInfo
$build = Get-BuildInfo
$records = [Collections.Generic.List[object]]::new()

New-Item -ItemType Directory -Force (Split-Path -Parent $ResultsFile) | Out-Null

function Write-Record([string]$kind, [int]$index, [bool]$warmup, $timings) {
	$record = [ordered]@{
		session     = $sessionId
		at          = (Get-Date).ToString('o')
		kind        = $kind
		run         = $index
		warmup      = $warmup
		cdpAttached = $true
	}
	foreach ($key in $timings.Keys) { $record[$key] = $timings[$key] }
	$record.label = $Label
	$record.machine = $machine
	$record.build = $build
	$records.Add([pscustomobject]$record)
	Add-Content -Path $ResultsFile -Value ($record | ConvertTo-Json -Depth 5 -Compress) -Encoding utf8NoBOM
	$tag = if ($warmup) { ' (warm-up, not counted)' } else { '' }
	Write-Host ("  {0} #{1}: {2} ms{3}" -f $kind, $index, $timings.wallMs, $tag)
}

function Get-Stats([double[]]$values) {
	$sorted = $values | Sort-Object
	$count = $sorted.Count
	$median = if ($count % 2) { $sorted[($count - 1) / 2] } else { ($sorted[$count / 2 - 1] + $sorted[$count / 2]) / 2 }
	[ordered]@{ n = $count; median = [int][math]::Round($median); min = [int]$sorted[0]; max = [int]$sorted[-1] }
}

# -- run -------------------------------------------------------------------------

$savedLoginItem = Save-LoginItem
$launched = [Collections.Generic.List[int]]::new()
Write-Host "== Vacha startup benchmark $sessionId ==" -ForegroundColor Cyan
Write-Host "  exe      $Exe ($($build.version), $($build.commit.Substring(0, 8)), $($build.exeArch))"
Write-Host "  machine  $($machine.cpu), $($machine.osArch), Windows $($machine.osBuild), $($machine.power)"
Write-Host "  scratch  $scratch"

try {
	if ($Mode -ne 'Warm') {
		Write-Host '-- cold start' -ForegroundColor Cyan
		for ($i = 1 - $WarmupRuns; $i -le $Runs; $i++) {
			$file = New-BenchFile "cold-$($i + $WarmupRuns).txt"
			$run = Start-Vacha $file
			$launched.Add($run.process.Id)
			$run.cdp.Close()
			Write-Record 'cold' $i ($i -le 0) $run.timings
			Stop-OwnProcesses $launched
			Restore-LoginItem $savedLoginItem
			Start-Sleep -Milliseconds $CooldownMs
		}
	}

	if ($Mode -ne 'Cold') {
		Write-Host '-- warm open' -ForegroundColor Cyan
		$resident = Start-Vacha (New-BenchFile 'resident.txt')
		$launched.Add($resident.process.Id)
		Restore-LoginItem $savedLoginItem
		Start-Sleep -Milliseconds $CooldownMs
		$cdp = $resident.cdp

		for ($i = 1; $i -le $Runs; $i++) {
			$file = New-BenchFile "warm-$i.txt"
			$cdp.Evaluate("window.__vachaBench = $(Get-ReadyScript $file.name $file.token); true", 5000) | Out-Null

			$t0 = Get-EpochMs
			$forwarder = Start-Exe $shim @("--user-data-dir=$userDataDir", $file.path)
			$launched.Add($forwarder.Id)
			$value = $cdp.Evaluate('window.__vachaBench', $TimeoutSec * 1000)
			$forwarder.WaitForExit(5000) | Out-Null
			$shimMs = if ($forwarder.HasExited) { [math]::Round(($forwarder.ExitTime.ToUniversalTime() - [DateTimeOffset]::FromUnixTimeMilliseconds($t0).UtcDateTime).TotalMilliseconds) } else { $null }

			Write-Record 'warm' $i $false ([ordered]@{
					wallMs                = $value.end - $t0
					shimExitMs            = $shimMs
					shimExitCode          = if ($forwarder.HasExited) { $forwarder.ExitCode } else { $null }
					editorPresentAtAttach = $value.presentAtAttach
				})
			Start-Sleep -Milliseconds $CooldownMs
		}
		$cdp.Close()
	}
} finally {
	Stop-OwnProcesses $launched
	Restore-LoginItem $savedLoginItem
	$http.Dispose()
	if (-not $KeepScratch) { Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue }
}

# -- summary -----------------------------------------------------------------------

$counted = $records | Where-Object { -not $_.warmup }
$rows = foreach ($metric in @(
		@{ kind = 'cold'; field = 'wallMs'; what = 'Cold start, process start → editor interactive (wall)' },
		@{ kind = 'cold'; field = 'didStartWorkbenchMs'; what = 'Cold start, process start → `code/didStartWorkbench` (wall)' },
		@{ kind = 'cold'; field = 'rendererClockMs'; what = 'Cold start, `code/didStartWorkbench` on the renderer clock' },
		@{ kind = 'warm'; field = 'wallMs'; what = 'Warm open, `vacha_open.exe <file>` → tab active and painted (wall)' },
		@{ kind = 'warm'; field = 'shimExitMs'; what = 'Warm open, `vacha_open.exe` start → exit' })) {
	$values = @($counted | Where-Object { $_.kind -eq $metric.kind -and $null -ne $_.($metric.field) } | ForEach-Object { [double]$_.($metric.field) })
	if ($values.Count -eq 0) { continue }
	$stats = Get-Stats $values
	[pscustomobject]@{ what = $metric.what; median = $stats.median; min = $stats.min; max = $stats.max; n = $stats.n }
}

$lateAttach = @($counted | Where-Object { $_.kind -eq 'cold' -and $_.editorPresentAtAttach }).Count
$summary = @(
	"# Vacha startup measurement"
	""
	"Session ``$sessionId``, $((Get-Date).ToString('yyyy-MM-dd HH:mm zzz')). Produced by ``scripts/measure-startup.ps1``; raw runs in ``$(Split-Path -Leaf $ResultsFile)``."
	""
	"| Metric | Median | Min | Max | Runs |"
	"| --- | ---: | ---: | ---: | ---: |"
	($rows | ForEach-Object { "| $($_.what) | $($_.median) ms | $($_.min) ms | $($_.max) ms | $($_.n) |" })
	""
	"- **Machine:** $($machine.model); $($machine.cpu) ($($machine.cores) cores / $($machine.threads) threads, $($machine.ramGB) GB); $($machine.os) $($machine.osVersion), build $($machine.osBuild), $($machine.osArch); power: $($machine.power), scheme $($machine.powerScheme)."
	"- **Build:** Vacha $($build.version), commit ``$($build.commit)``, $($build.exeArch), built $($build.builtAt)."
	"- **Method:** CDP inspector attached (``--remote-debugging-port``) on every run; scratch ``--user-data-dir``; $WarmupRuns warm-up cold run(s) not counted; OS file cache warm (no reboot between runs). Cold runs where the editor was already painted when CDP attached (end time is then an upper bound): $lateAttach."
	$(if ($Label) { "- **Label:** $Label" })
) | Where-Object { $null -ne $_ }

Set-Content -Path $SummaryFile -Value ($summary -join "`n") -Encoding utf8NoBOM
Write-Host ''
$rows | Format-Table -AutoSize | Out-String | Write-Host
Write-Host "results  $ResultsFile"
Write-Host "summary  $SummaryFile"
