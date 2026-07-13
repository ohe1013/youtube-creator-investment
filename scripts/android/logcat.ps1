[CmdletBinding()]
param(
    [string] $Serial
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$evidenceRoot = Join-Path $projectRoot '.artifacts\android'
Import-Module (Join-Path $PSScriptRoot 'CreatorX.Android.psm1') -Force -ErrorAction Stop

$deviceResult = Invoke-CreatorXAdb -ProjectRoot $projectRoot -Arguments @('devices', '-l')
if ($deviceResult.ExitCode -ne 0) {
    throw "ADB_COMMAND_FAILED $($deviceResult.Output -join ' ')"
}
$devices = @(ConvertFrom-CreatorXAdbDevicesOutput -Lines $deviceResult.Output)
$device = Resolve-CreatorXDevice -Devices $devices -RequestedSerial $Serial

New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outputPath = Join-Path $evidenceRoot "logcat-$timestamp.txt"
$adbArguments = @('-s', [string] $device.Serial, 'logcat', '-v', 'threadtime')

Write-Output "[PASS] LOGCAT_CAPTURING $outputPath"
$adbPath = Get-CreatorXAdbPath -ProjectRoot $projectRoot
& $adbPath @adbArguments 2>&1 |
    ForEach-Object { [string] $_ } |
    Tee-Object -FilePath $outputPath
if ($LASTEXITCODE -ne 0) {
    throw "LOGCAT_FAILED adb exited with code $LASTEXITCODE."
}
