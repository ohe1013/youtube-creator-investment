Set-StrictMode -Version 2.0

function ConvertFrom-CreatorXAdbDevicesOutput {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [AllowNull()]
        [object[]] $Lines
    )

    foreach ($lineValue in @($Lines)) {
        if ($null -eq $lineValue) {
            continue
        }

        $line = ([string] $lineValue).Trim()
        if (
            [string]::IsNullOrWhiteSpace($line) -or
            $line -eq 'List of devices attached' -or
            $line.StartsWith('*')
        ) {
            continue
        }

        $parts = ([regex] '\s+').Split($line, 3)
        if ($parts.Count -lt 2) {
            continue
        }

        [pscustomobject]@{
            Serial = $parts[0]
            State = $parts[1].ToLowerInvariant()
            Details = if ($parts.Count -ge 3) { $parts[2] } else { '' }
        }
    }
}

function Resolve-CreatorXDevice {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [AllowNull()]
        [object[]] $Devices,

        [string] $RequestedSerial
    )

    $deviceList = @($Devices | Where-Object { $null -ne $_ })
    $selected = $null

    if (-not [string]::IsNullOrWhiteSpace($RequestedSerial)) {
        $matches = @($deviceList | Where-Object {
            [string]::Equals(
                [string] $_.Serial,
                $RequestedSerial,
                [System.StringComparison]::OrdinalIgnoreCase
            )
        })
        if ($matches.Count -eq 0) {
            throw "DEVICE_MISSING Requested Android serial '$RequestedSerial' is not attached."
        }
        $selected = $matches[0]
    } else {
        if ($deviceList.Count -eq 0) {
            throw 'DEVICE_MISSING No Android device is attached.'
        }
        if ($deviceList.Count -gt 1) {
            $serials = @($deviceList | ForEach-Object { [string] $_.Serial }) -join ', '
            throw "DEVICE_MULTIPLE Multiple Android devices are attached ($serials). Pass -Serial."
        }
        $selected = $deviceList[0]
    }

    $state = ([string] $selected.State).ToLowerInvariant()
    switch ($state) {
        'device' {
            return $selected
        }
        'unauthorized' {
            throw "DEVICE_UNAUTHORIZED Device '$($selected.Serial)' is awaiting USB authorization."
        }
        'offline' {
            throw "DEVICE_OFFLINE Device '$($selected.Serial)' is offline."
        }
        default {
            throw "DEVICE_OFFLINE Device '$($selected.Serial)' reported state '$state'."
        }
    }
}

function Test-CreatorXReverseRules {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [AllowNull()]
        [object[]] $Lines,

        [Parameter(Mandatory = $true)]
        [int[]] $Ports
    )

    $presentPorts = @{}
    foreach ($lineValue in @($Lines)) {
        if ($null -eq $lineValue) {
            continue
        }

        $line = ([string] $lineValue).Trim()
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }

        $tcpTokens = @([regex]::Matches($line, 'tcp:\d+') | ForEach-Object { $_.Value })
        if ($tcpTokens.Count -lt 2) {
            continue
        }

        $source = $tcpTokens[$tcpTokens.Count - 2]
        $destination = $tcpTokens[$tcpTokens.Count - 1]
        if ($source -eq $destination -and $source -match '^tcp:(\d+)$') {
            $presentPorts[[int] $Matches[1]] = $true
        }
    }

    $missingPorts = @($Ports | Where-Object { -not $presentPorts.ContainsKey([int] $_) })
    [pscustomobject]@{
        Success = $missingPorts.Count -eq 0
        MissingPorts = [int[]] $missingPorts
    }
}

function Invoke-CreatorXAdb {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string] $AdbPath,

        [string] $Serial,

        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [string[]] $Arguments
    )

    if (-not (Test-Path -LiteralPath $AdbPath -PathType Leaf)) {
        throw "ADB_MISSING Project-local adb was not found at '$AdbPath'."
    }

    $commandArguments = New-Object 'System.Collections.Generic.List[string]'
    if (-not [string]::IsNullOrWhiteSpace($Serial)) {
        $commandArguments.Add('-s')
        $commandArguments.Add($Serial)
    }
    foreach ($argument in @($Arguments)) {
        $commandArguments.Add([string] $argument)
    }

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        # Windows PowerShell 5.1 promotes native stderr records when the caller
        # uses Stop. adb legitimately writes daemon startup notices to stderr.
        $ErrorActionPreference = 'Continue'
        $output = @(& $AdbPath @commandArguments 2>&1 | ForEach-Object { [string] $_ })
        $exitCode = [int] $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    [pscustomobject]@{
        ExitCode = $exitCode
        Output = [string[]] $output
        Arguments = [string[]] $commandArguments.ToArray()
    }
}

Export-ModuleMember -Function @(
    'ConvertFrom-CreatorXAdbDevicesOutput',
    'Resolve-CreatorXDevice',
    'Test-CreatorXReverseRules',
    'Invoke-CreatorXAdb'
)
