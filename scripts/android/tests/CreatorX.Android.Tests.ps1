BeforeAll {
    $script:AndroidRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
    $script:ModulePath = Join-Path $script:AndroidRoot 'CreatorX.Android.psm1'
    Import-Module $script:ModulePath -Force -ErrorAction Stop

    function Invoke-CreatorXDoctorFailureFixture {
    param(
        [Parameter(Mandatory = $true)]
        [string] $TestRoot,

        [Parameter(Mandatory = $true)]
        [ValidateSet('Device', 'Reverse')]
        [string] $FailureStage
    )

    $projectRoot = Join-Path $TestRoot "doctor-$FailureStage"
    $androidRoot = Join-Path $projectRoot 'scripts\android'
    New-Item -ItemType Directory -Path $androidRoot -Force | Out-Null
    Copy-Item `
        -LiteralPath (Join-Path $script:AndroidRoot 'doctor.ps1') `
        -Destination (Join-Path $androidRoot 'doctor.ps1')
    "export default { appName: 'creatorx', type: 'game', permissions: [] }" |
        Set-Content -LiteralPath (Join-Path $projectRoot 'granite.config.ts') -Encoding UTF8

    $moduleSource = @'
$script:InvokeCount = 0

function Get-CreatorXAdbPath {
    param([string] $ProjectRoot)
    return Join-Path $ProjectRoot '.tools\android\platform-tools\adb.exe'
}

function Invoke-CreatorXAdb {
    param([string] $ProjectRoot, [string] $Serial, [string[]] $Arguments)
    $script:InvokeCount += 1
    if (
        '__FAILURE_STAGE__' -eq 'Device' -or
        ('__FAILURE_STAGE__' -eq 'Reverse' -and $script:InvokeCount -gt 1)
    ) {
        if ('__FAILURE_STAGE__' -eq 'Device') {
            throw 'ADB_MISSING adb disappeared before the devices call.'
        }
        throw 'UNSAFE_REPARSE_POINT adb path changed before the reverse call.'
    }
    return [pscustomobject]@{
        ExitCode = 0
        Output = @('List of devices attached', 'SERIAL device')
    }
}

function ConvertFrom-CreatorXAdbDevicesOutput {
    param([object[]] $Lines)
    return [pscustomobject]@{ Serial = 'SERIAL'; State = 'device'; Details = '' }
}

function Resolve-CreatorXDevice {
    param([object[]] $Devices, [string] $RequestedSerial)
    return @($Devices)[0]
}

function Test-CreatorXReverseRules {
    param([object[]] $Lines, [int[]] $Ports)
    return [pscustomobject]@{ Success = $true; MissingPorts = @() }
}

Export-ModuleMember -Function @(
    'Get-CreatorXAdbPath',
    'Invoke-CreatorXAdb',
    'ConvertFrom-CreatorXAdbDevicesOutput',
    'Resolve-CreatorXDevice',
    'Test-CreatorXReverseRules'
)
'@.Replace('__FAILURE_STAGE__', $FailureStage)
    $moduleSource |
        Set-Content -LiteralPath (Join-Path $androidRoot 'CreatorX.Android.psm1') -Encoding UTF8

    $arguments = @(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        (Join-Path $androidRoot 'doctor.ps1'),
        '-ConsoleRegistrationConfirmed'
    )
    if ($FailureStage -eq 'Reverse') {
        $arguments += @('-Mode', 'Running')
    }
    $output = @(& powershell.exe @arguments 2>&1 | ForEach-Object { [string] $_ })
    return [pscustomobject]@{
        ExitCode = [int] $LASTEXITCODE
        Output = [string[]] $output
    }
}
}

Describe 'ConvertFrom-CreatorXAdbDevicesOutput' {
    It 'returns no devices for an empty adb list' {
        $devices = ConvertFrom-CreatorXAdbDevicesOutput -Lines @(
            'List of devices attached',
            ''
        )

        @($devices).Count | Should -Be 0
    }

    It 'parses one authorized device and its details' {
        $devices = @(ConvertFrom-CreatorXAdbDevicesOutput -Lines @(
            'List of devices attached',
            'R3CN30ABC device product:e3q model:SM_S928N transport_id:4'
        ))

        $devices | Should -HaveCount 1
        $devices[0].Serial | Should -Be 'R3CN30ABC'
        $devices[0].State | Should -Be 'device'
        $devices[0].Details | Should -Match 'model:SM_S928N'
    }

    It 'parses unauthorized and offline devices while ignoring daemon noise' {
        $devices = @(ConvertFrom-CreatorXAdbDevicesOutput -Lines @(
            '* daemon not running; starting now at tcp:5037',
            '* daemon started successfully',
            'List of devices attached',
            'USB-1 unauthorized usb:1-1 transport_id:1',
            'USB-2 offline transport_id:2'
        ))

        $devices | Should -HaveCount 2
        $devices[0].State | Should -Be 'unauthorized'
        $devices[1].State | Should -Be 'offline'
    }
}

Describe 'Resolve-CreatorXDevice' {
    It 'reports a missing device' {
        { Resolve-CreatorXDevice -Devices @() } |
            Should -Throw -ExpectedMessage '*DEVICE_MISSING*'
    }

    It 'returns the single authorized device' {
        $device = [pscustomobject]@{ Serial = 'ONE'; State = 'device'; Details = '' }

        (Resolve-CreatorXDevice -Devices @($device)).Serial | Should -Be 'ONE'
    }

    It 'reports an unauthorized device distinctly' {
        $device = [pscustomobject]@{ Serial = 'LOCKED'; State = 'unauthorized'; Details = '' }

        { Resolve-CreatorXDevice -Devices @($device) } |
            Should -Throw -ExpectedMessage '*DEVICE_UNAUTHORIZED*'
    }

    It 'reports an offline device distinctly' {
        $device = [pscustomobject]@{ Serial = 'SLEEPING'; State = 'offline'; Details = '' }

        { Resolve-CreatorXDevice -Devices @($device) } |
            Should -Throw -ExpectedMessage '*DEVICE_OFFLINE*'
    }

    It 'requires a serial when multiple devices are attached' {
        $devices = @(
            [pscustomobject]@{ Serial = 'ONE'; State = 'device'; Details = '' },
            [pscustomobject]@{ Serial = 'TWO'; State = 'device'; Details = '' }
        )

        { Resolve-CreatorXDevice -Devices $devices } |
            Should -Throw -ExpectedMessage '*DEVICE_MULTIPLE*'
    }

    It 'selects the requested serial from multiple devices' {
        $devices = @(
            [pscustomobject]@{ Serial = 'ONE'; State = 'device'; Details = '' },
            [pscustomobject]@{ Serial = 'TWO'; State = 'device'; Details = '' }
        )

        (Resolve-CreatorXDevice -Devices $devices -RequestedSerial 'TWO').Serial |
            Should -Be 'TWO'
    }

    It 'reports a missing requested serial' {
        $devices = @(
            [pscustomobject]@{ Serial = 'ONE'; State = 'device'; Details = '' }
        )

        { Resolve-CreatorXDevice -Devices $devices -RequestedSerial 'MISSING' } |
            Should -Throw -ExpectedMessage '*DEVICE_MISSING*'
    }

    It 'validates the state of a requested serial' {
        $devices = @(
            [pscustomobject]@{ Serial = 'LOCKED'; State = 'unauthorized'; Details = '' },
            [pscustomobject]@{ Serial = 'READY'; State = 'device'; Details = '' }
        )

        { Resolve-CreatorXDevice -Devices $devices -RequestedSerial 'LOCKED' } |
            Should -Throw -ExpectedMessage '*DEVICE_UNAUTHORIZED*'
    }
}

Describe 'Test-CreatorXReverseRules' {
    It 'reports every missing reverse port' {
        $result = Test-CreatorXReverseRules -Lines @() -Ports @(8081, 5173, 3000)

        $result.Success | Should -BeFalse
        ($result.MissingPorts -join ',') | Should -Be '8081,5173,3000'
    }

    It 'recognizes two-column and three-column adb reverse output' {
        $result = Test-CreatorXReverseRules -Lines @(
            'UsbFfs tcp:8081 tcp:8081',
            'tcp:5173 tcp:5173',
            'R3CN30ABC tcp:3000 tcp:3000'
        ) -Ports @(8081, 5173, 3000)

        $result.Success | Should -BeTrue
        @($result.MissingPorts).Count | Should -Be 0
    }

    It 'reports only absent or mismatched rules' {
        $result = Test-CreatorXReverseRules -Lines @(
            'UsbFfs tcp:8081 tcp:8081',
            'UsbFfs tcp:5173 tcp:9999'
        ) -Ports @(8081, 5173, 3000)

        $result.Success | Should -BeFalse
        ($result.MissingPorts -join ',') | Should -Be '5173,3000'
    }
}

Describe 'Invoke-CreatorXAdb' {
    It 'passes serial and adb arguments as literal array elements' {
        $fakeAdb = Join-Path $TestDrive 'fake-adb.ps1'
        $marker = Join-Path $TestDrive 'injected.txt'
        @'
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $Remaining
)
$Remaining -join '|'
exit 7
'@ | Set-Content -LiteralPath $fakeAdb -Encoding UTF8

        $serial = "SERIAL; New-Item -ItemType File -Path '$marker'"
        $argument = "value; New-Item -ItemType File -Path '$marker'"
        $result = Invoke-CreatorXAdb -AdbPath $fakeAdb -Serial $serial -Arguments @(
            'shell',
            'echo',
            $argument
        )

        $result.ExitCode | Should -Be 7
        ($result.Output -join "`n") | Should -Be "-s|$serial|shell|echo|$argument"
        Test-Path -LiteralPath $marker | Should -BeFalse
    }

    It 'captures normal native stderr even when the caller stops on errors' {
        $previousPreference = $ErrorActionPreference

        try {
            $ErrorActionPreference = 'Stop'
            $script:stderrResult = Invoke-CreatorXAdb -AdbPath (Get-Command node).Source -Arguments @(
                '-e',
                "process.stderr.write('* daemon not running\\n'); process.stdout.write('List of devices attached\\n')"
            )
        } finally {
            $ErrorActionPreference = $previousPreference
        }

        $script:stderrResult.ExitCode | Should -Be 0
        ($script:stderrResult.Output -join "`n") | Should -Match 'daemon not running'
        ($script:stderrResult.Output -join "`n") | Should -Match 'List of devices attached'
    }

    It 'streams normal native stderr while restoring the caller error preference' {
        $previousPreference = $ErrorActionPreference

        try {
            $ErrorActionPreference = 'Stop'
            $script:streamOutput = @(Invoke-CreatorXAdbStream `
                -AdbPath (Get-Command node).Source `
                -Arguments @(
                    '-e',
                    "process.stderr.write('stream stderr\\n'); process.stdout.write('stream stdout\\n')"
                ))
            $ErrorActionPreference | Should -Be 'Stop'
        } finally {
            $ErrorActionPreference = $previousPreference
        }

        ($script:streamOutput -join "`n") | Should -Match 'stream stderr'
        ($script:streamOutput -join "`n") | Should -Match 'stream stdout'
    }

    It 'reports a stable failure after streaming a nonzero native exit' {
        {
            Invoke-CreatorXAdbStream `
                -AdbPath (Get-Command node).Source `
                -Arguments @('-e', "process.stderr.write('failed\\n'); process.exit(9)") |
                Out-Null
        } | Should -Throw -ExpectedMessage '*ADB_COMMAND_FAILED*9*'
    }
}

Describe 'Doctor adb failure classification' {
    It 'keeps ADB_MISSING stable when device-list revalidation fails' {
        $result = Invoke-CreatorXDoctorFailureFixture `
            -TestRoot $TestDrive `
            -FailureStage Device

        $result.ExitCode | Should -Be 1
        ($result.Output -join "`n") | Should -Match '\[FAIL\] ADB_MISSING'
        ($result.Output -join "`n") | Should -Not -Match 'DOCTOR_INTERNAL_ERROR'
    }

    It 'maps a reverse-call path-boundary failure to ADB_INTEGRITY_MISMATCH' {
        $result = Invoke-CreatorXDoctorFailureFixture `
            -TestRoot $TestDrive `
            -FailureStage Reverse

        $result.ExitCode | Should -Be 1
        ($result.Output -join "`n") | Should -Match '\[FAIL\] ADB_INTEGRITY_MISMATCH'
        ($result.Output -join "`n") | Should -Not -Match 'DOCTOR_INTERNAL_ERROR'
    }
}

Describe 'Project-local adb integrity' {
    BeforeEach {
        $script:PlatformToolsPath = Join-Path $TestDrive 'platform-tools'
        $script:AdbPath = Join-Path $script:PlatformToolsPath 'adb.exe'
        New-Item -ItemType Directory -Path $script:PlatformToolsPath -Force | Out-Null
        [System.IO.File]::WriteAllBytes(
            $script:AdbPath,
            [System.Text.Encoding]::UTF8.GetBytes('trusted-adb-content')
        )
        'Pkg.Revision=37.0.1' |
            Set-Content -LiteralPath (Join-Path $script:PlatformToolsPath 'source.properties') -Encoding ASCII
        $script:TrustedAdbSha256 = (
            Get-FileHash -LiteralPath $script:AdbPath -Algorithm SHA256
        ).Hash.ToLowerInvariant()
    }

    It 'accepts a normal installation only when revision and adb hash match' {
        Test-CreatorXPlatformToolsInstallation `
            -PlatformToolsPath $script:PlatformToolsPath `
            -Revision '37.0.1' `
            -AdbSha256 $script:TrustedAdbSha256 |
            Should -BeTrue
    }

    It 'rejects an installation after adb content no longer matches the pinned hash' {
        [System.IO.File]::AppendAllText($script:AdbPath, '-tampered')

        Test-CreatorXPlatformToolsInstallation `
            -PlatformToolsPath $script:PlatformToolsPath `
            -Revision '37.0.1' `
            -AdbSha256 $script:TrustedAdbSha256 |
            Should -BeFalse
    }

    It 'returns the validated project-local adb path and emits a stable mismatch code' {
        $projectRoot = Join-Path $TestDrive 'project'
        $installedPath = Join-Path $projectRoot '.tools\android\platform-tools'
        New-Item -ItemType Directory -Path $installedPath -Force | Out-Null
        Copy-Item -LiteralPath $script:AdbPath -Destination (Join-Path $installedPath 'adb.exe')
        Copy-Item `
            -LiteralPath (Join-Path $script:PlatformToolsPath 'source.properties') `
            -Destination (Join-Path $installedPath 'source.properties')
        $pinPath = Join-Path $TestDrive 'platform-tools.test.json'
        @{
            revision = '37.0.1'
            adbSha256 = $script:TrustedAdbSha256
        } | ConvertTo-Json | Set-Content -LiteralPath $pinPath -Encoding UTF8

        Get-CreatorXAdbPath -ProjectRoot $projectRoot -PinPath $pinPath |
            Should -Be (Join-Path $installedPath 'adb.exe')

        [System.IO.File]::AppendAllText((Join-Path $installedPath 'adb.exe'), '-tampered')
        {
            Get-CreatorXAdbPath -ProjectRoot $projectRoot -PinPath $pinPath
        } | Should -Throw -ExpectedMessage '*ADB_INTEGRITY_MISMATCH*'
        {
            Invoke-CreatorXAdb `
                -ProjectRoot $projectRoot `
                -PinPath $pinPath `
                -Arguments @('devices')
        } | Should -Throw -ExpectedMessage '*ADB_INTEGRITY_MISMATCH*'
    }
}

Describe 'Android tools mutation safety' {
    It 'rejects a junction beneath .tools without touching its target' {
        $projectRoot = Join-Path $TestDrive 'project'
        $toolsParent = Join-Path $projectRoot '.tools'
        $junctionPath = Join-Path $toolsParent 'android'
        $outsideTarget = Join-Path $TestDrive 'outside-target'
        $outsidePlatformTools = Join-Path $outsideTarget 'platform-tools'
        $sentinel = Join-Path $outsidePlatformTools 'keep.txt'
        New-Item -ItemType Directory -Path $toolsParent -Force | Out-Null
        New-Item -ItemType Directory -Path $outsidePlatformTools -Force | Out-Null
        'must-survive' | Set-Content -LiteralPath $sentinel -Encoding ASCII
        New-Item -ItemType Junction -Path $junctionPath -Target $outsideTarget | Out-Null

        {
            Remove-CreatorXAndroidPath `
                -Path (Join-Path $junctionPath 'platform-tools') `
                -ProjectRoot $projectRoot
        } | Should -Throw -ExpectedMessage '*UNSAFE_REPARSE_POINT*'

        Test-Path -LiteralPath $sentinel -PathType Leaf | Should -BeTrue
        Get-Content -LiteralPath $sentinel -Raw | Should -Match '^must-survive'
    }
}

Describe 'Pinned platform-tools installer contract' {
    It 'pins the approved Android Platform Tools archive' {
        $pinPath = Join-Path $script:AndroidRoot 'platform-tools.json'
        $pin = Get-Content -LiteralPath $pinPath -Raw | ConvertFrom-Json

        $pin.revision | Should -Be '37.0.1'
        $pin.uri | Should -Be 'https://dl.google.com/android/repository/platform-tools_r37.0.1-win.zip'
        [long] $pin.size | Should -Be 8044994
        $pin.sha1 | Should -Be '10f2ef5325bc5705d48d38a0aa900c7babda24fa'
        $pin.adbSha256 | Should -Be '7c1249b9fcec9a29d520c42d48e4b99db7f0e36a2b17e90ae32aa6be6c19c627'
    }

    It 'refuses installation without explicit license acceptance' {
        $installer = Join-Path $script:AndroidRoot 'install-platform-tools.ps1'
        $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $installer 2>&1

        $LASTEXITCODE | Should -Be 1
        ($output -join "`n") | Should -Match 'ACCEPT_LICENSE_REQUIRED'
    }

}

Describe 'Android command scripts' {
    It 'defines the stable doctor interface, codes, and non-destructive port reporting' {
        $doctor = Get-Content -LiteralPath (Join-Path $script:AndroidRoot 'doctor.ps1') -Raw

        foreach ($parameter in @('Mode', 'RequireArtifacts', 'Serial', 'ConsoleRegistrationConfirmed')) {
            $doctor | Should -Match ("[$]" + $parameter)
        }
        foreach ($code in @(
            'NODE_VERSION_MISMATCH',
            'ADB_MISSING',
            'ADB_INTEGRITY_MISMATCH',
            'DEVICE_MISSING',
            'DEVICE_UNAUTHORIZED',
            'DEVICE_OFFLINE',
            'DEVICE_MULTIPLE',
            'PORT_IN_USE',
            'GRANITE_CONFIG_INVALID',
            'ARTIFACT_MISSING',
            'REVERSE_MISSING',
            'TOSS_CONSOLE_REGISTRATION_UNCONFIRMED'
        )) {
            $doctor | Should -Match $code
        }
        $doctor | Should -Match 'Get-CreatorXAdbPath'
        $doctor | Should -Not -Match 'Stop-Process'
    }

    It 'reverses and verifies all required ports' {
        $reverse = Get-Content -LiteralPath (Join-Path $script:AndroidRoot 'reverse.ps1') -Raw

        foreach ($port in @(8081, 5173, 3000)) {
            $reverse | Should -Match ([string] $port)
        }
        $reverse | Should -Match 'Invoke-CreatorXAdb -ProjectRoot'
        $reverse | Should -Match 'Test-CreatorXReverseRules'
    }

    It 'prints the CreatorX deep link and uses the project-local Granite command' {
        $dev = Get-Content -LiteralPath (Join-Path $script:AndroidRoot 'dev.ps1') -Raw

        $dev | Should -Match 'intoss://creatorx'
        $dev | Should -Match 'node_modules'
        $dev | Should -Match 'granite\.cmd'
        $dev | Should -Match '0\.0\.0\.0'
        $dev | Should -Match '8081'
    }

    It 'writes log and screenshot evidence under the ignored Android artifact directory' {
        $logcat = Get-Content -LiteralPath (Join-Path $script:AndroidRoot 'logcat.ps1') -Raw
        $screenshot = Get-Content -LiteralPath (Join-Path $script:AndroidRoot 'screenshot.ps1') -Raw

        $logcat | Should -Match '\.artifacts'
        $logcat | Should -Match 'android'
        $logcat | Should -Match 'Invoke-CreatorXAdb -ProjectRoot'
        $logcat | Should -Match 'Invoke-CreatorXAdbStream'
        $screenshot | Should -Match '\.artifacts'
        $screenshot | Should -Match 'Invoke-CreatorXAdb -ProjectRoot'
        $screenshot | Should -Match 'screencap'
        $screenshot | Should -Match "'pull'"
        $screenshot | Should -Not -Match 'exec-out.*[>]'
    }
}
