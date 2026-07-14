# Bounded Client Secret Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace duplicated client-secret detection with one bounded scanner that blocks secret material without public-config, comment, literal, regex, or large-input bypasses.

**Architecture:** Create scripts/client-payload-scanner.mjs as the sole scanner. It owns byte decoding, direct detectors, JavaScript lexical context, and the literal-only Supabase anonymous JWT exception. verify-ait-artifact.mjs retains AIT/ZIP integrity validation; scan-client-secrets.mjs retains filesystem/CLI validation. Both call the new module.

**Tech Stack:** Node.js 24, ESM, Acorn 8.17.0, Vitest 4, Apps-in-Toss AIT format, Next.js 16, Windows PowerShell.

## Global Constraints

- Work only in E:\github\youtube-creator-investment\.worktrees\app-in-toss-readiness on feat/app-in-toss-readiness.
- The current three-file scanner WIP is evidence only. Do not reset, checkout, or bulk-delete it; use apply_patch to replace superseded production code and retain only matching regression tests.
- Artifact and output gates must call exactly one shared detector. Do not leave duplicate regex, tokenizer, comment tracker, opaque-window, or public-value-range engines.
- Errors contain only a safe category and file label. Never echo a matched secret.
- Reject PostgreSQL URLs with or without credentials. Preserve AWS, Google, GitHub, Stripe, Supabase secret, Slack, MySQL, and MongoDB detection.
- Reject ordinary/encrypted private-key PEM markers in raw, base64, escaped, UTF-16LE, and UTF-16BE forms.
- Reject every JWT except a static literal assigned to exactly NEXT_PUBLIC_SUPABASE_ANON_KEY with claims role equal to anon.
- PEM, URL, and known-secret detection is final before lexical policy. JWT classification is final only after the scanner has considered the exact static-literal exception; no exception applies to the other detector categories.
- Ignore assignment-shaped text only in comments, ordinary strings, template text, and regex literals. Direct PEM, URL, and disallowed JWT rules apply in every context.
- Never evaluate client code or retain a full token array. Candidate values are bounded and work is linear per decoded view.
- Preserve AIT ZIP paths, hashes, size, manifest, and web/index.html validation.
- Toss Console, Android device, ports, and production credentials remain user-owned external gates.

## File Structure

- Create: scripts/client-payload-scanner.mjs - shared API, normalized views, direct detectors, streamed lexical policy.
- Create: tests/scripts/client-payload-scanner.performance.test.ts - isolated 10 MiB memory/time regression.
- Modify: package.json and package-lock.json - direct development dependency on acorn 8.17.0.
- Modify: scripts/verify-ait-artifact.mjs - import/re-export scanner and retain AIT-only code.
- Modify: scripts/scan-client-secrets.mjs - import scanner and retain output traversal/CLI only.
- Modify: tests/scripts/verify-ait-artifact.test.ts - retain fixture/parity helpers and add policy cases.
- Modify only if import compatibility requires it: tests/scripts/production-preflight.test.ts.
- Modify only after clean final review: .superpowers/sdd/p2-task-8-report.md and .superpowers/sdd/progress.md.

---

### Task 1: Add the shared scanner contract and direct detector baseline

**Files:**
- Create: scripts/client-payload-scanner.mjs
- Modify: package.json
- Modify: package-lock.json
- Modify: tests/scripts/verify-ait-artifact.test.ts

**Interfaces:**
- Produces scanClientPayload(bytes, options?) returning detected and optional safe code.
- Produces containsSpecificSecretBytes(bytes) compatibility wrapper.
- Does not route the existing consumers yet.

- [ ] **Step 1: Record the pre-task WIP without mutating it**

Run:

~~~powershell
git status --short
git diff -- scripts/verify-ait-artifact.mjs scripts/scan-client-secrets.mjs tests/scripts/verify-ait-artifact.test.ts
git diff --check
~~~

Expected: only the known scanner WIP files are modified. Do not run destructive Git commands.

- [ ] **Step 2: Write failing direct-detector tests**

Create focused unit assertions for scanClientPayload in tests/scripts/verify-ait-artifact.test.ts or a new dedicated scanner test file. Add synthetic cases for credential-free postgresql URLs, ordinary/encrypted PEM markers, base64/escaped/UTF-16LE/UTF-16BE variants, and valid general or alg:none JWTs. Each assertion must require detected=true with the safe category only. Do not use AIT/output parity helpers yet because the consumers are intentionally unchanged until Task 3.

At this task a raw anonymous JWT remains rejected. Its only exception is Task 2.

- [ ] **Step 3: Run the focused selection and verify red**

Run:

~~~powershell
npm test -- tests/scripts/verify-ait-artifact.test.ts -t "PostgreSQL|PEM|base64|UTF-16|structurally valid"
~~~

Expected: missing-module import or legacy behavior fails the new assertions.

- [ ] **Step 4: Add Acorn and the direct scanner**

After red:

~~~powershell
npm install --save-dev --package-lock-only acorn@8.17.0
~~~

Create scripts/client-payload-scanner.mjs with this API:

~~~js
export const ClientPayloadDetectionCode = Object.freeze({
  POSTGRES_URL: "POSTGRES_URL",
  PRIVATE_KEY_PEM: "PRIVATE_KEY_PEM",
  UNAPPROVED_JWT: "UNAPPROVED_JWT",
  PUBLIC_SECRET_ASSIGNMENT: "PUBLIC_SECRET_ASSIGNMENT",
  KNOWN_SECRET: "KNOWN_SECRET",
});

export function scanClientPayload(bytes, options = {}) {
  for (const view of createBoundedTextViews(bytes, options)) {
    const code = detectDirectNonJwtSecret(view);
    if (code) return { detected: true, code };
    if (containsJwtCandidate(view)) {
      return { detected: true, code: ClientPayloadDetectionCode.UNAPPROVED_JWT };
    }
  }
  return { detected: false };
}

export function containsSpecificSecretBytes(bytes) {
  return scanClientPayload(bytes).detected;
}
~~~

createBoundedTextViews yields valid UTF-8 plus at most one BOM or alternating-NUL-confirmed UTF-16 view. detectDirectNonJwtSecret retains legacy known patterns, rejects all PostgreSQL schemes, and scans bounded base64 candidates for private-key markers. containsJwtCandidate parses bounded JWT header/claims JSON without evaluation and rejects every valid candidate in Task 1. Return categories only. Do not implement global compaction, marker windows, or token arrays.

- [ ] **Step 5: Verify green and commit**

Run:

~~~powershell
npm test -- tests/scripts/verify-ait-artifact.test.ts -t "PostgreSQL|PEM|base64|UTF-16|structurally valid"
npm ls acorn --depth=0
git add package.json package-lock.json scripts/client-payload-scanner.mjs tests/scripts/verify-ait-artifact.test.ts
git diff --cached --check
git commit -m "build: add bounded client payload scanner"
~~~

Expected: focused tests pass and root acorn@8.17.0 is present.

### Task 2: Add streamed JavaScript context and the exact anonymous JWT exception

**Files:**
- Modify: scripts/client-payload-scanner.mjs
- Modify: tests/scripts/verify-ait-artifact.test.ts

**Interfaces:**
- Consumes Task 1 direct detector.
- Produces executable public-secret-assignment detection and exact allowed anonymous-JWT literal ranges.

- [ ] **Step 1: Write failing lexical-policy tests**

Add table-driven expectations for:

- static NEXT_PUBLIC_SUPABASE_ANON_KEY literal with role anon passes;
- role user/service_role under that key rejects;
- same anon JWT under NEXT_PUBLIC_API_URL or any other key rejects;
- dynamic anonymous-key values reject;
- comments, ordinary strings, template text, and regex literals containing pseudo assignments pass;
- template interpolation, direct/member/computed static assignments, Object.defineProperty, and Reflect.set reject;
- return, throw, case, regex character class, escaped names, U+2028/U+2029, and UTF-16 preserve the same policy.

Use only synthetic createTestJwt and the existing AIT/output parity helpers.

- [ ] **Step 2: Run and verify red**

Run:

~~~powershell
npm test -- tests/scripts/verify-ait-artifact.test.ts -t "Supabase anon|regex literal|template interpolation|computed|Reflect|line-comment"
~~~

Expected: static anonymous exception and at least one lexical context assertion fail before the tokenizer policy exists.

- [ ] **Step 3: Implement streamed Acorn handling**

Use Acorn tokenizer one token at a time:

~~~js
import { tokenizer } from "acorn";

function* iterateTokens(text) {
  const stream = tokenizer(text, {
    ecmaVersion: "latest",
    sourceType: "script",
    allowHashBang: true,
  });
  for (let token = stream.getToken(); token.type.label !== "eof"; token = stream.getToken()) {
    yield token;
  }
}
~~~

Keep bounded rolling state. Decode literal values only when they can be a static key, assignment value, or JWT candidate. Mark an allowed range only when the exact resolved key is NEXT_PUBLIC_SUPABASE_ANON_KEY and claims role is anon. Then replace Task 1's unconditional containsJwtCandidate result with a bounded JWT walk that returns UNAPPROVED_JWT unless the exact candidate range is marked allowed. If tokenization fails, grant no exception.

Recognize direct/member/computed-static assignments and Object/Reflect setters. Do not create an AST, execute code, or allow a broad NEXT_PUBLIC range.

- [ ] **Step 4: Verify green and commit**

Run:

~~~powershell
npm test -- tests/scripts/verify-ait-artifact.test.ts -t "Supabase anon|regex literal|template interpolation|computed|Reflect|line-comment"
rg -n "collectNonSensitivePublicConfigurationValueRanges|tokenizeJavaScriptLike|createJavaScriptCommentOffsetTracker" scripts/client-payload-scanner.mjs
git add scripts/client-payload-scanner.mjs tests/scripts/verify-ait-artifact.test.ts
git diff --cached --check
git commit -m "fix: enforce literal-only client JWT policy"
~~~

Expected: tests pass; rg exits 1 because the new module has no broad-range or custom lexical engine.

### Task 3: Route AIT and output gates through the one scanner

**Files:**
- Modify: scripts/verify-ait-artifact.mjs
- Modify: scripts/scan-client-secrets.mjs
- Modify: tests/scripts/verify-ait-artifact.test.ts
- Modify: tests/scripts/production-preflight.test.ts only if import compatibility requires it

**Interfaces:**
- Preserves verifyAitArtifact, scanClientSecrets, CLI codes, AIT_SECRET_DETECTED, CLIENT_SECRET_DETECTED, and verifier compatibility export.
- Removes duplicate detector paths from consumers.

- [ ] **Step 1: Add failing parity and compatibility tests**

Create one corpus using the existing opaque-payload helpers: direct/encoded PEM, credential-free PostgreSQL URL, allowed anon literal, disallowed public-key JWT, pseudo assignments, and executable Object/Reflect assignments. Preserve this compatibility assertion:

~~~ts
import { containsSpecificSecretBytes } from "../../scripts/verify-ait-artifact.mjs";

expect(containsSpecificSecretBytes(Buffer.from('const x = "public";'))).toBe(false);
~~~

Every rejecting corpus item must reject through both gates with a safe code/file label and must not echo fixture text.

- [ ] **Step 2: Run and verify red**

Run:

~~~powershell
npm test -- tests/scripts/verify-ait-artifact.test.ts -t "opaque payload|both gates|does not echo|Supabase anon"
~~~

Expected: at least one parity or compatibility test fails before both consumers are rewired.

- [ ] **Step 3: Replace only consumer detection code**

In scripts/verify-ait-artifact.mjs import and re-export the compatibility function:

~~~js
import { containsSpecificSecretBytes } from "./client-payload-scanner.mjs";
export { containsSpecificSecretBytes } from "./client-payload-scanner.mjs";
~~~

Keep AIT/ZIP readers, path checks, SHA-256 checks, entrypoint checks, reader/CLI code, and error normalization. Replace payload and manifest checks with the shared scanner; scan manifest with Buffer.from(stringifyManifestMetadata(reader)). Remove the legacy detector block, readable-payload second scan, opaque engine, custom tracker, and duplicate JWT/key helpers when unused.

In scripts/scan-client-secrets.mjs import scanner and verifier separately:

~~~js
import { containsSpecificSecretBytes } from "./client-payload-scanner.mjs";
import { verifyAitArtifact } from "./verify-ait-artifact.mjs";

for (const file of files) {
  const bytes = await readFile(file.path);
  if (containsSpecificSecretBytes(bytes)) {
    reject("CLIENT_SECRET_DETECTED", "Suspected secret in client output: " + file.label);
  }
}
~~~

Keep recursion, symlink/file-size validation, artifact translation, and CLI output. Remove local patterns, assignment regex, readable text, local client detector, and comment-tracker imports.

- [ ] **Step 4: Verify green and commit**

Run:

~~~powershell
npm test -- tests/scripts/verify-ait-artifact.test.ts tests/scripts/production-preflight.test.ts
rg -n "containsClientSecret|specificSecretPatterns|secretAssignmentPattern|createJavaScriptCommentOffsetTracker|opaqueTransformationMarkerPrefixes" scripts/verify-ait-artifact.mjs scripts/scan-client-secrets.mjs
git add scripts/verify-ait-artifact.mjs scripts/scan-client-secrets.mjs tests/scripts/verify-ait-artifact.test.ts tests/scripts/production-preflight.test.ts
git diff --cached --check
git commit -m "refactor: unify client secret release gates"
~~~

Expected: tests pass; rg exits 1; no duplicate consumer engine remains.

### Task 4: Prove 10 MiB bounds and fresh release readiness

**Files:**
- Create: tests/scripts/client-payload-scanner.performance.test.ts
- Modify after final review: .superpowers/sdd/p2-task-8-report.md
- Modify after final review: .superpowers/sdd/progress.md

**Interfaces:**
- Consumes shared scanner and both release gates.
- Produces reproducible resource and fresh-artifact evidence.

- [ ] **Step 1: Write a failing isolated performance test**

Create a Vitest test launching node with --expose-gc and importing the shared scanner by pathToFileURL. The child emits JSON metrics only. It scans 10 MiB public-marker punctuation, repeated comments, malformed escapes, repeated valid static anonymous configuration, and base64-like non-PEM text. An appended executable secret must detect.

~~~ts
expect(result.status).toBe(0);
const metrics = JSON.parse(result.stdout);
expect(metrics.filter((item: { expected: boolean }) => item.expected === false).every((item: { detected: boolean }) => item.detected === false)).toBe(true);
expect(metrics.find((item: { expected: boolean }) => item.expected === true)?.detected).toBe(true);
expect(Math.max(...metrics.map((item: { elapsedMs: number }) => item.elapsedMs))).toBeLessThan(5_000);
expect(Math.max(...metrics.map((item: { retainedHeapBytes: number }) => item.retainedHeapBytes))).toBeLessThan(32 * 1024 * 1024);
~~~

The child calls global.gc before/after each scan and measures heapUsed. Do not add test-only production exports.

- [ ] **Step 2: Run red, finish harness, and run green**

Run:

~~~powershell
npm test -- tests/scripts/client-payload-scanner.performance.test.ts
~~~

Expected: red before harness implementation, then green with the explicit runtime and retained-heap bounds.

- [ ] **Step 3: Run all local gates**

Run:

~~~powershell
npm test -- tests/scripts/client-payload-scanner.performance.test.ts tests/scripts/verify-ait-artifact.test.ts tests/scripts/production-preflight.test.ts
npm test
npm run test:integration
npm run db:migrate
npm run lint
npm run typecheck
npm run build
npm run build:appintoss
Test-Path app\api
Test-Path .appintoss-api-disabled
Test-Path out\web\index.html
~~~

Expected: tests/builds pass; app/api=True, hidden API directory=False, and out/web/index.html=True.

- [ ] **Step 4: Build a fresh artifact and prove both gates**

Safely replace only the resolved worktree-root creatorx.ait, then run:

~~~powershell
npm run build:ait
npm run verify:artifact
npm run scan:client-secrets
Get-FileHash -Algorithm SHA256 creatorx.ait
~~~

Expected: fresh artifact includes web/index.html, remains below 100 MiB uncompressed, and both gates pass. Run the six-native-bundle compatibility probe; every bundle must return false.

- [ ] **Step 5: Confirm production gates fail closed without dashboard values**

Run:

~~~powershell
npm run production:preflight
$preflightExit = $LASTEXITCODE
npm run build:appintoss:production
$buildExit = $LASTEXITCODE
if ($preflightExit -eq 0 -or $buildExit -eq 0) { throw "Production gate unexpectedly passed" }
~~~

Expected: each command fails at Missing production variable: DATABASE_URL without printing a secret.

- [ ] **Step 6: Commit, independently review, and record completion**

Run:

~~~powershell
git add tests/scripts/client-payload-scanner.performance.test.ts
git diff --cached --check
git commit -m "test: bound client payload scanner resources"
git diff --check 51d507d..HEAD
git status --short
~~~

Dispatch a fresh read-only reviewer with the Task 1-4 diff, approved design, full test results, fresh artifact metrics, and mandatory checks for direct/encoded secrets, exact anonymous JWT exception, lexical context, 10 MiB bounds, shared wiring, and preserved artifact validation. Fix every Critical or Important finding before appending final evidence to .superpowers/sdd/p2-task-8-report.md and marking P2-8 complete.
