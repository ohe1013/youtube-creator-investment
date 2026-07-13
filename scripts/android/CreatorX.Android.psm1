Set-StrictMode -Version 2.0

function Get-CreatorXTrimmedFullPath {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path
    )

    return [System.IO.Path]::GetFullPath($Path).TrimEnd([char[]] @(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    ))
}

function Test-CreatorXItemIsReparsePoint {
    param(
        [Parameter(Mandatory = $true)]
        [System.IO.FileSystemInfo] $Item
    )

    return ($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
}

function Assert-CreatorXSafeAndroidPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path,

        [Parameter(Mandatory = $true)]
        [string] $ProjectRoot
    )

    $fullProjectRoot = Get-CreatorXTrimmedFullPath -Path $ProjectRoot
    $fullAndroidRoot = Get-CreatorXTrimmedFullPath -Path (
        Join-Path $fullProjectRoot '.tools\android'
    )
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $androidPrefix = $fullAndroidRoot + [System.IO.Path]::DirectorySeparatorChar

    if (
        -not [string]::Equals(
            $fullPath.TrimEnd([char[]] @(
                [System.IO.Path]::DirectorySeparatorChar,
                [System.IO.Path]::AltDirectorySeparatorChar
            )),
            $fullAndroidRoot,
            [System.StringComparison]::OrdinalIgnoreCase
        ) -and
        -not $fullPath.StartsWith($androidPrefix, [System.StringComparison]::OrdinalIgnoreCase)
    ) {
        throw "UNSAFE_PATH Refusing to operate outside '$fullAndroidRoot': '$fullPath'."
    }

    $relativePath = $fullPath.Substring($fullProjectRoot.Length).TrimStart([char[]] @(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    ))
    $segments = @($relativePath.Split(
        [char[]] @(
            [System.IO.Path]::DirectorySeparatorChar,
            [System.IO.Path]::AltDirectorySeparatorChar
        ),
        [System.StringSplitOptions]::RemoveEmptyEntries
    ))
    $currentPath = $fullProjectRoot
    foreach ($segment in $segments) {
        $currentPath = Join-Path $currentPath $segment
        $currentItem = Get-Item -LiteralPath $currentPath -Force -ErrorAction SilentlyContinue
        if ($null -eq $currentItem) {
            break
        }
        if (Test-CreatorXItemIsReparsePoint -Item $currentItem) {
            throw "UNSAFE_REPARSE_POINT Refusing to traverse reparse point '$($currentItem.FullName)'."
        }
    }

    $androidRootItem = Get-Item -LiteralPath $fullAndroidRoot -Force -ErrorAction SilentlyContinue
    if ($null -ne $androidRootItem) {
        if (-not $androidRootItem.PSIsContainer) {
            throw "UNSAFE_PATH Android tools root is not a directory: '$fullAndroidRoot'."
        }

        $pendingDirectories = New-Object 'System.Collections.Generic.Stack[string]'
        $pendingDirectories.Push($fullAndroidRoot)
        while ($pendingDirectories.Count -gt 0) {
            $directory = $pendingDirectories.Pop()
            foreach ($child in @(Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop)) {
                if (Test-CreatorXItemIsReparsePoint -Item $child) {
                    throw "UNSAFE_REPARSE_POINT Refusing to traverse reparse point '$($child.FullName)'."
                }
                if ($child.PSIsContainer) {
                    $pendingDirectories.Push($child.FullName)
                }
            }
        }
    }

    return $fullPath
}

function Remove-CreatorXAndroidPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path,

        [Parameter(Mandatory = $true)]
        [string] $ProjectRoot
    )

    $safePath = Assert-CreatorXSafeAndroidPath -Path $Path -ProjectRoot $ProjectRoot
    if ($null -eq (Get-Item -LiteralPath $safePath -Force -ErrorAction SilentlyContinue)) {
        return
    }
    Remove-Item -LiteralPath $safePath -Recurse -Force
}

function Move-CreatorXAndroidPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path,

        [Parameter(Mandatory = $true)]
        [string] $Destination,

        [Parameter(Mandatory = $true)]
        [string] $ProjectRoot
    )

    $safePath = Assert-CreatorXSafeAndroidPath -Path $Path -ProjectRoot $ProjectRoot
    $safeDestination = Assert-CreatorXSafeAndroidPath `
        -Path $Destination `
        -ProjectRoot $ProjectRoot
    Move-Item -LiteralPath $safePath -Destination $safeDestination
}

function Test-CreatorXPlatformToolsInstallation {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $PlatformToolsPath,

        [Parameter(Mandatory = $true)]
        [string] $Revision,

        [Parameter(Mandatory = $true)]
        [string] $AdbSha256
    )

    if ($AdbSha256 -notmatch '^[0-9a-fA-F]{64}$') {
        return $false
    }

    $adbPath = Join-Path $PlatformToolsPath 'adb.exe'
    $sourcePropertiesPath = Join-Path $PlatformToolsPath 'source.properties'
    if (
        -not (Test-Path -LiteralPath $adbPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $sourcePropertiesPath -PathType Leaf)
    ) {
        return $false
    }

    try {
        $revisionPattern = '^\s*Pkg\.Revision\s*=\s*' + [regex]::Escape($Revision) + '\s*$'
        $revisionMatches = $null -ne (
            Get-Content -LiteralPath $sourcePropertiesPath -ErrorAction Stop |
                Where-Object { $_ -match $revisionPattern } |
                Select-Object -First 1
        )
        if (-not $revisionMatches) {
            return $false
        }

        $actualSha256 = (
            Get-FileHash -LiteralPath $adbPath -Algorithm SHA256 -ErrorAction Stop
        ).Hash
        return [string]::Equals(
            $actualSha256,
            $AdbSha256,
            [System.StringComparison]::OrdinalIgnoreCase
        )
    } catch {
        return $false
    }
}

function Get-CreatorXAdbPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $ProjectRoot,

        [string] $PinPath = (Join-Path $PSScriptRoot 'platform-tools.json')
    )

    $fullProjectRoot = Get-CreatorXTrimmedFullPath -Path $ProjectRoot
    $platformToolsPath = Join-Path $fullProjectRoot '.tools\android\platform-tools'
    $adbPath = Join-Path $platformToolsPath 'adb.exe'
    $safeAdbPath = Assert-CreatorXSafeAndroidPath `
        -Path $adbPath `
        -ProjectRoot $fullProjectRoot
    if (-not (Test-Path -LiteralPath $adbPath -PathType Leaf)) {
        throw "ADB_MISSING Project-local adb was not found at '$adbPath'."
    }

    try {
        $pin = Get-Content -LiteralPath $PinPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        $revisionProperty = $pin.PSObject.Properties['revision']
        $sha256Property = $pin.PSObject.Properties['adbSha256']
        if ($null -eq $revisionProperty -or $null -eq $sha256Property) {
            throw 'Required revision or adbSha256 pin is missing.'
        }
        $revision = [string] $revisionProperty.Value
        $adbSha256 = [string] $sha256Property.Value
    } catch {
        throw "ADB_INTEGRITY_MISMATCH Unable to read the approved adb integrity pin: $($_.Exception.Message)"
    }

    if (-not (Test-CreatorXPlatformToolsInstallation `
        -PlatformToolsPath $platformToolsPath `
        -Revision $revision `
        -AdbSha256 $adbSha256
    )) {
        throw "ADB_INTEGRITY_MISMATCH Project-local adb does not match revision $revision and the approved SHA-256."
    }

    return $safeAdbPath
}

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
    'Assert-CreatorXSafeAndroidPath',
    'Remove-CreatorXAndroidPath',
    'Move-CreatorXAndroidPath',
    'Test-CreatorXPlatformToolsInstallation',
    'Get-CreatorXAdbPath',
    'ConvertFrom-CreatorXAdbDevicesOutput',
    'Resolve-CreatorXDevice',
    'Test-CreatorXReverseRules',
    'Invoke-CreatorXAdb'
)
