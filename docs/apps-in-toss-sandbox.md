# CreatorX Apps-in-Toss Android Sandbox runbook

This runbook is the Windows operator path for registering CreatorX and running a physical Android smoke test in the Apps-in-Toss Sandbox. Console registration, Toss authentication, USB authorization, and the on-device observations are user-owned gates; do not mark them complete from local build output alone.

## Official entry points and fixed identity

- Console: <https://apps-in-toss.toss.im/>
- Registration guide: <https://developers-apps-in-toss.toss.im/prepare/console-workspace.html>
- Sandbox guide and current APK: <https://developers-apps-in-toss.toss.im/development/test/sandbox.html>

Create or select the intended workspace in the console, then register the app with this exact mapping:

| Console field | Required value |
| --- | --- |
| Display name | `크리에이터X` |
| `appName` | `creatorx` |
| App type | Game |
| Permissions | None (`[]`) |

`appName` is the immutable scheme identifier. Check `creatorx` before submitting it; do not create a spelling or case variant. The repository's `granite.config.ts` must continue to agree with `appName: "creatorx"`, game WebView type, and `permissions: []`.

Use the same personal Toss Business account throughout the flow. Sign in to the console with that account, create or select its workspace, and select the registered `creatorx` app. In the Sandbox, sign in with that same personal account, choose the same workspace/app, then open the Toss push on the phone associated with the console account and complete Toss authentication. Do not use a shared account.

Only after registration has actually been checked in the console may an operator pass `-ConsoleRegistrationConfirmed` to the doctor. That switch records an explicit operator assertion; it does not query the console.

## Windows and Android prerequisites

Run every command from the repository root in Windows PowerShell.

1. Activate the pinned toolchain and install the locked dependencies.

   ```powershell
   nvm use 24.18.0
   node --version
   npm.cmd --version
   npm ci
   ```

   The expected versions are Node `v24.18.0` and npm `11.16.0`.

2. Review the Android SDK Platform Tools license, then install the repository-pinned tools. The installer writes only beneath the ignored `.tools/android/` directory and validates the approved archive and `adb.exe` before use.

   ```powershell
   npm run sandbox:android:install-tools -- -AcceptLicense
   ```

3. On the Android phone, enable developer options and USB debugging. Connect the phone with a data-capable USB cable, unlock it, accept the computer RSA fingerprint prompt, and optionally select "Always allow from this computer" only on a trusted workstation.

4. Run the preflight doctor. With multiple devices, add `-- -Serial <serial>`. After the console registration is complete, add `-ConsoleRegistrationConfirmed` after the npm separator.

   ```powershell
   npm run sandbox:android:doctor
   npm run sandbox:android:doctor -- -Serial <serial> -ConsoleRegistrationConfirmed
   ```

Preflight expects ports `8081`, `5173`, and `3000` to be free. It reports owners but never stops them. On the current development machine, PID `6060` on port `5173` belongs to the Vite process in `E:\git-hg\urban-ts-codex-starter\apps\web`; do not stop it. Report the command line and obtain the owning user's approval instead.

Inspect any conflict without mutating it:

```powershell
$connections = Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue
$connections | ForEach-Object {
  Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)" |
    Select-Object ProcessId, Name, CommandLine
}
```

## Doctor output and exit contract

The doctor emits one result per check as `[PASS|WARN|FAIL|BLOCKED] CODE message`.

| Level | Meaning |
| --- | --- |
| `PASS` | The check is satisfied. |
| `WARN` | Running-mode information that does not fail or block the doctor. |
| `FAIL` | A local invariant is invalid and must be repaired. |
| `BLOCKED` | An external prerequisite or exclusive resource is unavailable. |

The direct `scripts/android/doctor.ps1` exit codes are stable:

- `0`: no `FAIL` and no `BLOCKED` results.
- `1`: at least one `FAIL`; this takes precedence even when a blocker also exists.
- `2`: no failure, but at least one `BLOCKED` result.

On Windows with npm 11, `npm run sandbox:android:doctor` can normalize the doctor's child exit `2` to npm process exit `1`. Read the emitted level/code results, or invoke the project script directly when automation must distinguish failure `1` from blocked `2`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/android/doctor.ps1 `
  -Serial <serial> -ConsoleRegistrationConfirmed
```

Do not proceed to physical smoke, and do not mark Plan 1 complete, while either invocation is nonzero.

Stable result codes include:

- Toolchain/configuration: `NODE_VERSION_OK`, `NODE_VERSION_MISMATCH`, `NPM_VERSION_OK`, `NPM_VERSION_MISMATCH`, `GRANITE_CONFIG_OK`, `GRANITE_CONFIG_INVALID`.
- Project-local adb: `ADB_READY`, `ADB_MISSING`, `ADB_INTEGRITY_MISMATCH`, `ADB_COMMAND_FAILED`.
- Device selection: `DEVICE_READY`, `DEVICE_MISSING`, `DEVICE_UNAUTHORIZED`, `DEVICE_OFFLINE`, `DEVICE_MULTIPLE`.
- Ports: `PORT_AVAILABLE`, `PORT_IN_USE`, `PORT_LISTENING`, `PORT_NOT_LISTENING`.
- Build/reverse state: `ARTIFACT_READY`, `ARTIFACT_MISSING`, `REVERSE_READY`, `REVERSE_MISSING`.
- Console state: `TOSS_CONSOLE_REGISTRATION_CONFIRMED`, `TOSS_CONSOLE_REGISTRATION_UNCONFIRMED`.
- Unexpected doctor failure: `DOCTOR_INTERNAL_ERROR`.

For a running session, verify listeners and reverse rules with:

```powershell
npm run sandbox:android:doctor -- -Mode Running -Serial <serial> -ConsoleRegistrationConfirmed
```

Add `-RequireArtifacts` only when `creatorx.ait` is intentionally present, for example immediately after `npm run build:ait`.

## Automated build gate

Before device testing, run the complete local gate:

```powershell
nvm use 24.18.0
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run build:appintoss
npm run build:ait
npm run verify:artifact
```

Artifact verification must report `appName` `creatorx`, `permissions` `[]`, entrypoint `web/index.html`, and `uncompressedBytes` strictly below `104857600`.

## Physical Android Sandbox session

Use separate PowerShell terminals for long-running log capture and development servers. Omit `-- -Serial <serial>` when exactly one authorized device is connected.

1. Terminal A: start log capture and leave it running.

   ```powershell
   npm run sandbox:android:logcat -- -Serial <serial>
   ```

2. Terminal B: create and verify the three device-to-host reverse rules, then start Granite. The dev command repeats reverse setup as a safety check and prints the deep link.

   ```powershell
   npm run sandbox:android:reverse -- -Serial <serial>
   npm run sandbox:android:dev -- -Serial <serial>
   ```

3. In the Sandbox, sign in with the same personal Toss Business account used by the console. Select its workspace and the registered `크리에이터X` app, complete Toss authentication, enter `intoss://creatorx`, and open the scheme.

4. After the servers are listening, use a third terminal to run the running-mode doctor shown above. It must exit `0` before recording a passing smoke session.

5. Execute and record every physical smoke item:

   - [ ] Home loads without a blank, retry, or bridge-error screen.
   - [ ] Open a creator detail and verify content and chart interaction.
   - [ ] Place an order and verify the success/result state.
   - [ ] Open the portfolio and verify the new position and balance.
   - [ ] Native back returns through detail/order/portfolio history correctly.
   - [ ] Native back at the root closes the mini-app instead of trapping the user.
   - [ ] Reopen or restart the Sandbox, open `intoss://creatorx` again, and verify the order/portfolio state persisted.

6. Capture screenshots at the home, creator detail, order result, portfolio, and persistence checkpoints:

   ```powershell
   npm run sandbox:android:screenshot -- -Serial <serial>
   ```

7. Stop Terminal A and Terminal B with `Ctrl+C`. Preserve the evidence until its review is complete.

## Evidence and log inspection

Device evidence is ignored by Git and written under:

- `.artifacts/android/logcat-YYYYMMDD-HHMMSS.txt`
- `.artifacts/android/screenshot-YYYYMMDD-HHMMSS.png`

Local build evidence includes the ignored root `creatorx.ait`, `/.granite/`, `/.next/`, and `/out/` outputs. `npm run verify:artifact` prints the deterministic artifact JSON to the terminal; capture that JSON in the task or release report before cleanup.

Inspect the log from the exact smoke-session time window. Start with:

```powershell
Select-String -Path .artifacts\android\logcat-*.txt `
  -Pattern 'FATAL EXCEPTION','renderer.*crash','crash.*renderer','unhandled.*bridge.*rejection','WebView.*load.*fail' `
  -CaseSensitive:$false
```

Treat any matching fatal exception, Chromium renderer crash, unhandled bridge rejection, or WebView load failure as a failed smoke. Diagnose it systematically, correct the cause, and rerun the full physical session and inspection; do not merely delete the log.

## Sandbox HTTP versus live HTTPS

The Sandbox permits plain `http` transport for local development. That allowance is Sandbox-only. Live Apps-in-Toss traffic supports `https` only, so every non-Sandbox endpoint and production configuration must use HTTPS. A feature that works only through an HTTP URL in Sandbox is not release-ready.

## Troubleshooting and safe cleanup

- `DEVICE_MISSING`: reconnect with a data cable, unlock the phone, and confirm USB debugging is enabled.
- `DEVICE_UNAUTHORIZED`: accept the computer fingerprint prompt on the unlocked phone. If the prompt is stale, revoke USB debugging authorizations on the device, reconnect, and authorize again.
- `DEVICE_OFFLINE`: reconnect the cable, then restart only the project-local adb server with `.\.tools\android\platform-tools\adb.exe kill-server` and rerun the doctor.
- `DEVICE_MULTIPLE`: choose the intended serial from `.\.tools\android\platform-tools\adb.exe devices -l` and pass `-- -Serial <serial>` to every Android command.
- `ADB_MISSING` or `ADB_INTEGRITY_MISMATCH`: rerun the pinned installer with explicit license acceptance. Do not substitute an arbitrary `adb` from `PATH`.
- `PORT_IN_USE`: inspect the owning process and coordinate with its owner. Never stop PID `6060` or another repository's service as a convenience.
- `REVERSE_MISSING`: rerun `sandbox:android:reverse`, then the running-mode doctor.
- `TOSS_CONSOLE_REGISTRATION_UNCONFIRMED`: complete the console registration with the exact identity, then explicitly add `-ConsoleRegistrationConfirmed`.

Remove only this session's reverse rules; avoid `adb reverse --remove-all`, which could disrupt another session:

```powershell
$adb = '.\.tools\android\platform-tools\adb.exe'
& $adb -s <serial> reverse --remove tcp:8081
& $adb -s <serial> reverse --remove tcp:5173
& $adb -s <serial> reverse --remove tcp:3000
```

The generated root `creatorx.ait` and `/.granite/` may be removed only after resolving both paths and confirming they are inside this worktree. Keep `.artifacts/android/` until the screenshots and log have been reviewed. Never remove another checkout's tools, artifacts, listeners, or evidence.
