[CmdletBinding()]
param(
    [switch] $AcceptLicense
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'CreatorX.Android.psm1') -Force -ErrorAction Stop

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
$expectedAdbSha256 = '7c1249b9fcec9a29d520c42d48e4b99db7f0e36a2b17e90ae32aa6be6c19c627'
$pinAdbSha256Property = $pin.PSObject.Properties['adbSha256']
if (
    [string] $pin.revision -ne $expectedRevision -or
    [string] $pin.uri -ne $expectedUri -or
    [long] $pin.size -ne $expectedSize -or
    ([string] $pin.sha1).ToLowerInvariant() -ne $expectedSha1 -or
    $null -eq $pinAdbSha256Property -or
    ([string] $pinAdbSha256Property.Value).ToLowerInvariant() -ne $expectedAdbSha256
) {
    Write-Output '[FAIL] PLATFORM_TOOLS_PIN_INVALID platform-tools.json does not match the approved 37.0.1 archive.'
    exit 1
}

Assert-CreatorXSafeAndroidPath -Path $destination -ProjectRoot $projectRoot | Out-Null
if (Test-CreatorXPlatformToolsInstallation `
    -PlatformToolsPath $destination `
    -Revision $expectedRevision `
    -AdbSha256 $expectedAdbSha256
) {
    Write-Output "[PASS] PLATFORM_TOOLS_READY Android Platform Tools $expectedRevision is already installed at '$destination'."
    exit 0
}

Assert-CreatorXSafeAndroidPath -Path $toolsRoot -ProjectRoot $projectRoot | Out-Null
New-Item -ItemType Directory -Path $toolsRoot -Force | Out-Null
$installationId = [guid]::NewGuid().ToString('N')
$workRoot = Assert-CreatorXSafeAndroidPath `
    -Path (Join-Path $toolsRoot ".install-$installationId") `
    -ProjectRoot $projectRoot
$archivePath = Join-Path $workRoot 'platform-tools.zip'
$extractRoot = Join-Path $workRoot 'extract'
$backupPath = Assert-CreatorXSafeAndroidPath `
    -Path (Join-Path $toolsRoot ".backup-$installationId") `
    -ProjectRoot $projectRoot

try {
    Assert-CreatorXSafeAndroidPath -Path $workRoot -ProjectRoot $projectRoot | Out-Null
    New-Item -ItemType Directory -Path $workRoot -Force | Out-Null
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Assert-CreatorXSafeAndroidPath -Path $archivePath -ProjectRoot $projectRoot | Out-Null
    Invoke-WebRequest -UseBasicParsing -Uri $expectedUri -OutFile $archivePath

    $actualSize = (Get-Item -LiteralPath $archivePath).Length
    if ($actualSize -ne $expectedSize) {
        throw "ARCHIVE_SIZE_MISMATCH Expected $expectedSize bytes, received $actualSize bytes."
    }

    $actualSha1 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA1).Hash.ToLowerInvariant()
    if ($actualSha1 -ne $expectedSha1) {
        throw "ARCHIVE_SHA1_MISMATCH Expected $expectedSha1, received $actualSha1."
    }

    Assert-CreatorXSafeAndroidPath -Path $extractRoot -ProjectRoot $projectRoot | Out-Null
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force
    $candidate = Join-Path $extractRoot 'platform-tools'
    Assert-CreatorXSafeAndroidPath -Path $candidate -ProjectRoot $projectRoot | Out-Null
    if (-not (Test-CreatorXPlatformToolsInstallation `
        -PlatformToolsPath $candidate `
        -Revision $expectedRevision `
        -AdbSha256 $expectedAdbSha256
    )) {
        throw "CANDIDATE_INTEGRITY_MISMATCH Extracted platform-tools does not match revision $expectedRevision and the approved adb SHA-256."
    }

    Assert-CreatorXSafeAndroidPath -Path $destination -ProjectRoot $projectRoot | Out-Null
    $hadExistingInstallation = $null -ne (
        Get-Item -LiteralPath $destination -Force -ErrorAction SilentlyContinue
    )
    if ($hadExistingInstallation) {
        Move-CreatorXAndroidPath `
            -Path $destination `
            -Destination $backupPath `
            -ProjectRoot $projectRoot
    }

    try {
        Move-CreatorXAndroidPath `
            -Path $candidate `
            -Destination $destination `
            -ProjectRoot $projectRoot
        Assert-CreatorXSafeAndroidPath -Path $destination -ProjectRoot $projectRoot | Out-Null
        if (-not (Test-CreatorXPlatformToolsInstallation `
            -PlatformToolsPath $destination `
            -Revision $expectedRevision `
            -AdbSha256 $expectedAdbSha256
        )) {
            throw 'FINAL_INSTALLATION_INVALID Installed platform-tools failed validation.'
        }
    } catch {
        Remove-CreatorXAndroidPath -Path $destination -ProjectRoot $projectRoot
        Assert-CreatorXSafeAndroidPath -Path $backupPath -ProjectRoot $projectRoot | Out-Null
        if (
            $hadExistingInstallation -and
            $null -ne (Get-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue)
        ) {
            Move-CreatorXAndroidPath `
                -Path $backupPath `
                -Destination $destination `
                -ProjectRoot $projectRoot
        }
        throw
    }

    Remove-CreatorXAndroidPath -Path $backupPath -ProjectRoot $projectRoot
    Write-Output "[PASS] PLATFORM_TOOLS_INSTALLED Android Platform Tools $expectedRevision installed at '$destination'."
} catch {
    Write-Output "[FAIL] PLATFORM_TOOLS_INSTALL_FAILED $($_.Exception.Message)"
    exit 1
} finally {
    Remove-CreatorXAndroidPath -Path $workRoot -ProjectRoot $projectRoot
}
