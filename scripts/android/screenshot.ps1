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
$outputPath = Join-Path $evidenceRoot "screenshot-$timestamp.png"
$remotePath = "/sdcard/creatorx-screenshot-$([guid]::NewGuid().ToString('N')).png"

try {
    $captureResult = Invoke-CreatorXAdb -ProjectRoot $projectRoot -Serial $device.Serial -Arguments @(
        'shell',
        'screencap',
        '-p',
        $remotePath
    )
    if ($captureResult.ExitCode -ne 0) {
        throw "SCREENSHOT_CAPTURE_FAILED $($captureResult.Output -join ' ')"
    }

    $pullResult = Invoke-CreatorXAdb -ProjectRoot $projectRoot -Serial $device.Serial -Arguments @(
        'pull',
        $remotePath,
        $outputPath
    )
    if ($pullResult.ExitCode -ne 0) {
        throw "SCREENSHOT_PULL_FAILED $($pullResult.Output -join ' ')"
    }
    if (-not (Test-Path -LiteralPath $outputPath -PathType Leaf)) {
        throw "SCREENSHOT_MISSING adb pull did not create '$outputPath'."
    }
    if ((Get-Item -LiteralPath $outputPath).Length -le 0) {
        throw "SCREENSHOT_EMPTY '$outputPath' is empty."
    }

    Write-Output "[PASS] SCREENSHOT_CAPTURED $outputPath"
} finally {
    $null = Invoke-CreatorXAdb -ProjectRoot $projectRoot -Serial $device.Serial -Arguments @(
        'shell',
        'rm',
        '-f',
        $remotePath
    )
}
