[CmdletBinding()]
param(
    [string] $Serial
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$requiredPorts = @(8081, 5173, 3000)
Import-Module (Join-Path $PSScriptRoot 'CreatorX.Android.psm1') -Force -ErrorAction Stop

try {
    $adbPath = Get-CreatorXAdbPath -ProjectRoot $projectRoot
    $deviceResult = Invoke-CreatorXAdb -AdbPath $adbPath -Arguments @('devices', '-l')
    if ($deviceResult.ExitCode -ne 0) {
        throw "ADB_COMMAND_FAILED $($deviceResult.Output -join ' ')"
    }
    $devices = @(ConvertFrom-CreatorXAdbDevicesOutput -Lines $deviceResult.Output)
    $device = Resolve-CreatorXDevice -Devices $devices -RequestedSerial $Serial

    foreach ($port in $requiredPorts) {
        $result = Invoke-CreatorXAdb -AdbPath $adbPath -Serial $device.Serial -Arguments @(
            'reverse',
            "tcp:$port",
            "tcp:$port"
        )
        if ($result.ExitCode -ne 0) {
            throw "REVERSE_FAILED Port ${port}: $($result.Output -join ' ')"
        }
    }

    $listResult = Invoke-CreatorXAdb -AdbPath $adbPath -Serial $device.Serial -Arguments @(
        'reverse',
        '--list'
    )
    if ($listResult.ExitCode -ne 0) {
        throw "REVERSE_LIST_FAILED $($listResult.Output -join ' ')"
    }

    $verification = Test-CreatorXReverseRules -Lines $listResult.Output -Ports $requiredPorts
    if (-not $verification.Success) {
        throw "REVERSE_MISSING Missing ports: $($verification.MissingPorts -join ', ')."
    }

    Write-Output "[PASS] REVERSE_READY Device '$($device.Serial)' maps 8081, 5173, and 3000."
} catch {
    Write-Error "[FAIL] ANDROID_REVERSE_FAILED $($_.Exception.Message)"
    throw
}
