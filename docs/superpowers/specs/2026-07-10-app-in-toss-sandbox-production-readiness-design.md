# CreatorX Apps-in-Toss Sandbox and Production Readiness Design

Date: 2026-07-10  
Status: Approved for implementation

## 1. Objective

Prepare CreatorX for two sequential outcomes:

1. Run the application successfully on an Android device through the Apps-in-Toss Sandbox.
2. Replace the device-local demonstration behavior with a production-capable shared backend and satisfy the repository, mobile, packaging, and release-quality gates defined below.

The work uses a sandbox-first sequence so device feedback is available before external hosting and Toss business-verification work is complete. CreatorX remains a virtual-points game. It must not present virtual points, creator prices, or orders as real financial instruments or real-money investments.

## 2. Confirmed Starting State

- The repository is a Next.js 16 and React 19 application.
- Apps-in-Toss WebView SDK 2.x and Granite configuration already exist.
- The configured immutable app name is `creatorx`.
- `ait build` currently creates a valid `creatorx.ait` artifact.
- Apps-in-Toss mode currently replaces server APIs with bundled demo data and device-local state.
- The Android Apps-in-Toss Sandbox application is installed.
- A Toss Business console account, workspace, and registered `creatorx` mini-app do not yet exist.
- The repository currently has lint failures, no standard automated test command, no Android platform tools, and no verified physical-device connection.

## 3. Delivery Stages

The scope is implemented through two consecutive plans so each plan remains independently testable:

- Plan 1, Sandbox Readiness: Stages A through C. It ends with an Android Sandbox smoke test or a precisely documented external console/USB-authorization gate.
- Plan 2, Shared Backend and Release Readiness: Stages D and E. It starts immediately after Plan 1 and ends with the private consumer-Toss test or a precisely documented user-owned credential/review gate.

Both plans are part of this approved design. Finishing Plan 1 does not mark the full objective complete.

### Stage A: Deterministic repository and Sandbox-ready demo

- Pin Node.js 24 and declare supported package-manager versions.
- Add repeatable install, lint, typecheck, test, build, and verification commands.
- Resolve all ESLint errors and warnings.
- Add a test framework and cover data adapters, validation, trading rules, session handling, and App-in-Toss mode selection.
- Replace silent bridge failures with observable, recoverable application states.
- Add Android safe-area, viewport, keyboard, navigation, and external-link handling.
- Replace the Toss logo with a CreatorX-owned app icon and release assets.
- Add terms, privacy, and support routes. Sandbox builds may use the CreatorX development-team identity and repository issue tracker. Production builds require explicit verified operator name, contact, privacy contact, and effective-date environment values.
- Preserve a deterministic demonstration dataset for console-independent and offline Sandbox checks.

### Stage B: Android tooling and local Sandbox execution

- Install official Android Platform Tools into the untracked project-local `.tools/` directory.
- Add a Windows PowerShell doctor command that checks Node, npm, SDK packages, `adb`, connected devices, USB authorization, required ports, Granite configuration, and build artifacts.
- Add a Windows PowerShell runner that configures `adb reverse` for ports 8081, 5173, and 3000, then starts Granite with a LAN-capable host.
- Print the `intoss://creatorx` launch target and a device smoke-test checklist.
- Capture relevant `adb logcat` output and screenshots during physical-device verification.

The user must enable Android developer options and USB debugging, connect and authorize the device, and complete Toss identity prompts. These actions cannot be bypassed by repository automation.

### Stage C: User-owned Toss console setup

The user creates a Toss Business account and workspace, then registers an app whose immutable app name is exactly `creatorx`. Repository documentation provides the exact field mapping and verification checklist. After registration, the user signs into the Android Sandbox with the same account and approves the Toss verification prompt.

This is an external identity gate. Implementation and local verification continue up to the gate, but physical Sandbox success cannot be claimed until the user completes it.

### Stage D: Shared backend and production data mode

- Keep the current Next.js API layer as the service boundary.
- Use PostgreSQL through Prisma for users, balances, creators, orders, trades, positions, and sessions.
- Provide a local Docker Compose PostgreSQL environment for repeatable integration tests.
- Target Vercel for the Next.js deployment and Supabase PostgreSQL for the managed production database.
- Keep YouTube API access on the server.
- Apply the private-test and production Apps-in-Toss CORS origins.
- Use HTTPS for all non-Sandbox traffic.
- Perform balance validation, order placement, matching, cancellation, and portfolio updates only in server transactions.
- Add request idempotency, rate limiting, structured errors, and audit-friendly trade records.

Vercel, Supabase, YouTube, and Toss credentials remain user-owned secrets. Creating accounts, accepting terms, supplying payment details, or completing identity and business verification requires the user.

### Stage E: Private Toss test and release readiness

- Build the `.ait` artifact.
- Upload through the Apps-in-Toss console or authenticated `ait deploy` flow.
- Run the consumer-Toss private QR test.
- Verify Android Sandbox and consumer-Toss behavior before review.
- Confirm legal identity, support contact, icon assets, review metadata, and production endpoints.

## 4. Application Architecture

### 4.1 Shared UI

All browser, Sandbox, and production modes use the same React screens. Platform-specific behavior is isolated behind App-in-Toss runtime utilities. UI components do not know whether data originates from bundled demo state or the remote API.

### 4.2 Explicit data adapters

Replace global `window.fetch` interception with a typed `CreatorXDataClient` interface and two implementations:

- `DemoDataClient`: deterministic bundled data, Toss Storage persistence, and browser local-storage fallback only when the native bridge is unavailable.
- `RemoteDataClient`: HTTPS requests to the shared backend with typed responses, authentication, retry rules, and structured errors.

The selected adapter is controlled by validated build-time configuration. Development and a `sandbox` release channel can use either adapter. A `production` release-channel artifact fails validation if it selects demo mode or lacks a remote API URL.

### 4.3 Server authority

The browser sends user intent, such as an order request or cancellation request. It never calculates an authoritative balance, fill, or portfolio result. The server validates and commits those results in a database transaction and returns the committed state.

## 5. Identity and Session Design

### 5.1 Sandbox identity

Before Toss business verification, Sandbox demo mode uses `getAnonymousKey()` only as a device-scoped namespace. The key is not treated as proof of a real-world identity.

Remote Sandbox mode creates a server-owned guest account and issues a short-lived access token plus a rotatable refresh token. Client-supplied balances, roles, or account identifiers are ignored. Tokens are stored through Apps-in-Toss Storage and kept out of URLs.

### 5.2 Production identity

Authentication is exposed through a provider interface. The initial provider supports server-owned guest sessions for the virtual-points game. After Toss business verification, a Toss Login provider replaces guest sign-in without changing data clients or screens. Server-side verification and any required Toss certificates are mandatory before the Toss Login provider can be enabled.

Normal browser mode can continue to use the existing NextAuth Google provider, but browser and Toss identities map to one internal user model.

## 6. Android Sandbox Workflow

The supported Windows workflow is:

1. `npm ci`
2. `npm run sandbox:android:install-tools`
3. Enable developer options and USB debugging on the Android device.
4. Connect the device and approve the computer fingerprint prompt.
5. `npm run sandbox:android:doctor`
6. `npm run sandbox:android:dev`
7. Sign into the Sandbox with the registered Toss Business workspace account.
8. Open `intoss://creatorx`.
9. Execute the documented smoke scenarios.

The automation reports distinct failures for a missing device, unauthorized device, offline device, missing console registration, port collision, incompatible Node version, missing build configuration, and server startup failure.

## 7. Mobile and WebView Behavior

- Apply CSS safe-area insets to fixed headers, bottom actions, dialogs, and full-height screens.
- Avoid raw `100vh` where dynamic viewport units are required.
- Keep native back behavior: navigate browser history when possible and close the root view otherwise.
- Use the Apps-in-Toss-supported external-link mechanism instead of relying on `_blank` behavior.
- Preserve input visibility when the Android keyboard opens.
- Show actionable retry UI for bridge, storage, session, and network failures.
- Declare only permissions that are actually used. The initial configuration remains permission-free.

## 8. Legal, Brand, and Release Assets

- Create a unique CreatorX icon and required raster sizes from a repository-owned source asset.
- Provide `/terms`, `/privacy`, and `/support` routes.
- State clearly that all balances, prices, and trades are virtual and have no cash value.
- Document collected pseudonymous identifiers, session data, trade history, retention, deletion requests, and support channels.
- Fail production configuration validation when verified operator and contact values are absent.

## 9. Error Handling

- Domain and API errors use stable machine-readable codes and user-readable Korean messages.
- Network requests use bounded retries only for safe and idempotent operations.
- Order submissions use an idempotency key and never retry blindly.
- Bridge and storage fallbacks are logged in development and shown as recoverable UI when they affect user state.
- Production builds do not silently fall back to demo data or local storage.
- Android tooling preserves server and `adb logcat` diagnostics in ignored output directories.
- Generated `.ait`, `.granite`, `.tools`, logs, screenshots, tokens, and local environment files remain ignored unless a file is an intentionally reviewed release asset.

## 10. Verification Gates

The work is complete only when all applicable gates pass with fresh evidence:

- ESLint reports zero errors and zero warnings.
- TypeScript reports zero errors.
- Unit and service tests pass.
- PostgreSQL integration tests pass.
- Standard Next.js build passes.
- Apps-in-Toss static build passes.
- `ait build` passes and creates an uncompressed artifact below 100 MB.
- Main route smoke checks pass.
- Android doctor detects one authorized device and confirms port reverse rules.
- Android Sandbox loads the root screen and completes creator-detail, order, portfolio, back-navigation, close, and state-persistence scenarios.
- `adb logcat` contains no fatal application, WebView, or Apps-in-Toss bridge errors for the smoke session.
- The consumer-Toss private QR test passes before review submission.

## 11. Iteration and Stop Conditions

Failed automated gates trigger diagnosis, a focused correction, and a full rerun of relevant verification. Work continues until the gates pass or an external user-owned prerequisite blocks further progress.

The only expected external stop conditions are:

- Toss identity, workspace, app registration, business verification, or review actions.
- Android USB authorization performed on the physical device.
- Vercel, Supabase, Google/YouTube, or Toss secret provisioning.
- Acceptance of third-party terms or any paid-service decision.

When one occurs, the handoff must state the exact action, screen, value, and next command. Work resumes immediately after the user completes that action.
