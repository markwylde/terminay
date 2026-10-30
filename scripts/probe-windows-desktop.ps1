# The Windows Desktop probe (native-windows-desktop, task 6.1). Release
# packaging runs it against the exact installer it built, before that
# installer is checksummed, attached, or named in update metadata:
#
#   1. a silent per-user install into a scratch directory;
#   2. the journey in probe-windows-desktop.mjs: launch with an isolated data
#      directory, PowerShell and Command Prompt input, resize, output, and
#      exit, and a restart that keeps a held terminal;
#   3. a silent uninstall.
#
#   pwsh scripts/probe-windows-desktop.ps1 -Installer <Setup.exe> -Record <probe.json>
#
# The record carries the installer's SHA-256 and every step's outcome. A failed
# step exits non-zero and is named in the record.
param(
	[Parameter(Mandatory)] [string] $Installer,
	[Parameter(Mandatory)] [string] $Record
)
$ErrorActionPreference = 'Stop'

$installer = (Resolve-Path $Installer).Path
$scratch = Join-Path ([System.IO.Path]::GetTempPath()) "terminay-probe-$([guid]::NewGuid().ToString('N'))"
$installDir = Join-Path $scratch 'Terminay'
$dataDir = Join-Path $scratch 'data'
$journeyRecord = Join-Path $scratch 'journey.json'
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
		# Started rather than piped: a held terminal's holder inherits the
		# journey's handles, so its output pipe would never reach end of file.
		$journeyArgs = @((Join-Path $PSScriptRoot 'probe-windows-desktop.mjs'), '--executable', (Join-Path $installDir 'Terminay.exe'), '--data-dir', $dataDir, '--record', $journeyRecord) |
			ForEach-Object { '"{0}"' -f $_ }
		$process = Start-Process -FilePath (Get-Command node).Source -ArgumentList $journeyArgs -NoNewWindow -PassThru
		# Reading Handle now keeps ExitCode available after the process exits.
		$null = $process.Handle
		if (-not $process.WaitForExit(900000)) { $process.Kill($true); throw 'journey did not finish within 15 minutes' }
		$exit = $process.ExitCode
		if (Test-Path $journeyRecord) {
			$journey = Get-Content -Raw $journeyRecord | ConvertFrom-Json
			$result.journey = $journey
			if (-not $journey.ok) { throw "journey failed at: $($journey.failedStep)" }
		}
		if ($exit -ne 0) { throw "journey exited $exit" }
	}

	Invoke-Step 'uninstall' {
		# A held terminal outlives the app; the uninstaller must still remove it.
		Get-CimInstance Win32_Process |
			Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($dataDir, [StringComparison]::OrdinalIgnoreCase) } |
			ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
		$process = Start-Process -FilePath (Join-Path $installDir 'Uninstall Terminay.exe') -ArgumentList '/S' -PassThru
		if (-not $process.WaitForExit(300000)) { throw 'uninstaller did not finish within 5 minutes' }
		if ($process.ExitCode -ne 0) { throw "uninstaller exited $($process.ExitCode)" }
		# The uninstaller copies itself out and finishes in the background.
		for ($i = 0; $i -lt 60 -and (Test-Path (Join-Path $installDir 'Terminay.exe')); $i++) { Start-Sleep -Milliseconds 500 }
		if (Test-Path (Join-Path $installDir 'Terminay.exe')) { throw 'Terminay.exe is still installed' }
	}

	$result.ok = $true
} catch {
	Write-Host "Windows Desktop probe failed at: $($result.failedStep)"
	Write-Host $_
} finally {
	$screenshot = Join-Path $scratch 'windows-probe-failure.png'
	if (Test-Path $screenshot) { Copy-Item $screenshot (Join-Path (Split-Path -Parent $Record) 'windows-probe-failure.png') }
	Write-Record
}

if (-not $result.ok) { exit 1 }
Write-Host "Windows Desktop probe passed for $($result.installer) ($($result.sha256))"
