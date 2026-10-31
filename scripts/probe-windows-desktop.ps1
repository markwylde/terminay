# The Windows Desktop probe (native-windows-desktop, task 6.1). Release
# packaging runs it against the exact installer it built, before that
# installer is checksummed, attached, or named in update metadata:
#
#   1. a silent per-user install into a scratch directory;
#   2. the journey in probe-windows-desktop.mjs: launch with an isolated data
#      directory, PowerShell and Command Prompt input, resize, output, and
#      exit, and a restart that keeps a held terminal;
#   3. a silent uninstall;
#   4. with -UpdateFeed, the update step in probe-windows-update.mjs: the same
#      installer installed where it installs by default, updated in place to
#      the build N+1 in the feed directory (build-windows-update-probe.sh)
#      with a terminal running, then uninstalled.
#
#   pwsh scripts/probe-windows-desktop.ps1 -Installer <Setup.exe> -Record <probe.json> [-UpdateFeed <dir> -UpdateVersion <version>]
#
# The record carries the installer's SHA-256 and every step's outcome. A failed
# step exits non-zero and is named in the record.
param(
	[Parameter(Mandatory)] [string] $Installer,
	[Parameter(Mandatory)] [string] $Record,
	[string] $UpdateFeed,
	[string] $UpdateVersion
)
$ErrorActionPreference = 'Stop'

$installer = (Resolve-Path $Installer).Path
$scratch = Join-Path ([System.IO.Path]::GetTempPath()) "terminay-probe-$([guid]::NewGuid().ToString('N'))"
$installDir = Join-Path $scratch 'Terminay'
$dataDir = Join-Path $scratch 'data'
$journeyRecord = Join-Path $scratch 'journey.json'
$updateDataDir = Join-Path $scratch 'update-data'
$updateRecord = Join-Path $scratch 'update.json'
$defaultInstallDir = Join-Path $env:LOCALAPPDATA 'Programs\Terminay'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

$result = [ordered]@{
	installer = Split-Path $installer -Leaf
	sha256 = (Get-FileHash -Algorithm SHA256 $installer).Hash.ToLowerInvariant()
	ok = $false
	failedStep = $null
	steps = @()
}

function Write-Record {
	$result | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 -Path $Record
}

function Invoke-Node([string] $Script, [string[]] $Arguments, [string] $Label) {
	# Started rather than piped: a held terminal's holder inherits the
	# journey's handles, so its output pipe would never reach end of file.
	$nodeArgs = @((Join-Path $PSScriptRoot $Script)) + $Arguments | ForEach-Object { '"{0}"' -f $_ }
	$process = Start-Process -FilePath (Get-Command node).Source -ArgumentList $nodeArgs -NoNewWindow -PassThru
	# Reading Handle now keeps ExitCode available after the process exits.
	$null = $process.Handle
	if (-not $process.WaitForExit(900000)) { $process.Kill($true); throw "$Label did not finish within 15 minutes" }
	return $process.ExitCode
}

function Stop-Holders([string] $Root) {
	Get-CimInstance Win32_Process |
		Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase) } |
		ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

function Uninstall-Terminay([string] $Directory) {
	$process = Start-Process -FilePath (Join-Path $Directory 'Uninstall Terminay.exe') -ArgumentList '/S' -PassThru
	if (-not $process.WaitForExit(300000)) { throw 'uninstaller did not finish within 5 minutes' }
	if ($process.ExitCode -ne 0) { throw "uninstaller exited $($process.ExitCode)" }
	# The uninstaller copies itself out and finishes in the background.
	for ($i = 0; $i -lt 60 -and (Test-Path (Join-Path $Directory 'Terminay.exe')); $i++) { Start-Sleep -Milliseconds 500 }
	if (Test-Path (Join-Path $Directory 'Terminay.exe')) { throw 'Terminay.exe is still installed' }
}

function Invoke-Step([string] $Name, [scriptblock] $Body) {
	$started = Get-Date
	Write-Host "[$($started.ToString('o'))] start: $Name"
	try {
		& $Body
		$result.steps += [ordered]@{ name = $Name; ok = $true; ms = [int]((Get-Date) - $started).TotalMilliseconds }
		Write-Host "[$((Get-Date).ToString('o'))] ok: $Name"
	} catch {
		Write-Host "[$((Get-Date).ToString('o'))] FAILED: $Name`: $_"
		$result.steps += [ordered]@{ name = $Name; ok = $false; ms = [int]((Get-Date) - $started).TotalMilliseconds; error = "$_" }
		$result.failedStep = $Name
		throw
	}
}

try {
	Invoke-Step 'install' {
		# /D must come last and unquoted (NSIS).
		# WaitForExit waits for the installer alone; -Wait would also wait for
		# anything it leaves running.
		$process = Start-Process -FilePath $installer -ArgumentList '/S', "/D=$installDir" -PassThru
		if (-not $process.WaitForExit(300000)) { throw 'installer did not finish within 5 minutes' }
		if ($process.ExitCode -ne 0) { throw "installer exited $($process.ExitCode)" }
		if (-not (Test-Path (Join-Path $installDir 'Terminay.exe'))) { throw "Terminay.exe is not in $installDir" }
	}

	Invoke-Step 'journey' {
		$exit = Invoke-Node 'probe-windows-desktop.mjs' @('--executable', (Join-Path $installDir 'Terminay.exe'), '--data-dir', $dataDir, '--record', $journeyRecord) 'journey'
		if (Test-Path $journeyRecord) {
			$journey = Get-Content -Raw $journeyRecord | ConvertFrom-Json
			$result.journey = $journey
			if (-not $journey.ok) { throw "journey failed at: $($journey.failedStep)" }
		}
		if ($exit -ne 0) { throw "journey exited $exit" }
	}

	Invoke-Step 'uninstall' {
		# A held terminal outlives the app; the uninstaller must still remove it.
		Stop-Holders $dataDir
		Uninstall-Terminay $installDir
	}

	if ($UpdateFeed) {
		if (-not $UpdateVersion) { throw '-UpdateFeed needs -UpdateVersion' }
		$feed = (Resolve-Path $UpdateFeed).Path
		New-Item -ItemType Directory -Force -Path $updateDataDir | Out-Null

		Invoke-Step 'update: install build N where the installer puts it' {
			if (Test-Path (Join-Path $defaultInstallDir 'Terminay.exe')) { throw "Terminay is already installed in $defaultInstallDir" }
			# Named, not defaulted: until the earlier uninstall's background copy has
			# removed its registry entry, a silent install goes where that one was.
			$process = Start-Process -FilePath $installer -ArgumentList '/S', "/D=$defaultInstallDir" -PassThru
			if (-not $process.WaitForExit(300000)) { throw 'installer did not finish within 5 minutes' }
			if ($process.ExitCode -ne 0) { throw "installer exited $($process.ExitCode)" }
			if (-not (Test-Path (Join-Path $defaultInstallDir 'Terminay.exe'))) { throw "Terminay.exe is not in $defaultInstallDir" }
		}

		Invoke-Step 'update: restart to update keeps the terminal' {
			$exit = Invoke-Node 'probe-windows-update.mjs' @('--executable', (Join-Path $defaultInstallDir 'Terminay.exe'), '--data-dir', $updateDataDir, '--feed', $feed, '--version', $UpdateVersion, '--record', $updateRecord) 'update'
			if (Test-Path $updateRecord) {
				$update = Get-Content -Raw $updateRecord | ConvertFrom-Json
				$result.update = $update
				if (-not $update.ok) { throw "update failed at: $($update.failedStep)" }
			}
			if ($exit -ne 0) { throw "update exited $exit" }
		}

		Invoke-Step 'update: uninstall' {
			Stop-Holders $updateDataDir
			Uninstall-Terminay $defaultInstallDir
		}
	}

	$result.ok = $true
} catch {
	Write-Host "Windows Desktop probe failed at: $($result.failedStep)"
	Write-Host $_
} finally {
	foreach ($name in 'windows-probe-failure.png', 'windows-probe-update-failure.png') {
		$screenshot = Join-Path $scratch $name
		if (Test-Path $screenshot) { Copy-Item $screenshot (Join-Path (Split-Path -Parent $Record) $name) }
	}
	Write-Record
}

if (-not $result.ok) { exit 1 }
Write-Host "Windows Desktop probe passed for $($result.installer) ($($result.sha256))"
