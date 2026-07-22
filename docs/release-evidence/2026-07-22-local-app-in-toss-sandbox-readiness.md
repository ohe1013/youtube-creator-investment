# CreatorX Local Apps-in-Toss Sandbox Readiness Evidence

Date: 2026-07-22

## Scope and conclusion

This record consolidates the real local outcomes from LR-1 through LR-5 and the saved preflight doctor transcript. Repository-owned automated gates passed. The physical Android Sandbox session was **not run**: the saved doctor has external `BLOCKED` results for an absent device, ports owned by other local services, and an unconfirmed Toss Business Console registration. No Console-confirmation switch was supplied, no port-owning process was stopped, and no device log or screenshot was created.

This is therefore evidence of local repository readiness and of the remaining operator-owned prerequisites, not evidence that a physical Sandbox smoke succeeded.

## Source baseline and rebase

Current references checked while writing this report:

| Reference | Value | Result |
| --- | --- | --- |
| Branch | `feat/app-in-toss-readiness` | Current linked-worktree branch. |
| `origin/main` | `13fcbc282c39b4abf10f998f48d1b0213613b1a5` | Baseline fetched by LR-1. |
| LR-1 feature HEAD after approved rebase | `add8f00053598fc4f10d25c0b5b482c000bda177` | `docs: plan local Apps-in-Toss readiness`; the rebase completed at this commit. |
| `HEAD` | `eaa7307abb83e904b251700208c4ece7696f4dcc` | `fix: remove unused scanner options`. |
| `git merge-base --is-ancestor origin/main HEAD` | exit `0` | The current feature head descends from the recorded baseline. |

LR-1 first preserved recovery ref `backup/feat-app-in-toss-readiness-pre-local-20260722` at `432939bb1e3945b17bf9d55c98eade4109637371`. After the user-approved exception, `git rebase --onto origin/main f7c8699` completed and replayed the approved documentation commits `ecb1466e456d5e904ec575abc2ecefbb1c085e04` and `add8f00053598fc4f10d25c0b5b482c000bda177`. LR-4 later repaired the zero-warning lint blocker in reviewed commit `eaa7307abb83e904b251700208c4ece7696f4dcc`.

The current `origin/main...HEAD` name-status delta contains the two local-readiness design/plan documents and `scripts/client-payload-scanner.mjs` from that lint repair. It is not represented as a docs-only range.

Evidence: `.superpowers/sdd/task-LR-1-report.md`, `.superpowers/sdd/task-LR-4-report.md`, and the current Git reference checks above.

## Automated gates

| Gate | Command or check | Exit | Actual result | Evidence |
| --- | --- | ---: | --- | --- |
| Pinned toolchain | fresh `node --version`; `npm --version` | `0` | Node `v24.18.0`; npm `11.16.0`. | `.superpowers/sdd/task-LR-2-report.md` |
| Locked dependencies | `npm ci` | `0` | Lockfile install and Prisma client generation completed; no tracked manifest or lockfile change. | `.superpowers/sdd/task-LR-2-report.md` |
| Project-local Android tools | `npm.cmd run sandbox:android:install-tools -- -AcceptLicense` | `0` | Pinned Android Platform Tools `37.0.1` installed/validated beneath ignored `.tools/android/`; `adb.exe` hash matched the pin. | `.superpowers/sdd/task-LR-3-report.md` |
| Android preflight | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/android/doctor.ps1` | `2` | Five repository checks passed; no `FAIL`; physical prerequisites were blocked. Exit `2` is the documented blocked-only result. | `.artifacts/local-readiness-doctor-20260722.txt` |
| Static analysis | `npm run lint` | `0` | `eslint . --max-warnings=0` completed with no warnings. | `.superpowers/sdd/task-LR-4-report.md` |
| Type check | `npm run typecheck` | `0` | `tsc --noEmit --incremental false` completed. | `.superpowers/sdd/task-LR-4-report.md` |
| Unit suite | `npm test` | `0` | 46 test files and 785 tests passed. | `.superpowers/sdd/task-LR-4-report.md` |
| Isolated PostgreSQL integration | `npm run db:up`; `docker compose ps`; `docker compose exec postgres pg_isready -U creatorx -d creatorx_test`; `npm run test:integration`; `npm run db:down` | `0` each | The isolated `creatorx_test` service became healthy; 12 integration files and 55 tests passed; the service was then stopped without volume deletion. | `.superpowers/sdd/task-LR-4-report.md` |
| Standard production build | `npm run build` | `0` | Next.js compilation, type checking, and 23/23 static-page generation completed. | `.superpowers/sdd/task-LR-5-report.md` |
| Apps-in-Toss static build | `npm run build:appintoss` | `0` | Static 11-page Apps-in-Toss build completed. | `.superpowers/sdd/task-LR-5-report.md` |
| AIT package | `npm run build:ait` | `0` | `AIT build completed (creatorx.ait)`. | `.superpowers/sdd/task-LR-5-report.md` |
| Artifact-aware Android doctor | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/android/doctor.ps1 -RequireArtifacts` | `2` | `[PASS] ARTIFACT_READY`; no `FAIL`; remaining result was blocked-only physical prerequisites. | `.superpowers/sdd/task-LR-5-report.md` |

## Artifact proof

LR-5 recorded the ignored `creatorx.ait` package at `4,888,689` bytes. `npm run verify:artifact` exited `0` and reported:

```json
{"artifactBytes":4888689,"fileBytes":4888689,"uncompressedBytes":24859737,"maxBytes":104857600,"entryCount":136,"formatVersion":1,"appName":"creatorx","deploymentId":"019f8823-7ca6-7156-a93b-306988207952","permissions":[],"hasWebIndex":true,"entrypoint":"web/index.html"}
```

The artifact is therefore below the `104857600` uncompressed-byte ceiling and has the required `creatorx` identity, no permissions, and `web/index.html` entrypoint. The artifact-aware direct doctor also reported `[PASS] ARTIFACT_READY` and exit `2`, with no `FAIL`; its nonzero status was solely the external physical prerequisites listed below.

Evidence: `.superpowers/sdd/task-LR-5-report.md`.

## Expected production guards

The production preflight test command completed successfully:

```text
npm test -- tests/scripts/production-preflight.test.ts
Test Files  1 passed (1)
Tests  107 passed (107)
```

The following credential-free commands were intentionally expected to fail at the first safe production gate:

| Inner command | Inner exit | Verified result |
| --- | ---: | --- |
| `npm run production:preflight` | `1` | Exactly one `Missing production variable: DATABASE_URL` message in the required `PRODUCTION_PREFLIGHT_FAILED:` format. |
| `npm run build:appintoss:production` | `1` | Exactly one `Missing production variable: DATABASE_URL` message in the required `PRODUCTION_PREFLIGHT_FAILED:` format. |

The wrappers validated those expected failures and exited `0`; captured output was not echoed and no credential was set or recorded. These outcomes prove fail-closed behavior with production configuration absent. They do not prove a credentialed production deployment.

Evidence: `.superpowers/sdd/task-LR-5-report.md`.

## Physical Sandbox state: blocked, not attempted

The saved preflight transcript contains five `PASS`, five `BLOCKED`, and zero `FAIL` records. Its literal external blocks are:

```text
[BLOCKED] DEVICE_MISSING DEVICE_MISSING No Android device is attached.
[BLOCKED] PORT_IN_USE Port 5173 is already listening: PID 13032 (node.exe): "node" "E:\git-hg\urban-ts-codex-starter\apps\web\node_modules\.bin\\..\vite\bin\vite.js" --host 0.0.0.0 --port 5173 --host 0.0.0.0 --port 5173. The doctor will not stop it.
[BLOCKED] PORT_IN_USE Port 3000 is already listening: PID 25104 (wslrelay.exe):  --mode 2 --vm-id {603e2bd5-df6d-4255-8a80-d903dbace212} --handle 1440. The doctor will not stop it.
[BLOCKED] PORT_IN_USE Port 3000 is already listening: PID 12760 (com.docker.backend.exe): "C:\Program Files\Docker\Docker\resources\com.docker.backend.exe" services. The doctor will not stop it.
[BLOCKED] TOSS_CONSOLE_REGISTRATION_UNCONFIRMED Register creatorx in Toss Business Console, then pass -ConsoleRegistrationConfirmed.
```

The doctor also passed `PORT_AVAILABLE` for `8081`. The occupied-port records are a point-in-time ownership report; they do not authorize termination of any process.

| Block | Operator-owned action before resume | Safe boundary |
| --- | --- | --- |
| `DEVICE_MISSING` | Connect a data-capable USB Android device, unlock it, enable USB debugging, and accept the workstation RSA prompt. Derive the one authorized serial from project-local `adb`. | Do not guess a serial or continue when zero or multiple authorized devices are listed. |
| `PORT_IN_USE` on `5173` and `3000` | Coordinate with the owners of the other local services and arrange for `8081`, `5173`, and `3000` to be free for this session. | Inspect ownership and obtain the owner’s approval; do not kill the listed processes as a readiness shortcut. |
| `TOSS_CONSOLE_REGISTRATION_UNCONFIRMED` | In Toss Business Console, register/select the intended `creatorx` app with the documented identity, then verify that registration using the same personal account used in Sandbox. | Supply `-ConsoleRegistrationConfirmed` only after that real console check; the flag is an operator assertion, not a Console query. |

No physical logcat capture, Android reverse rule, Granite development server, running-mode doctor, screenshot, or on-device smoke observation was produced for this report. Accordingly, no physical Sandbox success, navigation, order, portfolio, close, or persistence claim is made.

### Safe resume commands

Run the following only after the three operator actions above are complete. The preflight must exit `0`; otherwise stop without starting a physical session.

```powershell
$adb = (Resolve-Path '.tools\android\platform-tools\adb.exe').Path
$deviceLines = @(& $adb devices -l | Where-Object { $_ -match '\sdevice\s' })
if ($deviceLines.Count -ne 1) {
  throw "Expected exactly one authorized device, found $($deviceLines.Count)."
}
$serial = ($deviceLines[0] -split '\s+')[0]

& powershell -NoProfile -ExecutionPolicy Bypass -File scripts/android/doctor.ps1 `
  -Serial $serial -ConsoleRegistrationConfirmed
if ($LASTEXITCODE -ne 0) {
  throw "Preflight remains blocked or failed; do not start the physical Sandbox session."
}
```

Only after that command exits `0`, use separate PowerShell terminals for the physical session:

```powershell
# Terminal A
npm run sandbox:android:logcat -- -Serial $serial

# Terminal B
npm run sandbox:android:reverse -- -Serial $serial
npm run sandbox:android:dev -- -Serial $serial

# Terminal C, after the servers listen
& powershell -NoProfile -ExecutionPolicy Bypass -File scripts/android/doctor.ps1 `
  -Mode Running -Serial $serial -ConsoleRegistrationConfirmed
if ($LASTEXITCODE -ne 0) {
  throw "Running-mode doctor did not pass; do not record a smoke success."
}

# After every documented on-device smoke observation
npm run sandbox:android:screenshot -- -Serial $serial
```

The operator must preserve the session-specific ignored `.artifacts/android/logcat-*.txt` and `.artifacts/android/screenshot-*.png` evidence and record each documented observation before marking the physical path successful.

## Evidence sources

- `.superpowers/sdd/task-LR-1-report.md` — source baseline and rebase.
- `.superpowers/sdd/task-LR-2-report.md` — toolchain and lockfile restore.
- `.superpowers/sdd/task-LR-3-report.md` and `.artifacts/local-readiness-doctor-20260722.txt` — Android tooling and direct preflight transcript.
- `.superpowers/sdd/task-LR-4-report.md` — static, unit, and isolated PostgreSQL integration gates.
- `.superpowers/sdd/task-LR-5-report.md` — builds, artifact verifier, artifact-aware doctor, and expected production guards.
- `docs/apps-in-toss-sandbox.md` — operator-owned Console/device/port rules and physical-session sequence.
