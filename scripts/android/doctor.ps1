[CmdletBinding()]
param(
    [ValidateSet('Preflight', 'Running')]
    [string] $Mode = 'Preflight',

    [switch] $RequireArtifacts,

    [string] $Serial,

    [switch] $ConsoleRegistrationConfirmed
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:HasFailure = $false
$script:HasBlocked = $false
$requiredPorts = @(8081, 5173, 3000)
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$modulePath = Join-Path $PSScriptRoot 'CreatorX.Android.psm1'
$adbPath = Join-Path $projectRoot '.tools\android\platform-tools\adb.exe'
$graniteConfigPath = Join-Path $projectRoot 'granite.config.ts'

Import-Module $modulePath -Force -ErrorAction Stop

function Write-CreatorXDoctorResult {
    param(
        [ValidateSet('PASS', 'WARN', 'FAIL', 'BLOCKED')]
        [string] $Level,

        [string] $Code,

        [string] $Message
    )

    if ($Level -eq 'FAIL') {
        $script:HasFailure = $true
    } elseif ($Level -eq 'BLOCKED') {
        $script:HasBlocked = $true
    }

    Write-Output "[$Level] $Code $Message"
}

function Get-CreatorXCommandVersion {
    param(
        [string] $Command,
        [string[]] $Arguments
    )

    try {
        $output = @(& $Command @Arguments 2>$null)
        if ($LASTEXITCODE -ne 0 -or $output.Count -eq 0) {
            return $null
        }
        return ([string] $output[0]).Trim()
    } catch {
        return $null
    }
}

function Get-CreatorXPortOwners {
    param([int] $Port)

    try {
        return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique)
    } catch {
        return @()
    }
}

function Get-CreatorXProcessDescription {
    param([int] $ProcessId)

    try {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
        if ($null -eq $process) {
            return "PID $ProcessId"
        }
        $commandLine = ([string] $process.CommandLine) -replace '\s+', ' '
        return "PID $ProcessId ($($process.Name)): $commandLine"
    } catch {
        return "PID $ProcessId"
    }
}

try {
    $nodeVersion = Get-CreatorXCommandVersion -Command 'node' -Arguments @('--version')
    if ($nodeVersion -eq 'v24.18.0') {
        Write-CreatorXDoctorResult PASS NODE_VERSION_OK 'Node v24.18.0 is active.'
    } else {
        $foundNode = if ($null -eq $nodeVersion) { 'unavailable' } else { $nodeVersion }
        Write-CreatorXDoctorResult FAIL NODE_VERSION_MISMATCH "Expected Node v24.18.0, found $foundNode."
    }

    $npmVersion = Get-CreatorXCommandVersion -Command 'npm.cmd' -Arguments @('--version')
    if ($npmVersion -eq '11.16.0') {
        Write-CreatorXDoctorResult PASS NPM_VERSION_OK 'npm 11.16.0 is active.'
    } else {
        $foundNpm = if ($null -eq $npmVersion) { 'unavailable' } else { $npmVersion }
        Write-CreatorXDoctorResult FAIL NPM_VERSION_MISMATCH "Expected npm 11.16.0, found $foundNpm."
    }

    $graniteValid = $false
    if (Test-Path -LiteralPath $graniteConfigPath -PathType Leaf) {
        $graniteConfig = Get-Content -LiteralPath $graniteConfigPath -Raw
        $graniteValid =
            $graniteConfig -match 'appName\s*:\s*["'']creatorx["'']' -and
            $graniteConfig -match 'type\s*:\s*["'']game["'']' -and
            $graniteConfig -match 'permissions\s*:\s*\[\s*\]'
    }
    if ($graniteValid) {
        Write-CreatorXDoctorResult PASS GRANITE_CONFIG_OK 'Granite appName=creatorx, type=game, permissions=[].'
    } else {
        Write-CreatorXDoctorResult FAIL GRANITE_CONFIG_INVALID 'Expected appName=creatorx, game WebView, and permissions=[].'
    }

    $selectedDevice = $null
    if (-not (Test-Path -LiteralPath $adbPath -PathType Leaf)) {
        Write-CreatorXDoctorResult FAIL ADB_MISSING "Run sandbox:android:install-tools; adb is missing at '$adbPath'."
    } else {
        Write-CreatorXDoctorResult PASS ADB_READY "Project-local adb found at '$adbPath'."
        $deviceResult = Invoke-CreatorXAdb -AdbPath $adbPath -Arguments @('devices', '-l')
        if ($deviceResult.ExitCode -ne 0) {
            Write-CreatorXDoctorResult FAIL ADB_COMMAND_FAILED ($deviceResult.Output -join ' ')
        } else {
            $devices = @(ConvertFrom-CreatorXAdbDevicesOutput -Lines $deviceResult.Output)
            try {
                $selectedDevice = Resolve-CreatorXDevice -Devices $devices -RequestedSerial $Serial
                Write-CreatorXDoctorResult PASS DEVICE_READY "Android device '$($selectedDevice.Serial)' is authorized."
            } catch {
                $deviceMessage = $_.Exception.Message
                $deviceCode = @(
                    'DEVICE_MISSING',
                    'DEVICE_UNAUTHORIZED',
                    'DEVICE_OFFLINE',
                    'DEVICE_MULTIPLE'
                ) | Where-Object { $deviceMessage.StartsWith($_) } | Select-Object -First 1
                if ($null -eq $deviceCode) {
                    $deviceCode = 'DEVICE_MISSING'
                }
                Write-CreatorXDoctorResult BLOCKED $deviceCode $deviceMessage
            }
        }
    }

    foreach ($port in $requiredPorts) {
        $ownerIds = @(Get-CreatorXPortOwners -Port $port)
        if ($Mode -eq 'Preflight') {
            foreach ($ownerId in $ownerIds) {
                $owner = Get-CreatorXProcessDescription -ProcessId ([int] $ownerId)
                Write-CreatorXDoctorResult BLOCKED PORT_IN_USE "Port $port is already listening: $owner. The doctor will not stop it."
            }
            if ($ownerIds.Count -eq 0) {
                Write-CreatorXDoctorResult PASS PORT_AVAILABLE "Port $port is available."
            }
        } else {
            foreach ($ownerId in $ownerIds) {
                $owner = Get-CreatorXProcessDescription -ProcessId ([int] $ownerId)
                Write-CreatorXDoctorResult PASS PORT_LISTENING "Port $port is listening: $owner."
            }
            if ($ownerIds.Count -eq 0) {
                Write-CreatorXDoctorResult WARN PORT_NOT_LISTENING "Port $port is not listening in Running mode."
            }
        }
    }

    if ($RequireArtifacts) {
        $artifactPath = Join-Path $projectRoot 'creatorx.ait'
        if (Test-Path -LiteralPath $artifactPath -PathType Leaf) {
            Write-CreatorXDoctorResult PASS ARTIFACT_READY "Artifact found at '$artifactPath'."
        } else {
            Write-CreatorXDoctorResult FAIL ARTIFACT_MISSING "Run npm run build:ait; '$artifactPath' is missing."
        }
    }

    if ($Mode -eq 'Running' -and $null -ne $selectedDevice) {
        $reverseResult = Invoke-CreatorXAdb -AdbPath $adbPath -Serial $selectedDevice.Serial -Arguments @('reverse', '--list')
        if ($reverseResult.ExitCode -ne 0) {
            Write-CreatorXDoctorResult BLOCKED REVERSE_MISSING ($reverseResult.Output -join ' ')
        } else {
            $reverseRules = Test-CreatorXReverseRules -Lines $reverseResult.Output -Ports $requiredPorts
            if ($reverseRules.Success) {
                Write-CreatorXDoctorResult PASS REVERSE_READY 'adb reverse rules exist for 8081, 5173, and 3000.'
            } else {
                Write-CreatorXDoctorResult BLOCKED REVERSE_MISSING (
                    'Missing adb reverse ports: ' + ($reverseRules.MissingPorts -join ', ') + '.'
                )
            }
        }
    }

    if ($ConsoleRegistrationConfirmed) {
        Write-CreatorXDoctorResult PASS TOSS_CONSOLE_REGISTRATION_CONFIRMED 'Toss console registration was explicitly confirmed.'
    } else {
        Write-CreatorXDoctorResult BLOCKED TOSS_CONSOLE_REGISTRATION_UNCONFIRMED 'Register creatorx in Toss Business Console, then pass -ConsoleRegistrationConfirmed.'
    }
} catch {
    Write-CreatorXDoctorResult FAIL DOCTOR_INTERNAL_ERROR $_.Exception.Message
}

if ($script:HasFailure) {
    exit 1
}
if ($script:HasBlocked) {
    exit 2
}
exit 0
