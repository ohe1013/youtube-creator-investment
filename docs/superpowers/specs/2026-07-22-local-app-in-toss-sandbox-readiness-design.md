# CreatorX Local Apps-in-Toss Sandbox Readiness Design

**Status:** Approved by the user on 2026-07-22.

## Objective

Make this Windows PC reproducibly ready to build, inspect, and launch CreatorX through the Apps-in-Toss Android Sandbox. Run every repository-owned automated gate that can run safely on this machine and report any remaining device or Toss Console requirement as an explicit external gate.

## Scope

This work covers:

- Bringing the linked feature worktree forward to the current `origin/main` implementation without discarding the existing branch history.
- Installing the repository-pinned Android Platform Tools only beneath the ignored `.tools/android/` directory. The user has approved acceptance of the Platform Tools license.
- Checking the pinned Node/npm versions, npm dependencies, Granite configuration, Android tooling, ports, and connected Android device state.
- Running the repository's lint, test, App-in-Toss build, artifact-verification, and fail-closed production-configuration gates.
- Running the physical Sandbox workflow if an authorized Android device and a confirmed `creatorx` Toss Console registration are available.
- Recording concrete command output, artifact locations, and any blocked gate in a tracked local-readiness report.

This work does not create a Toss Business account, register an app, assert that a Console registration exists, deploy Vercel/Supabase resources, add production credentials, or fabricate device evidence. Those actions remain user-owned external operations.

## Approach

### 1. Establish a safe source baseline

The active `feat/app-in-toss-readiness` branch contains the pre-history-rewrite scanner commits. `origin/main` carries their rewritten equivalents and differs only in safe, non-literal secret-test fixtures. Before local readiness work, create a local backup ref and rebase the feature branch onto `origin/main`. If Git reports a conflict or any non-fixture difference, stop and preserve the conflict state for review instead of choosing a side automatically.

### 2. Bootstrap only project-local prerequisites

Use the lockfile-controlled npm install and the existing `sandbox:android:install-tools` command. The Android installer may write only under `.tools/android/`; it must not change a machine-wide Android SDK or overwrite another checkout. Then run the repository doctor in preflight mode. An absent device, unauthorized device, or unconfirmed Console registration is a blocked result, not a reason to weaken the doctor.

### 3. Verify the repository in layers

Run verification in this order so failures remain attributable:

1. Git cleanliness and toolchain/doctor checks.
2. Dependency integrity and static gates: `npm ci`, lint, and the project test suite using explicit paths where worktree discovery could otherwise leak sibling tests.
3. App-in-Toss build and deterministic artifact verification.
4. Production configuration guard checks, including confirmation that missing dashboard values fail closed without revealing a value.
5. Android Sandbox runtime checks only after the preflight doctor is green and the required user-owned conditions are true.

When a database, Android device, or Console registration is absent, execute all unrelated gates and record the exact blocked command, code, and operator action needed to resume. Do not invent database URLs, tokens, or registration assertions to turn a blocked check green.

### 4. Physical Sandbox acceptance path

If the doctor finds exactly one authorized device and the user has actually registered `creatorx` in the Toss Console, run the existing reverse, logcat, dev, running-doctor, and screenshot commands. A passing physical smoke session requires the documented root, creator-detail, order, portfolio, back-navigation, close, and persistence checks plus retained log/screenshot evidence.

If either prerequisite is absent, local readiness is still complete when all repository-owned checks pass and the report gives the exact command to resume from the device/Console gate.

## Evidence and Completion Criteria

The final report must state, for each gate, the command, exit status, result, and evidence location. The PC is locally Sandbox-ready when:

- The feature branch is based on the current `origin/main` source without losing work.
- The pinned Platform Tools are installed locally and the doctor reports no repository/toolchain/configuration failure.
- Lint, applicable automated tests, App-in-Toss build, and artifact verification pass.
- Production preflight rejects missing production values as designed; no real credential is added to the worktree or output.
- Either a physical Sandbox smoke test passes, or the report names the sole remaining user-owned Console/device action and the exact command to rerun afterward.

No build, test, or device result will be claimed without fresh command output from this worktree.
