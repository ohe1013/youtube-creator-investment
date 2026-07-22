# CreatorX Local Apps-in-Toss Sandbox Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make this Windows PC reproducibly able to validate and prepare CreatorX for an Apps-in-Toss Android Sandbox session, while isolating genuinely user-owned device and Toss Console gates.

**Architecture:** Preserve application behavior and drive the existing repository interfaces in dependency order: align the linked worktree to `origin/main`, select the pinned Node/npm runtime through NVM for Windows, install the pinned Android Platform Tools under `.tools/android`, then execute static, database, artifact, and doctor gates. A tracked evidence report records fresh outcomes without production credentials or fabricated device proof.

**Tech Stack:** Git linked worktree, NVM for Windows, Node.js 24.18.0, npm 11.16.0, Docker Compose/PostgreSQL 16, Next.js 16, Prisma 5, Vitest 4, Apps-in-Toss Web Framework, PowerShell 5.1, Android Platform Tools 37.0.1.

## Global Constraints

- Work only in `E:\github\youtube-creator-investment\.worktrees\app-in-toss-readiness`; do not alter the sibling main worktree.
- Create `backup/feat-app-in-toss-readiness-pre-local-20260722` before rebasing the feature branch.
- The accepted Android Platform Tools license permits only the repository installer, which writes under ignored `.tools/android/`.
- Node must report `v24.18.0` and npm must report `11.16.0` before dependency, lint, test, or build gates run.
- Use only `.env.test.local` and a database whose names end in `_test` for integration testing; never supply production URLs, Toss credentials, or real secrets.
- Treat doctor exit code `2` as an external block only when output has no `[FAIL]` entry. Do not pass `-ConsoleRegistrationConfirmed` without a real Console registration.
- Do not stop processes on ports 8081, 5173, or 3000. Record any occupied port as a doctor block.
- If any gate fails unexpectedly, invoke `superpowers:systematic-debugging` before changing implementation code.

---

### Task 1: Align the linked worktree with the current source baseline

**Files:**
- Modify: Git history for `feat/app-in-toss-readiness` only
- Preserve: `docs/superpowers/specs/2026-07-22-local-app-in-toss-sandbox-readiness-design.md`

**Interfaces:**
- Consumes: clean feature worktree and fetched `origin/main`.
- Produces: a feature branch whose intentional delta from `origin/main` is the approved design and later readiness evidence.

- [ ] **Step 1: Prove cleanliness and inspect the pre-rebase delta**

Run:

```powershell
git status --short
git fetch origin --prune
git rev-parse --short origin/main
git diff --name-status origin/main...HEAD
git diff --check origin/main...HEAD
```

Expected: an empty status; the range contains the design file and only the known scanner-fixture difference; whitespace validation emits nothing.

- [ ] **Step 2: Create the recovery ref**

Run:

```powershell
git show-ref --verify --quiet refs/heads/backup/feat-app-in-toss-readiness-pre-local-20260722
if ($LASTEXITCODE -eq 0) { throw 'Recovery branch already exists; inspect it before continuing.' }
git branch backup/feat-app-in-toss-readiness-pre-local-20260722 HEAD
git rev-parse --short backup/feat-app-in-toss-readiness-pre-local-20260722
```

Expected: the backup points to the pre-rebase feature HEAD.

- [ ] **Step 3: Rebase without automatic conflict choices**

Run:

```powershell
git rebase origin/main
git status --short
git diff --name-only origin/main...HEAD
```

Expected: rewritten scanner patches are skipped or recognized, and no obsolete literal-secret fixture remains. If rebase stops for a conflict, do not run `--continue`, `--skip`, or `--abort`; preserve the conflict state and report its files.

- [ ] **Step 4: Capture exact aligned revisions for the evidence report**

Run:

```powershell
git rev-parse HEAD
git rev-parse origin/main
git log -1 --format='%h %s'
```

Expected: all commands emit the revisions Task 6 records.

### Task 2: Select the pinned Node/npm runtime and restore dependencies

**Files:**
- Modify: ignored `node_modules/` and generated Prisma client only
- Read: `.nvmrc`, `.node-version`, `package.json`, and `package-lock.json`

**Interfaces:**
- Consumes: NVM for Windows at `$env:LOCALAPPDATA\nvm\nvm.exe`, Node pin `24.18.0`, npm pin `11.16.0`.
- Produces: `node` and `npm` accepted by `scripts/android/doctor.ps1`, plus lockfile-defined dependencies.

- [ ] **Step 1: Install and activate Node 24.18.0 with NVM for Windows**

Run:

```powershell
$nvm = Join-Path $env:LOCALAPPDATA 'nvm\nvm.exe'
if (-not (Test-Path -LiteralPath $nvm -PathType Leaf)) { throw "NVM for Windows was not found at $nvm" }
& $nvm install 24.18.0
& $nvm use 24.18.0
node --version
npm --version
```

Expected: Node prints `v24.18.0`; npm may require the exact package-manager update in the next step.

- [ ] **Step 2: Pin npm and verify both versions**

Run:

```powershell
npm install --global npm@11.16.0
node --version
npm --version
```

Expected: exactly `v24.18.0` and `11.16.0`. Stop if either differs; do not run repository gates with Node 22/npm 10.

- [ ] **Step 3: Restore lockfile-defined dependencies**

Run:

```powershell
npm ci
git status --short
```

Expected: `npm ci` runs the existing Prisma generation postinstall hook and does not modify tracked dependencies or the lockfile.

### Task 3: Install project-local Android tools and run a truthful preflight

**Files:**
- Create: ignored `.tools/android/platform-tools/` through `scripts/android/install-platform-tools.ps1`
- Create: ignored `.artifacts/local-readiness-doctor-20260722.txt`
- Read: `scripts/android/platform-tools.json`, `scripts/android/doctor.ps1`

**Interfaces:**
- Consumes: approved Android Platform Tools 37.0.1 download, its repository integrity checks, and the selected Node/npm toolchain.
- Produces: validated local `adb.exe` and a doctor result that separates repository failures from device/Console blocks.

- [ ] **Step 1: Install the repository-pinned Android Platform Tools**

Run:

```powershell
npm run sandbox:android:install-tools -- -AcceptLicense
Get-FileHash '.tools\android\platform-tools\adb.exe' -Algorithm SHA256
```

Expected: `PLATFORM_TOOLS_READY`; the installer validates the archive and executable before leaving it in the worktree.

- [ ] **Step 2: Run the doctor directly and fail on repository faults**

Run:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File scripts/android/doctor.ps1
$doctorExit = $LASTEXITCODE
"DOCTOR_EXIT=$doctorExit"
if ($doctorExit -eq 1) { throw 'Doctor found a repository, toolchain, configuration, or integrity failure.' }
```

Expected: no `[FAIL]` line. Exit `0` means device and Console conditions already exist; exit `2` names a genuine missing device, USB authorization, port, or Console condition.

- [ ] **Step 3: Save the unmasked doctor output**

Run:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File scripts/android/doctor.ps1 2>&1 |
  Tee-Object -FilePath '.artifacts\local-readiness-doctor-20260722.txt'
$doctorExit = $LASTEXITCODE
"DOCTOR_EXIT=$doctorExit"
```

Expected: the ignored evidence file contains every `PASS`, `BLOCKED`, or `FAIL` result. Task 6 reports a block as a block.

### Task 4: Run static, unit, and isolated PostgreSQL integration gates

**Files:**
- Read: `vitest.config.ts`, `vitest.integration.config.ts`, `.env.test.local`, `compose.yaml`, `scripts/test-database-safety.mjs`
- Modify: Docker's `creatorx_postgres` volume only

**Interfaces:**
- Consumes: restored dependencies, Docker Engine, and `.env.test.local` URLs that target `creatorx_test`.
- Produces: fresh lint, type, unit, migration, and integration results without a non-test database.

- [ ] **Step 1: Run the static and unit gates from this worktree**

Run:

```powershell
npm run lint
npm run typecheck
npm test
```

Expected: every command exits `0`; the unit configuration excludes `tests/integration/**` and does not discover sibling worktree tests.

- [ ] **Step 2: Start the local test database and prove health**

Run:

```powershell
npm run db:up
docker compose ps
docker compose exec postgres pg_isready -U creatorx -d creatorx_test
```

Expected: `postgres` is running and `pg_isready` accepts `creatorx_test`.

- [ ] **Step 3: Run the serialized integration suite**

Run:

```powershell
npm run test:integration
```

Expected: Prisma applies migrations only to the `_test` database and every integration test passes. A database-safety or migration failure requires systematic debugging before source edits.

- [ ] **Step 4: Stop the test container without deleting the volume**

Run:

```powershell
npm run db:down
docker compose ps
```

Expected: `postgres` is stopped; no command deletes the Docker volume.

### Task 5: Build normal and Apps-in-Toss artifacts, then verify release guards

**Files:**
- Create: ignored `.next/`, `out/`, `.granite/`, and `creatorx.ait`
- Read: `scripts/appintoss-build.mjs`, `scripts/verify-ait-artifact.mjs`, `scripts/production-preflight.mjs`

**Interfaces:**
- Consumes: passing automated application gates and the existing App-in-Toss build wrapper.
- Produces: a verified `creatorx.ait` and proof that missing production values fail closed.

- [ ] **Step 1: Build and package both application targets**

Run:

```powershell
npm run build
npm run build:appintoss
npm run build:ait
Get-Item 'creatorx.ait' | Select-Object Name,Length,LastWriteTime
```

Expected: normal and static builds exit `0`, `app/api` is restored by the wrapper, and a fresh `creatorx.ait` exists.

- [ ] **Step 2: Verify the artifact and its doctor requirement**

Run:

```powershell
npm run verify:artifact
& powershell -NoProfile -ExecutionPolicy Bypass -File scripts/android/doctor.ps1 -RequireArtifacts
$artifactDoctorExit = $LASTEXITCODE
"ARTIFACT_DOCTOR_EXIT=$artifactDoctorExit"
if ($artifactDoctorExit -eq 1) { throw 'Artifact doctor found a repository or artifact failure.' }
```

Expected: verifier reports `appName` `creatorx`, `permissions` `[]`, entrypoint `web/index.html`, and uncompressed bytes below `104857600`; doctor reports `ARTIFACT_READY`.

- [ ] **Step 3: Prove production configuration rejects absent dashboard values**

Run:

```powershell
npm test -- tests/scripts/production-preflight.test.ts
$preflightOutput = & npm run production:preflight 2>&1
$preflightExit = $LASTEXITCODE
$preflightOutput
"PREFLIGHT_EXIT=$preflightExit"
if ($preflightExit -eq 0) { throw 'Production preflight unexpectedly passed without dashboard values.' }
if (($preflightOutput -join "`n") -notmatch 'Missing production variable: DATABASE_URL') {
  throw 'Production preflight did not fail at the expected missing-variable gate.'
}
$productionBuildOutput = & npm run build:appintoss:production 2>&1
$productionBuildExit = $LASTEXITCODE
$productionBuildOutput
"PRODUCTION_BUILD_EXIT=$productionBuildExit"
if ($productionBuildExit -eq 0) { throw 'Production build unexpectedly passed without dashboard values.' }
if (($productionBuildOutput -join "`n") -notmatch 'Missing production variable: DATABASE_URL') {
  throw 'Production build did not stop at the expected missing-variable gate.'
}
```

Expected: focused tests pass; both credential-free production commands exit nonzero at `Missing production variable: DATABASE_URL` without emitting a secret.

### Task 6: Run the conditional physical path and commit readiness evidence

**Files:**
- Create: `docs/release-evidence/2026-07-22-local-app-in-toss-sandbox-readiness.md`
- Create when a device exists: ignored `.artifacts/android/logcat-*.txt` and `.artifacts/android/screenshot-*.png`
- Read: `.artifacts/local-readiness-doctor-20260722.txt`, `docs/apps-in-toss-sandbox.md`

**Interfaces:**
- Consumes: fresh outcomes from Tasks 1 through 5 and an authorized Android device/Console state only when they actually exist.
- Produces: committed, reproducible evidence and an exact resume command for any remaining user-owned gate.

- [ ] **Step 1: Choose the physical path from the saved doctor result**

Run:

```powershell
Get-Content '.artifacts\local-readiness-doctor-20260722.txt'
```

Expected: run the physical sequence only if the file contains no `FAIL` or `BLOCKED` result. For `DEVICE_MISSING`, `DEVICE_UNAUTHORIZED`, `DEVICE_OFFLINE`, `DEVICE_MULTIPLE`, `TOSS_CONSOLE_REGISTRATION_UNCONFIRMED`, or `PORT_IN_USE`, record that code and its documented remedy instead.


- [ ] **Step 2: Run the physical Sandbox smoke only when an operator has a real device and Console registration**

In each terminal, derive the one authorized device serial rather than guessing it:

```powershell
$adb = (Resolve-Path '.tools\android\platform-tools\adb.exe').Path
$deviceLines = @(& $adb devices -l | Where-Object { $_ -match '\sdevice\s' })
if ($deviceLines.Count -ne 1) { throw "Expected exactly one authorized device, found $($deviceLines.Count)." }
$serial = ($deviceLines[0] -split '\s+')[0]
```

Run in separate PowerShell terminals:

```powershell
npm run sandbox:android:logcat -- -Serial $serial
npm run sandbox:android:reverse -- -Serial $serial
npm run sandbox:android:dev -- -Serial $serial
```

Then run:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File scripts/android/doctor.ps1 -Mode Running -Serial $serial -ConsoleRegistrationConfirmed
npm run sandbox:android:screenshot -- -Serial $serial
```

Expected: running doctor exits `0`; the operator captures the documented home, creator detail, order, portfolio, back-navigation, close, and persistence evidence. Never use the Console flag merely to turn a block green.

- [ ] **Step 3: Write the report from real outcomes only**

Create `docs/release-evidence/2026-07-22-local-app-in-toss-sandbox-readiness.md` with these sections after every named command has run:

```markdown
# CreatorX Local Apps-in-Toss Sandbox Readiness Evidence

Date: 2026-07-22

## Source baseline

Record the exact feature HEAD, origin/main, and rebase result from Task 1.

## Automated gates

For toolchain, Android tools/doctor, static/unit tests, integration tests, artifact build/verifier, and production guard, record the command, exit code, actual result, and evidence path.

## Physical Sandbox state

Record either the retained log/screenshot paths plus every smoke observation, or the literal doctor block, operator action, and exact command needed to resume.
```

Expected: the report separates passing repository gates from physical Android/Console state and contains no credential or unsupported success claim.

- [ ] **Step 4: Validate and commit the report**

Run:

```powershell
git diff --check -- docs/release-evidence/2026-07-22-local-app-in-toss-sandbox-readiness.md
git add docs/release-evidence/2026-07-22-local-app-in-toss-sandbox-readiness.md
git commit -m 'docs: record local Apps-in-Toss readiness'
git status --short
```

Expected: the evidence report is committed, whitespace validation passes, and only ignored local tool/artifact paths remain outside Git tracking.
