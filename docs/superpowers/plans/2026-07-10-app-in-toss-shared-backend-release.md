# CreatorX Shared Backend and Apps-in-Toss Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PostgreSQL authoritative for CreatorX identities, balances, orders, fills, and portfolios; connect the static mini-app over HTTPS; and pass private consumer-Toss release testing.

**Architecture:** Use decimal, reserved-asset accounting inside serializable PostgreSQL transactions; normalize NextAuth, guest, and Toss Login into one server principal; expose stable typed API contracts through exact-origin CORS. Deploy the Next server to Vercel with Supabase PostgreSQL, while keeping credentials and mTLS material server-only.

**Tech Stack:** Node.js 24.18.0, Next.js 16 Node runtime, Prisma 5.21.1, PostgreSQL 16, Zod 4, Vitest 4, jose, undici mTLS, Vercel, Supabase, Apps-in-Toss Web Framework 2.10.4.

## Global Constraints

- Execute this plan only after Plan 1 automated gates pass and the Android Sandbox path is ready.
- All money-like values and quantities cross HTTP as decimal strings; JavaScript floating-point values are never authoritative.
- The server ignores client-supplied user IDs, roles, balances, fills, current prices, and portfolio totals.
- Access tokens live for 15 minutes. CreatorX refresh tokens are opaque 256-bit values; only SHA-256 hashes are stored and every use rotates the token.
- Toss AccessToken/RefreshToken values remain server-side. The client stores only CreatorX tokens.
- Partner Toss API calls use Node runtime, the console-issued mTLS certificate/private key, and `apps-in-toss-api.toss.im:443`.
- CORS is exact-origin only: `https://creatorx.private-apps.tossmini.com`, `https://creatorx.apps.tossmini.com`, and explicitly configured local origins outside production.
- Live and QR traffic require HTTPS. Production cannot use demo data or browser-storage fallback.
- Migrations are additive/data-preserving. Never reset a user-owned or production database.
- No certificate, private key, access/refresh token, API key, database URL, or plaintext secret may enter git, `out/`, or `creatorx.ait`.
- Real Toss Login, Vercel/Supabase resource creation, secret entry, bundle upload, and review actions are user-owned external gates.

## File Structure

- `lib/config/{public-env,server-env}.ts`: split static/public and server-only configuration.
- `lib/contracts/**`: decimal-string API and session contracts.
- `lib/server/http/**`: errors, request IDs, exact CORS, HTTPS, and rate limiting.
- `lib/server/auth/**`: principal resolution, guest sessions, Toss mTLS gateway.
- `lib/server/trading/**`: serializable transaction, matching, portfolio serialization.
- `lib/server/youtube/**`: server-only ingestion owned by cron/admin routes.
- `tests/integration/**`: real PostgreSQL concurrency and API tests.

---

### Task 1: Add local PostgreSQL and an isolated integration-test harness

**Files:**
- Create: `compose.yaml`
- Create: `.env.test.example`
- Create: `tests/integration/setup/global-setup.ts`
- Create: `tests/integration/database-health.test.ts`
- Create: `vitest.integration.config.ts`
- Create: `docs/runbooks/backend-local.md`
- Modify: `.env.example`
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: isolated `creatorx_test` PostgreSQL on localhost port 54329
- Produces: `test:integration`, `db:up`, `db:down`, `db:migrate`

- [ ] **Step 1: Write the failing database health test**

```typescript
// tests/integration/database-health.test.ts
import { afterAll, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

it("runs against the isolated creatorx test database", async () => {
  const result = await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
  expect(result[0]?.database).toBe("creatorx_test");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:integration -- tests/integration/database-health.test.ts`

Expected: connection failure because the test database is not running/configured.

- [ ] **Step 3: Add the container and integration configuration**

```yaml
# compose.yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: creatorx
      POSTGRES_PASSWORD: creatorx_local_only
      POSTGRES_DB: creatorx_test
    ports:
      - "54329:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U creatorx -d creatorx_test"]
      interval: 2s
      timeout: 3s
      retries: 20
    volumes:
      - creatorx_postgres:/var/lib/postgresql/data
volumes:
  creatorx_postgres:
```

`.env.test.example` contains:

```dotenv
DATABASE_URL=postgresql://creatorx:creatorx_local_only@localhost:54329/creatorx_test?schema=public
DIRECT_URL=postgresql://creatorx:creatorx_local_only@localhost:54329/creatorx_test?schema=public
CREATORX_ACCESS_TOKEN_SECRET=replace-with-32-byte-test-secret
CREATORX_IDENTITY_PEPPER=replace-with-32-byte-test-pepper
CRON_SECRET=replace-with-test-cron-secret
```

Global setup must refuse a database name that does not end in `_test`, run `prisma migrate deploy`, and seed only deterministic fixtures.

- [ ] **Step 4: Start, migrate, test, and commit**

```powershell
docker compose up -d postgres
Copy-Item .env.test.example .env.test.local
npm run db:migrate
npm run test:integration -- tests/integration/database-health.test.ts
```

Expected: one passing test against `creatorx_test`.

```powershell
git add compose.yaml .env.test.example .env.example .gitignore package.json package-lock.json vitest.integration.config.ts tests/integration/setup tests/integration/database-health.test.ts docs/runbooks/backend-local.md
git commit -m "test: add isolated postgres integration harness"
```

### Task 2: Add decimal, reserved-asset, identity, session, idempotency, and execution persistence

**Files:**
- Modify: `prisma/schema.prisma:98-240`
- Create: `prisma/migrations/20260710_shared_backend_foundation/migration.sql`
- Create: `lib/contracts/decimal.ts`
- Create: `lib/contracts/decimal.test.ts`
- Create: `tests/integration/migration-foundation.test.ts`
- Modify: `prisma/seed.ts`

**Interfaces:**
- Produces: `DecimalString`, decimal serializers, authoritative reserve/session tables
- Consumed by: Tasks 3 through 8

- [ ] **Step 1: Write failing decimal and schema tests**

```typescript
import { expect, it } from "vitest";
import { decimalStringSchema, serializeDecimal } from "@/lib/contracts/decimal";

it("keeps exact decimal text", () => {
  expect(decimalStringSchema.parse("100000.0000")).toBe("100000.0000");
  expect(serializeDecimal("0.10000000")).toBe("0.10000000");
});
```

Integration assertions: User has `reservedBalance`; Position has `reservedQuantity`; AuthIdentity uniqueness holds; refresh hashes are unique; idempotency uniqueness is `userId+operation+key`; and rate-limit buckets expire.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- lib/contracts/decimal.test.ts; npm run test:integration -- tests/integration/migration-foundation.test.ts`

- [ ] **Step 3: Implement the additive Prisma model**

```prisma
enum IdentityProvider { GUEST TOSS }

model AuthIdentity {
  id        String           @id @default(cuid())
  provider  IdentityProvider
  subject   String
  userId    String
  user      User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  sessions  AppSession[]
  createdAt DateTime         @default(now())
  updatedAt DateTime         @updatedAt
  @@unique([provider, subject])
  @@index([userId])
}

model AppSession {
  id               String    @id @default(cuid())
  userId           String
  identityId       String
  refreshFamilyId  String
  refreshTokenHash String    @unique
  expiresAt        DateTime
  revokedAt        DateTime?
  replacedById     String?
  lastUsedAt       DateTime?
  createdAt        DateTime  @default(now())
  user             User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  identity         AuthIdentity @relation(fields: [identityId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@index([refreshFamilyId])
}

model IdempotencyRecord {
  id             String   @id @default(cuid())
  userId         String
  operation      String
  key            String
  requestHash    String
  state          String
  responseStatus Int?
  responseBody   Json?
  expiresAt      DateTime
  createdAt      DateTime @default(now())
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, operation, key])
  @@index([expiresAt])
}
```

Add the matching relation arrays to User (`identities`, `appSessions`, `idempotencyRecords`) before `prisma validate`. Convert available/reserved balance and price fields to `Decimal(20,4)`; quantities to `Decimal(20,8)`. Rename the legacy Trade table to `LegacyTrade` without dropping rows, and create an immutable `TradeExecution` with maker/taker order IDs, buyer/seller IDs, creator, price, quantity, quote amount, and execution time. Add `reservedQuote`, `reservedQuantity`, `completedAt`, and `cancelReason` to Order. Add `RateLimitBucket`.

- [ ] **Step 4: Make the migration data-preserving**

Use `ALTER COLUMN ... TYPE DECIMAL ... USING ROUND(...)` for existing numeric columns. Rename rather than delete the legacy trade table. Add constraints that available/reserved values are nonnegative and filled quantity does not exceed order quantity.

- [ ] **Step 5: Deploy to the test DB, verify, and commit**

```powershell
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm test -- lib/contracts/decimal.test.ts
npm run test:integration -- tests/integration/migration-foundation.test.ts
git add prisma lib/contracts/decimal.ts lib/contracts/decimal.test.ts tests/integration/migration-foundation.test.ts
git commit -m "feat: add production trading persistence"
```

### Task 3: Add stable API errors, server configuration, exact CORS/HTTPS, and database rate limiting

**Files:**
- Create: `lib/contracts/api.ts`
- Create: `lib/config/public-env.ts`
- Create: `lib/config/server-env.ts`
- Create: `lib/server/http/api-error.ts`
- Create: `lib/server/http/route-handler.ts`
- Create: `lib/server/http/cors.ts`
- Create: `lib/server/http/rate-limit.ts`
- Create: `lib/server/http/http.test.ts`
- Create: `tests/integration/rate-limit.test.ts`
- Create: `proxy.ts`
- Modify: `next.config.ts:1-18`
- Delete after migration: `lib/rate-limit.ts`

**Interfaces:**
- Produces: `ApiErrorBody`, `withApiRoute`, `enforceRateLimit`, exact-origin response headers

- [ ] **Step 1: Write failing HTTP policy tests**

Test unique request IDs; hidden internal exception messages; exact private/prod origins; no wildcard; rejected unknown origin; production HTTPS enforcement; atomic rate limit and `Retry-After`; and production config rejection for demo, HTTP, or missing API URL.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- lib/server/http/http.test.ts`

- [ ] **Step 3: Implement stable errors and route wrapper**

```typescript
export type ApiErrorBody = {
  error: { code: string; message: string; requestId: string; details?: unknown };
};

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
  }
}

export function withApiRoute(handler: (request: Request, context: { requestId: string }) => Promise<Response>) {
  return async (request: Request) => {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    try { return withCors(await handler(request, { requestId }), request); }
    catch (error) { return withCors(toErrorResponse(error, requestId), request); }
  };
}
```

- [ ] **Step 4: Implement exact CORS/HTTPS and DB rate limits**

Allow only the two CreatorX Toss origins plus validated development origins. In production require `https` from the request URL or trusted `x-forwarded-proto`. Rate-limit buckets use a hashed principal/IP key and atomic PostgreSQL upsert; never use process memory.

- [ ] **Step 5: Verify and commit**

```powershell
npm test -- lib/server/http/http.test.ts
npm run test:integration -- tests/integration/rate-limit.test.ts
npm run lint
npm run typecheck
git add lib/contracts/api.ts lib/config lib/server/http proxy.ts next.config.ts
git rm lib/rate-limit.ts
git commit -m "feat: enforce production api boundaries"
```

### Task 4: Implement unified browser and guest authentication with rotating CreatorX sessions

**Files:**
- Create: `lib/contracts/session.ts`
- Create: `lib/server/auth/types.ts`
- Create: `lib/server/auth/request-auth.ts`
- Create: `lib/server/auth/guest-session.ts`
- Create: `lib/server/auth/providers/nextauth.ts`
- Create: `lib/server/auth/providers/guest.ts`
- Create: `lib/server/auth/guest-session.test.ts`
- Create: `app/api/auth/guest/route.ts`
- Create: `app/api/auth/guest/refresh/route.ts`
- Create: `app/api/auth/session/route.ts`
- Create: `app/api/auth/logout/route.ts`
- Create: `tests/integration/guest-session.test.ts`
- Modify: `lib/auth.ts:1-43`
- Modify: `types/next-auth.d.ts:1-12`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `AuthPrincipal`, `requirePrincipal(request)`, guest create/refresh/revoke endpoints

- [ ] **Step 1: Install token support and write failing lifecycle tests**

Run: `npm install --save-exact jose`

```typescript
export interface AuthPrincipal {
  userId: string;
  sessionId?: string;
  provider: "google" | "guest" | "toss";
  role: "USER" | "ADMIN";
}
```

Tests cover access issuer/audience/type/sub/sid/jti/iat/exp, 15-minute expiry, hashed refresh storage, rotation, revoked/expired rejection, family revocation on reuse, ignored client role/balance/userId, and NextAuth fallback.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- lib/server/auth/guest-session.test.ts`

- [ ] **Step 3: Implement server-owned guest identities**

Derive the stored guest subject as HMAC-SHA256(`CREATORX_IDENTITY_PEPPER`, anonymous key), upsert `AuthIdentity(provider=GUEST)`, and create the user with 100,000 available points. Never persist the raw anonymous key.

```typescript
export async function requirePrincipal(request: Request): Promise<AuthPrincipal> {
  const bearer = readBearer(request);
  if (bearer) return verifyCreatorXAccessToken(bearer);
  const browser = await authenticateNextAuthRequest();
  if (browser) return browser;
  throw new ApiError(401, "UNAUTHORIZED", "로그인이 필요합니다.");
}
```

- [ ] **Step 4: Implement rotating refresh and logout**

Refresh accepts one opaque token, verifies its hash in a serializable transaction, revokes it, creates the replacement, and returns a new access/refresh pair. Reuse of a replaced token revokes every session with that family ID. Logout revokes the current family.

- [ ] **Step 5: Verify and commit**

```powershell
npm test -- lib/server/auth/guest-session.test.ts
npm run test:integration -- tests/integration/guest-session.test.ts
npm run lint
npm run typecheck
git add package.json package-lock.json lib/contracts/session.ts lib/server/auth app/api/auth lib/auth.ts types/next-auth.d.ts tests/integration/guest-session.test.ts
git commit -m "feat: add unified creatorx app sessions"
```

### Task 5: Add the credential-gated Toss Login provider and mTLS gateway

**Files:**
- Create: `lib/server/auth/providers/toss.ts`
- Create: `lib/server/toss/login-gateway.ts`
- Create: `lib/server/toss/login-gateway.test.ts`
- Create: `app/api/auth/toss/exchange/route.ts`
- Create: `app/api/auth/toss/unlink/route.ts`
- Modify: `lib/session/CreatorXSessionProvider.tsx`
- Modify: `lib/session/CreatorXSessionProvider.test.tsx`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `TossLoginGateway.exchangeCode`, `refresh`, `loginMe`
- Consumes official `appLogin(): { authorizationCode, referrer }`

- [ ] **Step 1: Install the Node mTLS client and write failing gateway tests**

Run: `npm install --save-exact undici`

```typescript
export interface TossLoginGateway {
  exchangeCode(input: { authorizationCode: string; referrer: "DEFAULT" | "SANDBOX" }): Promise<TossTokens>;
  refresh(refreshToken: string): Promise<TossTokens>;
  loginMe(accessToken: string): Promise<{ userKey: string }>;
}
```

Mock-transport tests must assert the base URL, JSON body, Bearer header, `resultType === "SUCCESS"`, one-hour access metadata, no token logging, malformed/error response normalization, and client cert/key use.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- lib/server/toss/login-gateway.test.ts`

- [ ] **Step 3: Implement official server exchange over mTLS**

```typescript
import { Agent, fetch } from "undici";

const dispatcher = new Agent({
  connect: {
    cert: Buffer.from(env.TOSS_MTLS_CERT_BASE64, "base64").toString("utf8"),
    key: Buffer.from(env.TOSS_MTLS_KEY_BASE64, "base64").toString("utf8"),
  },
});

const BASE_URL = "https://apps-in-toss-api.toss.im";
// POST /api-partner/v1/apps-in-toss/user/oauth2/generate-token
// POST /api-partner/v1/apps-in-toss/user/oauth2/refresh-token
// GET  /api-partner/v1/apps-in-toss/user/oauth2/login-me
```

Map only `login-me.success.userKey` to `AuthIdentity(provider=TOSS)`. Do not request or store optional personal-information scopes.

- [ ] **Step 4: Connect the WebView login without retaining Toss tokens**

The client calls `appLogin()`, immediately posts `authorizationCode` and `referrer` to CreatorX, and receives only CreatorX access/refresh tokens. The code is single-use and valid for 10 minutes; it is never stored. Add a disabled state with an actionable message when Toss Login env/business verification is absent.

- [ ] **Step 5: Verify mocked behavior and document the live external gate**

```powershell
npm test -- lib/server/toss/login-gateway.test.ts lib/session/CreatorXSessionProvider.test.tsx
npm run lint
npm run typecheck
```

Do not call the live Toss endpoint until the user supplies console-issued mTLS material and enables Toss Login terms/scopes. Record the official references:

- `https://developers-apps-in-toss.toss.im/login/develop.html`
- `https://developers-apps-in-toss.toss.im/development/integration-process.html`
- `https://developers-apps-in-toss.toss.im/prepare/console-workspace.html`

```powershell
git add package.json package-lock.json lib/server/toss lib/server/auth/providers/toss.ts app/api/auth/toss lib/session/CreatorXSessionProvider.tsx lib/session/CreatorXSessionProvider.test.tsx
git commit -m "feat: add apps-in-toss login provider"
```

### Task 6: Replace the matching engine with serializable, idempotent reserved-asset trading

**Files:**
- Create: `lib/contracts/trading.ts`
- Create: `lib/server/trading/errors.ts`
- Create: `lib/server/trading/serializable-transaction.ts`
- Create: `lib/server/trading/matching-service.ts`
- Create: `lib/server/trading/portfolio-service.ts`
- Create: `tests/integration/trading-concurrency.test.ts`
- Create: `tests/integration/trading-conservation.test.ts`
- Create: `tests/integration/trading-idempotency.test.ts`
- Delete after route migration: `lib/matching-engine.ts`

**Interfaces:**
- Produces: `placeOrder(principal, input, idempotencyKey)`
- Produces: `cancelOrder(principal, orderId, idempotencyKey)`
- Produces: `getPortfolio(principal)`

- [ ] **Step 1: Write failing critical trading tests**

Tests must prove: concurrent buys cannot overspend; two takers cannot double-fill one maker; available+reserved+executed assets conserve through partial fill/cancel; same key/body replays; same key/different body returns 409; self-trade is rejected; MARKET remainder is cancelled/refunded; cross-user cancel is rejected; and price-time priority holds.

```typescript
export interface PlaceOrderInput {
  creatorId: string;
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET";
  quantity: DecimalString;
  limitPrice?: DecimalString;
  maxSlippageBps?: number;
}
```

LIMIT requires `limitPrice`. MARKET ignores client price, uses the server's current price and bounded `maxSlippageBps`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npm run test:integration -- tests/integration/trading-concurrency.test.ts tests/integration/trading-conservation.test.ts tests/integration/trading-idempotency.test.ts
```

- [ ] **Step 3: Implement bounded serializable retries**

```typescript
export async function withSerializableRetry<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isPrismaWriteConflict(error) || attempt === 2) throw error;
    }
  }
  throw new Error("unreachable");
}
```

At transaction start execute a PostgreSQL transaction advisory lock derived from creator ID. Reserve balance/quantity with conditional updates. Exclude the same user's orders. Create one immutable TradeExecution per fill. Refetch the committed order and portfolio before returning.

- [ ] **Step 4: Implement idempotency**

Hash the canonical request body. Insert `IdempotencyRecord` before mutation. A completed identical request replays its response. A different hash returns `409 IDEMPOTENCY_KEY_REUSED`. An in-progress collision returns a deterministic conflict/retry response. Expire records after 24 hours.

- [ ] **Step 5: Run concurrency tests repeatedly**

```powershell
1..10 | ForEach-Object {
  npm run test:integration -- tests/integration/trading-concurrency.test.ts
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Expected: all ten runs pass with exact conservation assertions.

- [ ] **Step 6: Verify and commit**

```powershell
npm run test:integration -- tests/integration/trading-concurrency.test.ts tests/integration/trading-conservation.test.ts tests/integration/trading-idempotency.test.ts
npm run lint
npm run typecheck
git add lib/contracts/trading.ts lib/server/trading tests/integration/trading-*.test.ts
git commit -m "feat: make creatorx trading transactional"
```

### Task 7: Rewire API routes, move YouTube writes to cron, and activate remote data mode

**Files:**
- Modify: `app/api/trade/route.ts:1-43`
- Modify: `app/api/orders/[id]/route.ts:1-30`
- Modify: `app/api/portfolio/route.ts:1-73`
- Modify: `app/api/creators/[id]/route.ts:1-257`
- Modify: `app/api/internal/cron/update-stats/route.ts:1-114`
- Create: `lib/server/youtube/youtube-client.ts`
- Create: `lib/server/youtube/refresh-creator.ts`
- Create: `tests/integration/api-contracts.test.ts`
- Create: `tests/integration/youtube-boundary.test.ts`
- Modify: `lib/data/remote-client.ts`
- Modify: `lib/session/CreatorXSessionProvider.tsx`
- Delete after migration: `lib/youtube.ts`

**Interfaces:**
- Consumes: unified principal, trading services, remote client, and cron secret
- Produces: authenticated typed API routes and side-effect-free public reads

- [ ] **Step 1: Write failing API and YouTube boundary tests**

Assert stable error envelopes, required auth, required idempotency header for mutations, cross-user cancel rejection, decimal-string DTOs, rate-limit headers, exact CORS, public creator/video GET never calling YouTube, and missing `CRON_SECRET` failing closed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:integration -- tests/integration/api-contracts.test.ts tests/integration/youtube-boundary.test.ts`

- [ ] **Step 3: Rewire mutation and portfolio routes**

```typescript
export const POST = withApiRoute(async (request, { requestId }) => {
  const principal = await requirePrincipal(request);
  await enforceRateLimit({ principal, operation: "place-order" });
  const key = requireIdempotencyKey(request);
  const input = placeOrderInputSchema.parse(await request.json());
  return Response.json(await placeOrder(principal, input, key), { status: 201, headers: { "x-request-id": requestId } });
});
```

Cancel and portfolio routes use the same principal and service boundaries. Never expose raw Prisma Decimal objects; serialize through shared DTOs.

- [ ] **Step 4: Make public reads side-effect free**

Move YouTube network calls into `lib/server/youtube` with `import "server-only"`. Public creator/video routes read PostgreSQL only. The cron route validates a nonempty `CRON_SECRET` before any work and owns refresh/upsert behavior.

- [ ] **Step 5: Activate authenticated remote mode**

Store CreatorX refresh tokens through the Plan 1 storage adapter, keep access tokens in memory, refresh once on 401, and retry only the original safe GET once. Mutating requests are not automatically retried. Set:

```dotenv
NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL=production
NEXT_PUBLIC_CREATORX_DATA_MODE=remote
NEXT_PUBLIC_CREATORX_API_BASE_URL=https://api.example.invalid
```

The invalid example must fail the deployment smoke check until replaced with the real HTTPS deployment URL.

- [ ] **Step 6: Verify and commit**

```powershell
npm run test:integration -- tests/integration/api-contracts.test.ts tests/integration/youtube-boundary.test.ts
npm test -- lib/data/remote-client.test.ts lib/session/CreatorXSessionProvider.test.tsx
npm run lint
npm run typecheck
git add app/api lib/server/youtube lib/data/remote-client.ts lib/session/CreatorXSessionProvider.tsx tests/integration
git rm lib/matching-engine.ts lib/youtube.ts
git commit -m "feat: connect creatorx app to authoritative api"
```

### Task 8: Add Vercel/Supabase production preflight and secret-leak gates

**Files:**
- Create: `vercel.json`
- Create: `app/api/health/route.ts`
- Create: `scripts/production-preflight.mjs`
- Create: `scripts/scan-client-secrets.mjs`
- Create: `tests/scripts/production-preflight.test.ts`
- Create: `docs/runbooks/vercel-supabase.md`
- Modify: `package.json`
- Modify: `scripts/appintoss-build.mjs`

**Interfaces:**
- Consumes: Vercel/Supabase/server/public env and Plan 1 build commands
- Produces: fail-closed production preflight, health endpoint, and secret scan

- [ ] **Step 1: Write failing production preflight tests**

Test missing pooled `DATABASE_URL`, direct `DIRECT_URL`, token secret, identity pepper, cron secret, verified legal fields, HTTPS API URL, Toss CORS origins, and optional Toss Login certificate pair. Test that PEM markers, database URLs, token strings, and API keys are absent from `out/` and `.ait`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/scripts/production-preflight.test.ts`

- [ ] **Step 3: Implement fail-closed preflight**

```javascript
const required = [
  "DATABASE_URL", "DIRECT_URL", "CREATORX_ACCESS_TOKEN_SECRET",
  "CREATORX_IDENTITY_PEPPER", "CRON_SECRET",
  "NEXT_PUBLIC_CREATORX_API_BASE_URL",
  "NEXT_PUBLIC_CREATORX_OPERATOR_NAME",
  "NEXT_PUBLIC_CREATORX_SUPPORT_URL",
  "NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT",
  "NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE",
  "NEXT_PUBLIC_CREATORX_ICON_URL",
];
for (const key of required) {
  if (!process.env[key]) throw new Error("Missing production variable: " + key);
}
```

When `CREATORX_TOSS_LOGIN_ENABLED=1`, also require base64 cert/key and login configuration. Health checks report database connectivity and build revision but never secrets.

- [ ] **Step 4: Document Vercel/Supabase mapping**

Use Supabase's pooled connection for runtime `DATABASE_URL` and direct connection for `DIRECT_URL` migrations. Run `prisma migrate deploy` before release. Record Vercel Node runtime, HTTPS URL, CORS origins, environment scope, and rollback commands. Do not create resources or paste values into tracked files.

- [ ] **Step 5: Verify and commit**

Add exact scripts:

```json
{
  "production:preflight": "node scripts/production-preflight.mjs",
  "build:appintoss:production": "node scripts/appintoss-build.mjs --release-channel production",
  "scan:client-secrets": "node scripts/scan-client-secrets.mjs"
}
```

```powershell
npm test -- tests/scripts/production-preflight.test.ts
npm run production:preflight
npm run build
npm run build:appintoss:production
npm run scan:client-secrets
git add vercel.json app/api/health scripts package.json docs/runbooks/vercel-supabase.md tests/scripts/production-preflight.test.ts
git commit -m "build: add creatorx production preflight"
```

The preflight is expected to remain externally blocked until the user provides real Vercel/Supabase and legal values.

### Task 9: Build, upload, and prove the private Toss release

**Files:**
- Create: `docs/runbooks/toss-private-release.md`
- Create: `docs/release-evidence/.gitkeep`
- Modify: `README.md`

**Interfaces:**
- Consumes: production artifact, deployed health URL, console API key or manual upload, deployment ID
- Produces: private-test evidence and precise external review/release handoff

- [ ] **Step 1: Document the exact official release flow**

Include:

- `npx ait build`
- Console upload or `npx ait token add` followed by `npx ait deploy -m "..."`
- `intoss-private://creatorx?_deploymentId=<id>`
- Tester must be a logged-in workspace member and age 19+
- At least one consumer-Toss test before review
- HTTPS and the two exact CORS origins
- Approval and public release are separate console actions

Reference:

- `https://developers-apps-in-toss.toss.im/development/test/toss.html`
- `https://developers-apps-in-toss.toss.im/development/deploy.html`

- [ ] **Step 2: Run every local and server gate with production values**

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run production:preflight
npm run build:appintoss:production
npm run build:ait
npm run verify:artifact
npm run scan:client-secrets
```

Expected: all exit 0 and the artifact is below 100 MB uncompressed.

- [ ] **Step 3: Verify deployed health and exact CORS**

Request `/api/health` over HTTPS. Send preflight requests from the private and production Toss origins and one unknown origin. Only the exact two receive CORS headers.

- [ ] **Step 4: Cross the user-owned credential gate**

The user signs into Toss Business, supplies Vercel/Supabase/Toss secrets through their dashboards, issues the mTLS certificate if Toss Login is enabled, uploads the bundle, and returns the generated deployment ID. Never request secrets in chat or commit them.

- [ ] **Step 5: Perform private consumer-Toss smoke testing**

Open the private scheme and verify login, creator list/detail, order, concurrent refresh, portfolio, cancel, back/root close, external link, restart persistence, and network recovery. Confirm shared state from a second authorized tester if available. Capture deployment ID, artifact SHA-256, server revision, timestamp, and pass/fail checklist without secrets.

- [ ] **Step 6: Commit the runbook/evidence index**

```powershell
git add README.md docs/runbooks/toss-private-release.md docs/release-evidence/.gitkeep
git commit -m "docs: add creatorx private release runbook"
```

Plan 2 is complete only when the private consumer-Toss test passes. If credentials, business verification, mTLS issuance, or console review remains outstanding, report the exact console action and resume at Step 4 after the user completes it.
