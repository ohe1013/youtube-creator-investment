BeforeAll {
    $script:AndroidRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
    $script:ModulePath = Join-Path $script:AndroidRoot 'CreatorX.Android.psm1'
    Import-Module $script:ModulePath -Force -ErrorAction Stop
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
}

Describe 'Pinned platform-tools installer contract' {
    It 'pins the approved Android Platform Tools archive' {
        $pinPath = Join-Path $script:AndroidRoot 'platform-tools.json'
        $pin = Get-Content -LiteralPath $pinPath -Raw | ConvertFrom-Json

        $pin.revision | Should -Be '37.0.1'
        $pin.uri | Should -Be 'https://dl.google.com/android/repository/platform-tools_r37.0.1-win.zip'
        [long] $pin.size | Should -Be 8044994
        $pin.sha1 | Should -Be '10f2ef5325bc5705d48d38a0aa900c7babda24fa'
    }

    It 'refuses installation without explicit license acceptance' {
        $installer = Join-Path $script:AndroidRoot 'install-platform-tools.ps1'
        $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $installer 2>&1

        $LASTEXITCODE | Should -Be 1
        ($output -join "`n") | Should -Match 'ACCEPT_LICENSE_REQUIRED'
    }

    It 'contains integrity, revision, atomic move, and guarded cleanup checks' {
        $installer = Get-Content -LiteralPath (Join-Path $script:AndroidRoot 'install-platform-tools.ps1') -Raw

        $installer | Should -Match 'Get-FileHash'
        $installer | Should -Match 'source\.properties'
        $installer | Should -Match 'Move-Item'
        $installer | Should -Match 'Assert-CreatorXChildPath'
        $installer | Should -Not -Match 'Invoke-Expression'
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
        $doctor | Should -Not -Match 'Stop-Process'
    }

    It 'reverses and verifies all required ports' {
        $reverse = Get-Content -LiteralPath (Join-Path $script:AndroidRoot 'reverse.ps1') -Raw

        foreach ($port in @(8081, 5173, 3000)) {
            $reverse | Should -Match ([string] $port)
        }
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
        $screenshot | Should -Match '\.artifacts'
        $screenshot | Should -Match 'screencap'
        $screenshot | Should -Match "'pull'"
        $screenshot | Should -Not -Match 'exec-out.*[>]'
    }
}
