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

Write-Output "[PASS] LOGCAT_CAPTURING $outputPath"
try {
    Invoke-CreatorXAdbStream `
        -ProjectRoot $projectRoot `
        -Serial $device.Serial `
        -Arguments @('logcat', '-v', 'threadtime') |
        Tee-Object -FilePath $outputPath
} catch {
    if ($_.Exception.Message.StartsWith('ADB_COMMAND_FAILED')) {
        throw "LOGCAT_FAILED $($_.Exception.Message)"
    }
    throw
}
