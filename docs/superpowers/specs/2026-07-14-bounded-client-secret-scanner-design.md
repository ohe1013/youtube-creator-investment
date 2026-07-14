# Bounded Client Secret Scanner Design

**Date:** 2026-07-14
**Status:** Approved for design by the user; implementation requires this spec and its follow-up plan.
**Scope:** Replace only the client-payload secret-detection core used by the App-in-Toss artifact verifier and output scanner. Archive validation, build wrappers, production preflight, and release runbooks remain unchanged.

## Problem

The existing detector has accumulated independent regular expressions, compacted byte views, opaque marker windows, and a custom JavaScript tokenizer. The paths disagree about comments, regular-expression literals, templates, UTF-16, and public JWT exceptions. Repeated fixes have shown both security bypasses and unbounded allocation risks.

The required policy is fail-closed for client payloads:

- A PostgreSQL URL is never allowed, with or without user credentials.
- Private-key PEM material is never allowed, including encrypted, base64-encoded, escaped, and UTF-16 forms.
- A structurally valid JWT is never allowed unless it is the exact static value assigned to `NEXT_PUBLIC_SUPABASE_ANON_KEY` and its decoded claims have `role: "anon"`.
- Executable assignments of a public configuration key that semantically denotes a secret are never allowed.
- Text that merely looks like a public-secret assignment inside a JavaScript comment, string literal, template text, or regex literal is not an assignment finding. Direct PEM, database URL, or disallowed JWT values remain findings even when they occur in such text.

## Decision

Use one shared, bounded scanner module for both artifact and client-output gates. The module owns byte normalization, direct-secret checks, JavaScript lexical context, and the narrowly defined anonymous-JWT exception. Existing callers only consume a boolean/detection code and must never print matched secret material.

The implementation will make `acorn` an explicit direct **development dependency** at its lockfile-pinned major version. These scanners run in build/release verification, not in the deployed application runtime. Acorn is used as a streaming tokenizer only; no AST, token array, source evaluation, or parser recovery is used.

## Alternatives considered

1. **Continue incremental patches to the current scanner — rejected.** It has already created conflicting lexical rules and a broad public-value allow range.
2. **Block every JWT without exception — rejected.** It can reject a legitimate static Supabase anonymous public key required by the client configuration.
3. **Recommended: one bounded scanner with a literal-only allowlist — selected.** It keeps strict leakage protection while allowing only the specific public configuration value that the application needs.

## Module boundary

Create `scripts/client-payload-scanner.mjs` with a public API equivalent to:

```js
scanClientPayload(bytes, options) => { detected: boolean, code?: string }
containsSpecificSecretBytes(bytes) => boolean
```

`containsSpecificSecretBytes` remains available as a compatibility wrapper for existing tests/callers. `verify-ait-artifact.mjs` and `scan-client-secrets.mjs` import the same module. Neither CLI owns a second detector.

Detection codes are safe categories only (for example `POSTGRES_URL`, `PRIVATE_KEY_PEM`, `UNAPPROVED_JWT`, `PUBLIC_SECRET_ASSIGNMENT`); matched source text is never emitted.

## Scanner pipeline

### 1. Bounded byte and encoding views

For each payload, process the original bytes and at most a fixed set of decoded views:

- UTF-8 text;
- UTF-16LE or UTF-16BE only when a BOM or a high-confidence alternating-NUL signature is present;
- escape-normalized candidate text only inside bounded JavaScript string/template token values.

Do not globally compact, concatenate marker windows, or repeatedly slice the entire payload. Each transformation preserves an offset or a bounded candidate length. Malformed over-limit candidates are treated as a finding rather than evaluated as code.

### 2. Direct secret detectors

Run direct detectors over every decoded view before JavaScript context exceptions:

- Match `postgres://` and `postgresql://` independent of credentials, host, or query string.
- Match private-key PEM markers for ordinary and encrypted private keys. For base64 candidates, decode only a bounded valid candidate and search the decoded bytes for the same marker. The presence of a private-key PEM marker is intentionally fail-closed.
- Recognize compact JWT candidates with bounded segment lengths. Decode header and claims JSON without evaluation. Include standard signed JWTs and `alg: "none"` compact serialization. Invalid/oversized JWT-like values that cannot be classified are findings when they use a JWT header/payload shape.

### 3. Streaming JavaScript lexical context

For JavaScript-like decoded text, obtain tokens from Acorn one at a time with the current ECMAScript version. Do not retain all tokens. Acorn's lexical context handles comments, strings, template interpolation, regex literals, `case`, `return`, `throw`, and ECMAScript line terminators consistently.

If a file cannot be tokenized, direct-secret findings still apply. The scanner must not grant a public-key/JWT exception from malformed or unrecognized syntax.

The lexer recognizes static public-secret assignment forms only in executable token context:

- direct/member/computed-static assignment;
- static string concatenation used as a property key;
- `Object.defineProperty` and `Reflect.set` forms.

It does not interpret arbitrary expressions or execute code.

### 4. Literal-only anonymous JWT exception

The sole JWT exception is a static literal value assigned to exactly `NEXT_PUBLIC_SUPABASE_ANON_KEY`, including an equivalent computed static key. The literal's decoded claims must be `role: "anon"`. The scanner records the exact literal byte range while streaming and suppresses the JWT finding only for that range.

No other `NEXT_PUBLIC_*` key, object field, URL, comment, string, regex literal, dynamic expression, or token with another role receives an exception.

## Safety and resource limits

- No user-controlled code is evaluated.
- No tokenizer output is collected into an array.
- Candidate JWT, PEM/base64, escape, and static-concatenation values have explicit length bounds.
- Per decoded view work is linear in the input length; additional scanner memory is constant apart from the decoded view and a fixed candidate buffer.
- The scanner must handle a 10 MiB file with `NEXT_PUBLIC_` plus punctuation, repeated comments, malformed escapes, repeated anonymous JWT configuration, and base64-like text without high retained heap or quadratic time.

## Test contract

Tests must use synthetic, nonfunctional fixtures and prove both gates make the same decision.

1. **Direct detection:** raw/base64/escaped/UTF-16 LE/BE private-key PEM; encrypted private-key PEM; all PostgreSQL URL forms; general JWT, `alg:none` JWT, whitespace JSON, empty signature, and UTF-16 forms.
2. **JWT policy:** block JWTs under arbitrary public keys and non-anonymous values under `NEXT_PUBLIC_SUPABASE_ANON_KEY`; allow only a static anonymous literal assigned to that exact key.
3. **JavaScript context:** ignore pseudo-assignments in comments, ordinary strings, template text, and regex literals; reject template interpolation, `return`/`throw`/`case` regex contexts followed by real assignments, computed static keys, and Object/Reflect calls.
4. **Parity:** execute both the artifact verifier and the output scanner against the same fixture corpus and assert identical decisions.
5. **Performance:** a child-process harness with `--expose-gc` checks 10 MiB adversarial fixtures for bounded runtime and retained heap. Thresholds must be deliberately generous for Windows CI but reject object-per-character/token-array behavior.
6. **Real artifact:** rebuild a fresh `creatorx.ait`, verify its manifest/size/entrypoint, scan `out/`, and confirm all native bundles are clean.

## Migration sequence

1. Preserve the current WIP only as evidence; do not merge its production scanner implementation by default.
2. Add focused failing tests for the policy above and demonstrate red failures against the legacy scanner.
3. Add the explicit tokenizer dependency and the shared scanner module.
4. Route both CLI gates through it, retain compatibility exports, and remove superseded scanner paths rather than leaving parallel detection engines.
5. Run focused tests, full unit/integration suites, lint, typecheck, normal/App-in-Toss/AIT builds, fresh artifact verification, output scan, and independent security review.

## Non-goals

- This is not a general JavaScript parser, formatter, or minifier.
- It does not inspect server-only source, production dashboards, or external Toss/Vercel/Supabase resources.
- It does not change Android Sandbox, Toss Console registration, or private-release ownership gates.

## Acceptance criteria

The task is complete only when the old broad public-value exemption and duplicate lexical paths are gone; all test contract cases pass; both CLI gates share one implementation; a fresh real artifact passes; and an independent reviewer reports no Critical or Important finding.
