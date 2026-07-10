[CmdletBinding()]
param(
    [switch] $AcceptLicense
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Assert-CreatorXChildPath {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path,

        [Parameter(Mandatory = $true)]
        [string] $Parent
    )

    $fullParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $prefix = $fullParent + [System.IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "UNSAFE_PATH Refusing to operate outside '$fullParent': '$fullPath'."
    }

    return $fullPath
}

function Remove-CreatorXInstallPath {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path,

        [Parameter(Mandatory = $true)]
        [string] $Parent
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $safePath = Assert-CreatorXChildPath -Path $Path -Parent $Parent
    Remove-Item -LiteralPath $safePath -Recurse -Force
}

function Test-CreatorXInstalledRevision {
    param(
        [Parameter(Mandatory = $true)]
        [string] $PlatformToolsPath,

        [Parameter(Mandatory = $true)]
        [string] $Revision
    )

    $adbPath = Join-Path $PlatformToolsPath 'adb.exe'
    $sourcePropertiesPath = Join-Path $PlatformToolsPath 'source.properties'
    if (
        -not (Test-Path -LiteralPath $adbPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $sourcePropertiesPath -PathType Leaf)
    ) {
        return $false
    }

    $revisionPattern = '^\s*Pkg\.Revision\s*=\s*' + [regex]::Escape($Revision) + '\s*$'
    return $null -ne (Get-Content -LiteralPath $sourcePropertiesPath | Where-Object {
        $_ -match $revisionPattern
    } | Select-Object -First 1)
}

if (-not $AcceptLicense) {
    Write-Output '[FAIL] ACCEPT_LICENSE_REQUIRED Re-run with -AcceptLicense after reviewing the Android SDK Platform Tools license.'
    exit 1
}

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$toolsRoot = Join-Path $projectRoot '.tools\android'
$destination = Join-Path $toolsRoot 'platform-tools'
$pinPath = Join-Path $PSScriptRoot 'platform-tools.json'
$pin = Get-Content -LiteralPath $pinPath -Raw | ConvertFrom-Json

$expectedRevision = '37.0.1'
$expectedUri = 'https://dl.google.com/android/repository/platform-tools_r37.0.1-win.zip'
$expectedSize = [long] 8044994
$expectedSha1 = '10f2ef5325bc5705d48d38a0aa900c7babda24fa'
if (
    [string] $pin.revision -ne $expectedRevision -or
    [string] $pin.uri -ne $expectedUri -or
    [long] $pin.size -ne $expectedSize -or
    ([string] $pin.sha1).ToLowerInvariant() -ne $expectedSha1
) {
    Write-Output '[FAIL] PLATFORM_TOOLS_PIN_INVALID platform-tools.json does not match the approved 37.0.1 archive.'
    exit 1
}

if (Test-CreatorXInstalledRevision -PlatformToolsPath $destination -Revision $expectedRevision) {
    Write-Output "[PASS] PLATFORM_TOOLS_READY Android Platform Tools $expectedRevision is already installed at '$destination'."
    exit 0
}

New-Item -ItemType Directory -Path $toolsRoot -Force | Out-Null
$installationId = [guid]::NewGuid().ToString('N')
$workRoot = Assert-CreatorXChildPath -Path (Join-Path $toolsRoot ".install-$installationId") -Parent $toolsRoot
$archivePath = Join-Path $workRoot 'platform-tools.zip'
$extractRoot = Join-Path $workRoot 'extract'
$backupPath = Assert-CreatorXChildPath -Path (Join-Path $toolsRoot ".backup-$installationId") -Parent $toolsRoot

try {
    New-Item -ItemType Directory -Path $workRoot -Force | Out-Null
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $expectedUri -OutFile $archivePath

    $actualSize = (Get-Item -LiteralPath $archivePath).Length
    if ($actualSize -ne $expectedSize) {
        throw "ARCHIVE_SIZE_MISMATCH Expected $expectedSize bytes, received $actualSize bytes."
    }

    $actualSha1 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA1).Hash.ToLowerInvariant()
    if ($actualSha1 -ne $expectedSha1) {
        throw "ARCHIVE_SHA1_MISMATCH Expected $expectedSha1, received $actualSha1."
    }

    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force
    $candidate = Join-Path $extractRoot 'platform-tools'
    if (-not (Test-CreatorXInstalledRevision -PlatformToolsPath $candidate -Revision $expectedRevision)) {
        throw "SOURCE_PROPERTIES_INVALID Extracted archive is missing adb.exe or Pkg.Revision=$expectedRevision."
    }

    $hadExistingInstallation = Test-Path -LiteralPath $destination
    if ($hadExistingInstallation) {
        Move-Item -LiteralPath $destination -Destination $backupPath
    }

    try {
        Move-Item -LiteralPath $candidate -Destination $destination
        if (-not (Test-CreatorXInstalledRevision -PlatformToolsPath $destination -Revision $expectedRevision)) {
            throw 'FINAL_INSTALLATION_INVALID Installed platform-tools failed validation.'
        }
    } catch {
        Remove-CreatorXInstallPath -Path $destination -Parent $toolsRoot
        if ($hadExistingInstallation -and (Test-Path -LiteralPath $backupPath)) {
            Move-Item -LiteralPath $backupPath -Destination $destination
        }
        throw
    }

    Remove-CreatorXInstallPath -Path $backupPath -Parent $toolsRoot
    Write-Output "[PASS] PLATFORM_TOOLS_INSTALLED Android Platform Tools $expectedRevision installed at '$destination'."
} catch {
    Write-Output "[FAIL] PLATFORM_TOOLS_INSTALL_FAILED $($_.Exception.Message)"
    exit 1
} finally {
    Remove-CreatorXInstallPath -Path $workRoot -Parent $toolsRoot
}
