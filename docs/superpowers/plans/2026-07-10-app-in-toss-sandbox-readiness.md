# CreatorX Apps-in-Toss Android Sandbox Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a deterministic, lint-clean CreatorX build that runs through the Android Apps-in-Toss Sandbox with typed demo/remote boundaries and reproducible device diagnostics.

**Architecture:** Replace the global fetch mutation with typed data, session, storage, and bridge providers. Keep a deterministic demo adapter for Sandbox readiness, preserve a remote adapter for Plan 2, and isolate Android automation in project-local scripts.

**Tech Stack:** Node.js 24.18.0, npm 11.16.0, Next.js 16.0.10, React 19.2.1, TypeScript 5, Zod 4, Vitest 4, Apps-in-Toss Web Framework 2.10.4, PowerShell 5.1, Android Platform Tools 37.0.1.

## Global Constraints

- The immutable Apps-in-Toss `appName` remains `creatorx`; display name is `크리에이터X`; app type is `game`; permissions remain empty.
- `development` and `sandbox` channels may use `demo` or `remote`; `production` must use `remote` with an HTTPS API URL.
- Virtual points, prices, and orders must be described as having no cash value.
- Do not disable ESLint rules, add blanket suppressions, or raise warning limits to make the gate pass.
- Native Storage success must never mirror to browser storage. Browser fallback is allowed only when the native bridge is absent and the release channel is not production.
- Generated `.ait`, `.granite/`, `.tools/`, `.artifacts/`, `out/`, secrets, logs, and device screenshots remain untracked.
- Do not stop PID 6060 or any unrelated process occupying port 5173 without explicit user approval.
- Console signup, workspace creation, `creatorx` registration, phone USB authorization, and Toss identity prompts are user-owned gates.

## File Structure

- `lib/runtime/config.ts`: validated public runtime/release configuration.
- `lib/data/contracts.ts`: shared request/response and domain contracts.
- `lib/data/errors.ts`: stable client errors and Korean messages.
- `lib/data/demo-client.ts`: deterministic device-local implementation.
- `lib/data/remote-client.ts`: bounded-retry HTTP implementation.
- `lib/storage/client-storage.ts`: native or browser storage selection.
- `lib/session/CreatorXSessionProvider.tsx`: normalized browser/demo identity.
- `components/runtime/CreatorXDataProvider.tsx`: selected data client context.
- `components/runtime/RuntimeIssueBanner.tsx`: retryable bridge/storage/session failures.
- `components/runtime/ExternalLink.tsx`: safe browser or Apps-in-Toss external navigation.
- `scripts/android/**`: project-local Platform Tools, doctor, reverse, dev, and evidence commands.

---

### Task 1: Pin the toolchain, add the test harness, and validate release configuration

**Files:**
- Create: `.nvmrc`
- Create: `.node-version`
- Create: `.npmrc`
- Create: `.env.example`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `tests/tooling/vitest.test.ts`
- Create: `lib/runtime/config.ts`
- Create: `lib/runtime/config.test.ts`
- Modify: `package.json:1-45`
- Modify: `package-lock.json`
- Modify: `.gitignore:13-55`
- Modify: `eslint.config.mjs:5-16`
- Modify: `scripts/appintoss-dev.mjs:1-15`
- Modify: `scripts/appintoss-build.mjs:1-37`

**Interfaces:**
- Produces: `parseRuntimeConfig(env): CreatorXRuntimeConfig`
- Produces: npm commands `lint`, `typecheck`, `test`, `build:ait`, `verify:artifact`, and `verify`
- Consumed by: every later task and both app-in-Toss wrapper scripts

- [ ] **Step 1: Install and select the pinned Node/npm toolchain**

Run:

```powershell
nvm install 24.18.0
nvm use 24.18.0
node --version
npm --version
```

Expected: `v24.18.0` and `11.16.0`. If nvm changes npm unexpectedly, run `npm install --global npm@11.16.0` and recheck.

- [ ] **Step 2: Add exact test and artifact dependencies**

Run:

```powershell
npm install --save-dev --save-exact vitest@4.1.10 @vitest/coverage-v8@4.1.10 jsdom@29.1.1 @testing-library/react@16.3.2 @testing-library/dom@10.4.1 @testing-library/jest-dom@6.9.1 @apps-in-toss/ait-format@1.0.0
```

Expected: npm exits 0 and the lockfile records Node 24-compatible packages.

- [ ] **Step 3: Create the harness and write the failing runtime configuration tests**

```typescript
// lib/runtime/config.test.ts
import { describe, expect, it } from "vitest";
import { parseRuntimeConfig } from "@/lib/runtime/config";

describe("parseRuntimeConfig", () => {
  it("allows a sandbox demo", () => {
    expect(parseRuntimeConfig({
      NEXT_PUBLIC_APP_IN_TOSS: "1",
      NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL: "sandbox",
      NEXT_PUBLIC_CREATORX_DATA_MODE: "demo",
    }).dataMode).toBe("demo");
  });

  it.each([
    [{ NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL: "production", NEXT_PUBLIC_CREATORX_DATA_MODE: "demo" }, "remote"],
    [{ NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL: "production", NEXT_PUBLIC_CREATORX_DATA_MODE: "remote" }, "HTTPS"],
    [{ NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL: "production", NEXT_PUBLIC_CREATORX_DATA_MODE: "remote", NEXT_PUBLIC_CREATORX_API_BASE_URL: "http://localhost:3000" }, "HTTPS"],
  ])("rejects unsafe production config", (env, message) => {
    expect(() => parseRuntimeConfig(env)).toThrow(message);
  });
});
```

```typescript
// vitest.config.ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { environment: "node", setupFiles: ["./tests/setup.ts"], coverage: { reporter: ["text", "html"] } },
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- lib/runtime/config.test.ts`

Expected: FAIL because `@/lib/runtime/config` does not exist.

- [ ] **Step 5: Implement the validated runtime configuration**

```typescript
// lib/runtime/config.ts
import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_APP_IN_TOSS: z.enum(["0", "1"]).default("0"),
  NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL: z.enum(["development", "sandbox", "production"]).default("development"),
  NEXT_PUBLIC_CREATORX_DATA_MODE: z.enum(["demo", "remote"]).default("remote"),
  NEXT_PUBLIC_CREATORX_API_BASE_URL: z.string().trim().optional(),
  NEXT_PUBLIC_CREATORX_OPERATOR_NAME: z.string().trim().optional(),
  NEXT_PUBLIC_CREATORX_SUPPORT_URL: z.string().url().optional(),
  NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT: z.string().trim().optional(),
  NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE: z.string().date().optional(),
  NEXT_PUBLIC_CREATORX_ICON_URL: z.string().url().optional(),
}).superRefine((value, ctx) => {
  if (value.NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL !== "production") return;
  if (value.NEXT_PUBLIC_CREATORX_DATA_MODE !== "remote") {
    ctx.addIssue({ code: "custom", path: ["NEXT_PUBLIC_CREATORX_DATA_MODE"], message: "production requires remote data mode" });
  }
  if (!value.NEXT_PUBLIC_CREATORX_API_BASE_URL?.startsWith("https://")) {
    ctx.addIssue({ code: "custom", path: ["NEXT_PUBLIC_CREATORX_API_BASE_URL"], message: "production requires an HTTPS API URL" });
  }
  for (const key of ["NEXT_PUBLIC_CREATORX_OPERATOR_NAME", "NEXT_PUBLIC_CREATORX_SUPPORT_URL", "NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT", "NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE", "NEXT_PUBLIC_CREATORX_ICON_URL"] as const) {
    if (!value[key]) ctx.addIssue({ code: "custom", path: [key], message: key + " is required for production" });
  }
});

export type CreatorXRuntimeConfig = {
  appInToss: boolean;
  releaseChannel: "development" | "sandbox" | "production";
  dataMode: "demo" | "remote";
  apiBaseUrl: URL | null;
  allowBrowserStorageFallback: boolean;
  brandIconUrl: string | null;
  legal: { operatorName: string; supportUrl: string; privacyContact: string; effectiveDate: string };
};

export function parseRuntimeConfig(env: Record<string, string | undefined>): CreatorXRuntimeConfig {
  const value = schema.parse(env);
  return {
    appInToss: value.NEXT_PUBLIC_APP_IN_TOSS === "1",
    releaseChannel: value.NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL,
    dataMode: value.NEXT_PUBLIC_CREATORX_DATA_MODE,
    apiBaseUrl: value.NEXT_PUBLIC_CREATORX_API_BASE_URL ? new URL(value.NEXT_PUBLIC_CREATORX_API_BASE_URL) : null,
    allowBrowserStorageFallback: value.NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL !== "production",
    brandIconUrl: value.NEXT_PUBLIC_CREATORX_ICON_URL ?? null,
    legal: {
      operatorName: value.NEXT_PUBLIC_CREATORX_OPERATOR_NAME ?? "CreatorX 개발팀",
      supportUrl: value.NEXT_PUBLIC_CREATORX_SUPPORT_URL ?? "https://github.com/ohe1013/youtube-creator-investment/issues",
      privacyContact: value.NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT ?? "GitHub Issues",
      effectiveDate: value.NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE ?? "2026-07-10",
    },
  };
}
```

- [ ] **Step 6: Pin package metadata and deterministic commands**

Set `.nvmrc` and `.node-version` to `24.18.0`; set `.npmrc` to:

```ini
engine-strict=true
save-exact=true
```

Add to `package.json`:

```json
{
  "packageManager": "npm@11.16.0",
  "engines": { "node": "24.18.x", "npm": "11.16.x" },
  "scripts": {
    "lint": "eslint . --max-warnings=0",
    "typecheck": "tsc --noEmit --incremental false",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "build:ait": "ait build",
    "verify:artifact": "node scripts/verify-ait-artifact.mjs",
    "verify": "npm run lint && npm run typecheck && npm test && npm run build && npm run build:ait && npm run verify:artifact"
  }
}
```

Create a tracked `.env.example` with names only and safe sandbox defaults:

```dotenv
NEXT_PUBLIC_APP_IN_TOSS=1
NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL=sandbox
NEXT_PUBLIC_CREATORX_DATA_MODE=demo
NEXT_PUBLIC_CREATORX_API_BASE_URL=
NEXT_PUBLIC_CREATORX_OPERATOR_NAME=CreatorX 개발팀
NEXT_PUBLIC_CREATORX_SUPPORT_URL=https://github.com/ohe1013/youtube-creator-investment/issues
NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT=GitHub Issues
NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE=2026-07-10
NEXT_PUBLIC_CREATORX_ICON_URL=
```

Add `!.env.example` and `!.env.test.example` after the env ignore rules.

Use `process.execPath` plus `require.resolve("next/dist/bin/next")` in both wrapper scripts instead of `npx`. Set app-in-Toss defaults to `NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL=sandbox` and `NEXT_PUBLIC_CREATORX_DATA_MODE=demo`.

- [ ] **Step 7: Verify and commit**

Run:

```powershell
npm test -- lib/runtime/config.test.ts tests/tooling/vitest.test.ts
npm run typecheck
git diff --check
```

Expected: tests and typecheck pass.

```powershell
git add package.json package-lock.json .nvmrc .node-version .npmrc .env.example .gitignore eslint.config.mjs vitest.config.ts tests/setup.ts tests/tooling/vitest.test.ts lib/runtime/config.ts lib/runtime/config.test.ts scripts/appintoss-dev.mjs scripts/appintoss-build.mjs
git commit -m "build: pin sandbox toolchain and runtime config"
```

### Task 2: Define the typed data contracts and correct storage selection

**Files:**
- Create: `lib/data/contracts.ts`
- Create: `lib/data/errors.ts`
- Create: `lib/storage/client-storage.ts`
- Create: `lib/storage/client-storage.test.ts`
- Modify: `lib/appintoss-demo-data.ts:1-357`

**Interfaces:**
- Produces: `CreatorXDataClient`, `RequestOptions`, shared Zod DTO schemas
- Produces: `AsyncKeyValueStore` and `createClientStorage(config, bridgeLoader)`
- Consumed by: Tasks 3 through 6 and Plan 2

- [ ] **Step 1: Write failing storage and contract tests**

```typescript
// lib/storage/client-storage.test.ts
import { describe, expect, it, vi } from "vitest";
import { createClientStorage } from "@/lib/storage/client-storage";

it("does not consult browser storage when native getItem returns null", async () => {
  const browser = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
  const native = { getItem: vi.fn().mockResolvedValue(null), setItem: vi.fn(), removeItem: vi.fn() };
  const store = await createClientStorage({ releaseChannel: "sandbox", browser, loadNative: async () => native });
  expect(await store.getItem("missing")).toBeNull();
  expect(browser.getItem).not.toHaveBeenCalled();
});

it("never falls back in production", async () => {
  await expect(createClientStorage({
    releaseChannel: "production",
    browser: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
    loadNative: async () => { throw new Error("bridge missing"); },
  })).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- lib/storage/client-storage.test.ts`

Expected: FAIL because the storage module does not exist.

- [ ] **Step 3: Implement the interfaces and stable errors**

```typescript
// lib/data/contracts.ts
export type RequestOptions = { signal?: AbortSignal };
export type PlaceOrderInput = {
  creatorId: string;
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET";
  price: number;
  quantity: number;
};

export interface CreatorXDataClient {
  listCategories(options?: RequestOptions): Promise<string[]>;
  listCreators(query: CreatorQuery, options?: RequestOptions): Promise<PaginatedCreators>;
  getCreator(id: string, options?: RequestOptions): Promise<Creator>;
  getCreatorStats(id: string, query: { days: number }, options?: RequestOptions): Promise<CreatorStat[]>;
  getCreatorVideos(id: string, options?: RequestOptions): Promise<CreatorVideo[]>;
  getCreatorHistory(id: string, query: { days: number }, options?: RequestOptions): Promise<HistoryPoint[]>;
  getCreatorTrades(id: string, options?: RequestOptions): Promise<Trade[]>;
  getOrderBook(id: string, options?: RequestOptions): Promise<OrderBook>;
  getDashboard(options?: RequestOptions): Promise<Dashboard>;
  getPortfolio(options?: RequestOptions): Promise<Portfolio>;
  placeOrder(input: PlaceOrderInput, options?: RequestOptions & { idempotencyKey?: string }): Promise<Order>;
  cancelOrder(id: string, options?: RequestOptions): Promise<void>;
}
```

Define Zod schemas and inferred types for `CreatorSummary`, full `Creator`, `CreatorStat`, `CreatorVideo`, `HistoryPoint`, `Trade`, `Order`, `OrderBook`, `Portfolio`, and `Dashboard`. Keep summary and detail contracts separate so `app/api/creators/route.ts` cannot masquerade as a full creator.

```typescript
// lib/data/errors.ts
export type CreatorXErrorCode =
  | "CONFIG_INVALID" | "BRIDGE_UNAVAILABLE" | "STORAGE_UNAVAILABLE"
  | "SESSION_UNAVAILABLE" | "NETWORK_UNAVAILABLE" | "REQUEST_REJECTED"
  | "INVALID_RESPONSE" | "UNAUTHORIZED" | "NOT_FOUND"
  | "INSUFFICIENT_BALANCE" | "INSUFFICIENT_SHARES" | "ORDER_NOT_FOUND";

export class CreatorXClientError extends Error {
  constructor(
    public readonly code: CreatorXErrorCode,
    public readonly userMessage: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) { super(userMessage); }
}
```

- [ ] **Step 4: Implement one selected storage backend**

Implement `AsyncKeyValueStore { getItem; setItem; removeItem }`. If the native module loads, return its adapter even when a key is absent; if loading fails and fallback is allowed, return the browser adapter; otherwise throw `STORAGE_UNAVAILABLE`. Never mirror writes between adapters.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
npm test -- lib/storage/client-storage.test.ts
npm exec -- eslint lib/data lib/storage lib/appintoss-demo-data.ts --max-warnings=0
npm run typecheck
```

```powershell
git add lib/data/contracts.ts lib/data/errors.ts lib/storage/client-storage.ts lib/storage/client-storage.test.ts lib/appintoss-demo-data.ts
git commit -m "refactor: define creatorx data and storage contracts"
```

### Task 3: Extract the deterministic DemoDataClient

**Files:**
- Create: `lib/data/demo-client.ts`
- Create: `lib/data/demo-client.test.ts`
- Modify: `lib/appintoss-fetch.ts:8-48,113-598`

**Interfaces:**
- Consumes: `CreatorXDataClient`, `AsyncKeyValueStore`, shared DTO schemas
- Produces: `new DemoDataClient({ store, namespace, now, idFactory })`

- [ ] **Step 1: Write failing behavioral tests**

Cover deterministic ordering, namespace isolation, market buy, non-crossing limit reserve, exactly-once cancel refund, insufficient shares, invalid values, persistence across instances, and corrupt JSON surfacing a retryable error.

```typescript
it("refunds an open buy exactly once", async () => {
  const client = createDemoClient("device-a");
  const order = await client.placeOrder({ creatorId: "creator-kpop-lab", side: "BUY", orderType: "LIMIT", price: 1, quantity: 10 });
  await client.cancelOrder(order.id);
  await expect(client.cancelOrder(order.id)).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
  expect((await client.getPortfolio()).balance).toBe(100_000);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/data/demo-client.test.ts`

Expected: FAIL because `DemoDataClient` is missing.

- [ ] **Step 3: Move the existing demo behavior behind the typed methods**

Move the calculation bodies from `rankedCreators`, `getCategories`, `getCreatorsResponse`, `getCreatorResponse`, `getDashboardResponse`, `getPortfolioResponse`, `placeLocalOrder`, `cancelLocalOrder`, `getTradesForCreator`, and `getOrderBook` into `DemoDataClient` private helpers. Replace `Date.now()` IDs with injected `now` and `idFactory`. Replace Response construction with returned typed objects and `CreatorXClientError`.

```typescript
export class DemoDataClient implements CreatorXDataClient {
  constructor(private readonly deps: {
    store: AsyncKeyValueStore;
    namespace: string;
    now?: () => Date;
    idFactory?: () => string;
  }) {}

  async getPortfolio(): Promise<Portfolio> {
    return enrichPortfolio(await this.readState());
  }

  async placeOrder(input: PlaceOrderInput): Promise<Order> {
    const parsed = placeOrderInputSchema.parse(input);
    const state = await this.readState();
    const result = applyDemoOrder(state, parsed, this.deps.idFactory?.() ?? crypto.randomUUID(), (this.deps.now?.() ?? new Date()).toISOString());
    await this.writeState(result.state);
    return result.order;
  }
}
```

- [ ] **Step 4: Verify parity and commit**

Run:

```powershell
npm test -- lib/data/demo-client.test.ts
npm exec -- eslint lib/data/demo-client.ts lib/data/demo-client.test.ts --max-warnings=0
npm run typecheck
```

```powershell
git add lib/data/demo-client.ts lib/data/demo-client.test.ts lib/appintoss-fetch.ts
git commit -m "refactor: extract deterministic demo data client"
```

### Task 4: Add RemoteDataClient and the selected data provider

**Files:**
- Create: `lib/data/remote-client.ts`
- Create: `lib/data/remote-client.test.ts`
- Create: `components/runtime/CreatorXDataProvider.tsx`
- Create: `components/runtime/CreatorXDataProvider.test.tsx`

**Interfaces:**
- Consumes: runtime config, DTO schemas, `CreatorXDataClient`
- Produces: `RemoteDataClient`, `CreatorXDataProvider`, `useCreatorXDataClient()`

- [ ] **Step 1: Write failing remote-client tests**

```typescript
it("retries one transient GET but never retries an order POST", async () => {
  const fetchFn = vi.fn()
    .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
    .mockResolvedValueOnce(Response.json({ categories: ["전체"] }));
  const client = new RemoteDataClient({ baseUrl: new URL("https://api.example.com"), fetchFn, maxGetAttempts: 2 });
  await expect(client.listCategories()).resolves.toEqual(["전체"]);
  expect(fetchFn).toHaveBeenCalledTimes(2);
});
```

Also assert URL/query construction for every method, Zod `INVALID_RESPONSE`, no retry on 400/401, bounded 502/503/504 retry, bearer token, `credentials: "include"`, and forwarding `Idempotency-Key`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/data/remote-client.test.ts`

- [ ] **Step 3: Implement the client and provider**

```typescript
export class RemoteDataClient implements CreatorXDataClient {
  constructor(private readonly options: {
    baseUrl: URL;
    fetchFn?: typeof fetch;
    getAccessToken?: () => Promise<string | null>;
    maxGetAttempts?: number;
  }) {}

  async placeOrder(input: PlaceOrderInput, options: RequestOptions & { idempotencyKey?: string } = {}): Promise<Order> {
    return this.request(orderSchema, "/api/trade", {
      method: "POST",
      signal: options.signal,
      headers: options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
      body: JSON.stringify(input),
      retry: false,
    });
  }
}
```

The provider creates `DemoDataClient` only for demo mode and `RemoteDataClient` otherwise. Same-origin browser mode uses `window.location.origin`; app-in-Toss remote mode requires the configured absolute URL.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npm test -- lib/data/remote-client.test.ts components/runtime/CreatorXDataProvider.test.tsx
npm exec -- eslint lib/data/remote-client.ts components/runtime/CreatorXDataProvider.tsx --max-warnings=0
npm run typecheck
```

```powershell
git add lib/data/remote-client.ts lib/data/remote-client.test.ts components/runtime/CreatorXDataProvider.tsx components/runtime/CreatorXDataProvider.test.tsx
git commit -m "feat: add selectable creatorx data clients"
```

### Task 5: Normalize session state, migrate every caller, and make detail routing export-safe

**Files:**
- Create: `lib/session/CreatorXSessionProvider.tsx`
- Create: `lib/session/CreatorXSessionProvider.test.tsx`
- Create: `app/creator/page.tsx`
- Create: `tests/architecture/no-direct-api-fetch.test.ts`
- Modify: `app/providers.tsx:1-28`
- Modify: `components/Navbar.tsx:1-286`
- Modify: `components/market/MarketPageClient.tsx:1-256`
- Modify: `components/creator/CreatorDetailClient.tsx:1-428`
- Modify: `app/creators/page.tsx:1-258`
- Modify: `components/dashboard/DashboardClient.tsx:1-282`
- Modify: `components/portfolio/PortfolioClient.tsx:1-345`
- Modify: `components/market/OrderForm.tsx:1-254`
- Modify: `components/market/MarketDashboard.tsx:13-24,177-209`
- Modify: `app/auth/layout.tsx:1-29`
- Delete: `app/creators/[id]/page.tsx`
- Delete after the final caller migrates: `lib/appintoss-fetch.ts`

**Interfaces:**
- Produces: `CreatorXSessionValue`, `CreatorXSessionProvider`, `useCreatorXSession()`
- Consumes: selected data client and browser NextAuth only inside the browser adapter

- [ ] **Step 1: Write failing session and architecture tests**

```typescript
export interface CreatorXSessionValue {
  status: "loading" | "authenticated" | "unauthenticated" | "error";
  subject: string | null;
  identityKind: "browser" | "anonymous-device" | "guest";
  balance: number;
  error: CreatorXClientError | null;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}
```

Tests must prove: App-in-Toss demo never requests `/api/auth/session`; browser NextAuth state maps to the normalized value; anonymous identity failure renders retry; retry succeeds; Navbar balance comes from the data client; OrderForm sends the exact typed order; portfolio cancel refreshes; and source files contain no direct client-side `fetch("/api` calls.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npm test -- lib/session/CreatorXSessionProvider.test.tsx tests/architecture/no-direct-api-fetch.test.ts
```

- [ ] **Step 3: Implement the normalized providers**

```tsx
// app/providers.tsx composition
<ThemeProvider attribute="class" forcedTheme={config.appInToss ? "light" : undefined}>
  <LanguageProvider>
    <CreatorXDataProvider config={config}>
      <CreatorXSessionProvider config={config}>
        <AppInTossRuntime />
        {children}
      </CreatorXSessionProvider>
    </CreatorXDataProvider>
  </LanguageProvider>
</ThemeProvider>
```

The browser branch alone mounts `next-auth`'s `SessionProvider`. The demo branch resolves the anonymous subject and portfolio through the typed boundaries. Replace `useSession`, `signOut`, and raw fetch usage in all listed callers with `useCreatorXSession` and `useCreatorXDataClient`.

- [ ] **Step 4: Remove dead endpoints/callbacks and fix response typing**

Remove `MarketDashboard` callbacks for nonexistent `/api/trade/buy` and `/api/trade/sell`. Remove unused `onBuy`/`onSell` props from OrderForm. Widen `app/api/creators/route.ts` to the shared `CreatorSummary` contract containing the exact market fields: identity/name/thumbnail/category/country, subscriber/view/video/score values, initial/current price, supply/liquidity, active/visibility, engagement metrics, timestamps, and video count. Do not cast summaries to `AppInTossCreator`.

- [ ] **Step 5: Replace dynamic creator detail with one exported route**

```tsx
// app/creator/page.tsx
"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CreatorDetailClient } from "@/components/creator/CreatorDetailClient";

function CreatorRoute() {
  const id = useSearchParams().get("id");
  return id ? <CreatorDetailClient id={id} /> : <p role="alert">크리에이터를 선택해 주세요.</p>;
}

export default function CreatorPage() {
  return <Suspense fallback={<p>불러오는 중...</p>}><CreatorRoute /></Suspense>;
}
```

Update every detail link to `/creator?id=<encoded id>`. This permits remote creator IDs in a static app-in-Toss export.

- [ ] **Step 6: Delete the fetch shim and verify**

Run:

```powershell
npm test -- lib/session/CreatorXSessionProvider.test.tsx tests/architecture/no-direct-api-fetch.test.ts components/market/OrderForm.test.tsx components/portfolio/PortfolioClient.test.tsx
rg -n 'window\.fetch\s*=|installAppInTossFetch|fetch\("/api' app components lib -g '*.ts' -g '*.tsx'
npm run typecheck
```

Expected: grep finds no global fetch replacement or direct client API fetch. Server-side YouTube fetches and `RemoteDataClient` remain.

```powershell
git add app components lib tests
git commit -m "refactor: route ui through typed data and session providers"
```

### Task 6: Implement observable bridge, safe-area, keyboard, and external-link behavior

**Files:**
- Create: `lib/appintoss/bridge.ts`
- Create: `components/runtime/RuntimeIssueBanner.tsx`
- Create: `components/runtime/ExternalLink.tsx`
- Create: `components/runtime/AppInTossRuntime.test.tsx`
- Modify: `components/AppInTossRuntime.tsx:1-55`
- Modify: `app/globals.css:3-76`
- Modify: `components/market/CreatorInfo.tsx:253-257`
- Modify: `components/market/MarketPageClient.tsx:202-240`
- Modify: `components/dashboard/DashboardClient.tsx:33-41`
- Modify: `components/creator/CreatorDetailClient.tsx:172-233,292`
- Modify: `components/market/OrderForm.tsx:137-166`

**Interfaces:**
- Produces: injectable `CreatorXBridge`, runtime status, CSS variables, and `ExternalLink`
- SDK calls: `graniteEvent`, `closeView`, `openURL`, `SafeAreaInsets.get()/subscribe()`

- [ ] **Step 1: Write failing native lifecycle tests**

Test root back closes, non-root back navigates history, all subscriptions clean up, safe-area values update four CSS variables, `visualViewport.resize` updates keyboard/viewport variables, `openURL` handles HTTPS only, and rejected bridge calls render retry UI.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- components/runtime/AppInTossRuntime.test.tsx`

- [ ] **Step 3: Implement the injected bridge boundary**

```typescript
export interface CreatorXBridge {
  getAnonymousSubject(): Promise<string>;
  getSafeAreaInsets(): { top: number; right: number; bottom: number; left: number };
  subscribeSafeArea(onChange: (value: { top: number; right: number; bottom: number; left: number }) => void): () => void;
  subscribeBack(onBack: () => void, onError: (error: Error) => void): () => void;
  close(): Promise<void>;
  openExternal(url: string): Promise<void>;
}
```

The SDK implementation dynamically imports `@apps-in-toss/web-framework`. Validate external URLs with `new URL(url)` and allow only `https:`. Browser mode renders a normal anchor.

- [ ] **Step 4: Implement safe viewport CSS**

```css
:root {
  --creatorx-safe-top: 0px;
  --creatorx-safe-right: 0px;
  --creatorx-safe-bottom: 0px;
  --creatorx-safe-left: 0px;
  --creatorx-viewport-height: 100dvh;
  --creatorx-keyboard-height: 0px;
}
.creatorx-screen { min-height: var(--creatorx-viewport-height); }
.creatorx-safe-top { padding-top: var(--creatorx-safe-top); }
.creatorx-safe-bottom { padding-bottom: max(var(--creatorx-safe-bottom), 12px); }
```

Replace raw `100vh` calculations with `100dvh` or `--creatorx-viewport-height`. Scroll the focused order input into view when the visual viewport shrinks.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
npm test -- components/runtime/AppInTossRuntime.test.tsx
npm exec -- eslint components/AppInTossRuntime.tsx components/runtime lib/appintoss app/globals.css --max-warnings=0
npm run typecheck
```

```powershell
git add lib/appintoss components/runtime components/AppInTossRuntime.tsx components/market/CreatorInfo.tsx components/market/MarketPageClient.tsx components/dashboard/DashboardClient.tsx components/creator/CreatorDetailClient.tsx components/market/OrderForm.tsx app/globals.css
git commit -m "feat: harden apps-in-toss mobile runtime"
```

### Task 7: Add CreatorX brand, legal routes, and release-safe copy

**Files:**
- Create: `components/legal/LegalPage.tsx`
- Create: `app/terms/page.tsx`
- Create: `app/privacy/page.tsx`
- Create: `app/support/page.tsx`
- Create: `app/legal-routes.test.tsx`
- Create: `public/brand/creatorx-icon.svg`
- Create: reviewed PNGs `public/brand/creatorx-icon-{32,180,192,512,1024}.png`
- Create: `scripts/generate-brand-assets.mjs`
- Modify: `app/auth/signin/page.tsx:71-87`
- Modify: `app/layout.tsx:9-19`
- Modify: `components/Navbar.tsx:76-284`
- Modify: `app/dashboard/page.tsx:3-6`
- Modify: `components/dashboard/DashboardClient.tsx:265-275`
- Modify: `app/creators/page.tsx:101-106`
- Modify: `lib/locales.ts:62-64,161-163`
- Modify: `granite.config.ts:3-25`

**Interfaces:**
- Consumes: validated legal/runtime config and owned SVG source
- Produces: legal routes, reviewed raster sizes, and non-Toss Granite brand icon

- [ ] **Step 1: Write failing legal and asset tests**

Assert all three routes exist; terms and UI state that points/trades have no cash value; privacy lists pseudonymous identity, session data, trade history, retention, deletion, and contact; sign-in links resolve; raster dimensions are exact; and no asset matches the Toss logo URL.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- app/legal-routes.test.tsx`

- [ ] **Step 3: Add owned assets and legal pages**

Install the pinned rasterizer:

```powershell
npm install --save-dev --save-exact sharp@0.34.3
```

Use this SVG source concept and render reviewed PNG sizes without altering aspect ratio:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#2563EB"/>
  <path d="M112 144h288v64H288v160h-64V208H112z" fill="#fff"/>
  <path d="M324 256l76 112h-76l-38-58-38 58h-76l76-112-72-112h76l34 56 34-56h76z" fill="#F8FAFC" opacity=".92"/>
</svg>
```

```javascript
// scripts/generate-brand-assets.mjs
import { readFile } from "node:fs/promises";
import sharp from "sharp";

const source = await readFile("public/brand/creatorx-icon.svg");
for (const size of [32, 180, 192, 512, 1024]) {
  await sharp(source).resize(size, size).png().toFile(`public/brand/creatorx-icon-${size}.png`);
}
```

Run `node scripts/generate-brand-assets.mjs`; inspect the 512px and 1024px images before committing.

The legal pages read the validated legal config. Sandbox support points to the repository issue tracker. Production validation from Task 1 prevents default operator values.

- [ ] **Step 4: Replace review-risk copy and configure the icon**

Replace placeholder `href="#"` with `/terms` and `/privacy`. Replace language implying cash or real investment with “가상 포인트 기반 크리에이터 성장 예측 게임”. Set Granite brand icon to the owned 512px asset URL supplied by `NEXT_PUBLIC_CREATORX_ICON_URL`; allow a data URI generated from the local PNG only for Sandbox. Keep `permissions: []`.

- [ ] **Step 5: Verify and commit**

```powershell
npm test -- app/legal-routes.test.tsx
npm exec -- eslint app/terms app/privacy app/support app/auth/signin components/legal components/Navbar.tsx --max-warnings=0
npm run typecheck
git add app components/legal components/Navbar.tsx lib/locales.ts public/brand granite.config.ts
git commit -m "feat: add creatorx release identity and legal pages"
```

### Task 8: Make the entire repository lint-clean without suppressions

**Files:**
- Modify server group: `app/api/creators/[id]/route.ts`, `app/api/creators/route.ts`, `app/api/dashboard/route.ts`, `app/api/internal/cron/update-stats/route.ts`, `app/api/orders/[id]/route.ts`, `app/api/portfolio/route.ts`, `app/api/rankings/route.ts`, `app/api/trade/route.ts`, `lib/auth.ts`, `lib/youtube.ts`, `prisma/seed.ts`, `scripts/refresh-all-stats.ts`
- Modify client group: `app/creators/page.tsx`, `components/dashboard/DashboardClient.tsx`, `components/market/CreatorInfo.tsx`, `MarketChart.tsx`, `MarketDashboard.tsx`, `MarketHeader.tsx`, `MarketList.tsx`, `OrderBook.tsx`, `OrderForm.tsx`, `components/portfolio/PortfolioClient.tsx`
- Modify core/scripts: `lib/bot-manager.ts`, `lib/candle-utils.ts`, `lib/creatorDisplay.ts`, `lib/LanguageContext.tsx`, `lib/matching-engine.ts`, `scripts/check-prisma.js`, `scripts/debug-orders.js`, `scripts/inspect-creators.js`, `scripts/test-market-logic.ts`, `types/next-auth.d.ts`

**Interfaces:**
- Consumes: shared DTOs, strict NextAuth augmentation, and existing behavior tests
- Produces: repository-wide ESLint zero-error/zero-warning baseline without rule suppression

- [ ] **Step 1: Capture the failing lint inventory**

Run: `npm run lint`

Expected baseline: 66 errors and 47 warnings across 33 files.

- [ ] **Step 2: Fix server types**

Use Zod `safeParse`, `unknown` catch values, Prisma generated input/output types, and the complete NextAuth augmentation below. Remove duplicate trade schema and import one contract.

```typescript
declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & { id: string; balance: number; role: "USER" | "ADMIN" };
  }
}
```

Run: `npm exec -- eslint app/api lib/auth.ts lib/youtube.ts prisma/seed.ts scripts/refresh-all-stats.ts --max-warnings=0`

- [ ] **Step 3: Fix client/chart types and hook rules**

Replace every `any` with the DTOs from Task 2, remove dead props/imports, use lazy initial state instead of synchronous set-state effects, and make effect callbacks stable with `useCallback` only when a real dependency exists. Replace `img` with `next/image` using explicit dimensions, alt text, and `unoptimized` only for external YouTube images.

Run: `npm exec -- eslint app/creators components --max-warnings=0`

- [ ] **Step 4: Fix scripts and declarations**

Convert the three CommonJS scripts to ESM imports and rename them to `.mjs`; remove unused values; use `const`; make `LanguageContext` storage access lazy and typed. Do not add eslint-disable comments.

Run: `npm exec -- eslint lib scripts types --max-warnings=0`

- [ ] **Step 5: Run the full gate and commit**

```powershell
npm run lint
npm run typecheck
npm test
```

Expected: zero errors, zero warnings, and all tests pass.

```powershell
git add app components lib prisma scripts types
git commit -m "refactor: make creatorx quality gates strict"
```

### Task 9: Add AIT artifact verification and Android device automation

**Files:**
- Create: `scripts/verify-ait-artifact.mjs`
- Create: `tests/scripts/verify-ait-artifact.test.ts`
- Create: `scripts/android/platform-tools.json`
- Create: `scripts/android/CreatorX.Android.psm1`
- Create: `scripts/android/install-platform-tools.ps1`
- Create: `scripts/android/doctor.ps1`
- Create: `scripts/android/reverse.ps1`
- Create: `scripts/android/dev.ps1`
- Create: `scripts/android/logcat.ps1`
- Create: `scripts/android/screenshot.ps1`
- Create: `scripts/android/tests/CreatorX.Android.Tests.ps1`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `verify:artifact` JSON result and Android commands with stable exit/result codes
- Consumes: Node 24, AIT format v1, PowerShell 5.1, and project-local adb

- [ ] **Step 1: Write failing artifact and ADB parser tests**

```javascript
// scripts/verify-ait-artifact.mjs core
const entries = reader.listEntries().map((entry) => entry.replaceAll("\\", "/"));
const uncompressedBytes = reader.bundle.index.reduce(
  (sum, entry) => sum + Number(entry.uncompressedSize),
  0,
);
assert.equal(reader.appName, "creatorx");
assert(entries.includes("web/index.html"));
assert(uncompressedBytes < 100 * 1024 * 1024);
```

PowerShell tests cover zero devices, one authorized device, unauthorized, offline, multiple devices, requested serial, and missing reverse rules.

- [ ] **Step 2: Run tests to verify they fail**

```powershell
npm test -- tests/scripts/verify-ait-artifact.test.ts
Install-Module Pester -RequiredVersion 5.7.1 -Repository PSGallery -Scope CurrentUser -Force -AllowClobber
powershell -NoProfile -Command "Invoke-Pester scripts/android/tests/CreatorX.Android.Tests.ps1"
```

Expected: missing verifier/module failures; Pester is exactly 5.7.1 from PSGallery.

- [ ] **Step 3: Implement the artifact reader**

Read `creatorx.ait` with `AITReader.fromBuffer`, normalize path separators, assert format v1, app name, `web/index.html`, permissions, and total uncompressed size. Emit JSON containing file bytes, uncompressed bytes, entry count, appName, and deploymentId.

- [ ] **Step 4: Implement a pinned Platform Tools installer**

```json
{
  "revision": "37.0.1",
  "uri": "https://dl.google.com/android/repository/platform-tools_r37.0.1-win.zip",
  "size": 8044994,
  "sha1": "10f2ef5325bc5705d48d38a0aa900c7babda24fa"
}
```

Require an explicit `-AcceptLicense` flag, verify length/SHA1 and `source.properties`, extract atomically, and install only under `.tools/android/platform-tools`.

- [ ] **Step 5: Implement stable doctor and reverse contracts**

```powershell
ConvertFrom-CreatorXAdbDevicesOutput -Lines $Lines
Resolve-CreatorXDevice -Devices $Devices -RequestedSerial $Serial
Test-CreatorXReverseRules -Lines $Lines -Ports @(8081, 5173, 3000)
Invoke-CreatorXAdb -AdbPath $AdbPath -Serial $Serial -Arguments $Arguments
```

Doctor syntax is `doctor.ps1 [-Mode Preflight|Running] [-RequireArtifacts] [-Serial <serial>]`. Emit `[PASS|WARN|FAIL|BLOCKED] CODE message`; exit 1 on FAIL, 2 on BLOCKED, otherwise 0. Codes include `NODE_VERSION_MISMATCH`, `ADB_MISSING`, `DEVICE_MISSING`, `DEVICE_UNAUTHORIZED`, `DEVICE_OFFLINE`, `DEVICE_MULTIPLE`, `PORT_IN_USE`, `GRANITE_CONFIG_INVALID`, `ARTIFACT_MISSING`, `REVERSE_MISSING`, and `TOSS_CONSOLE_REGISTRATION_UNCONFIRMED`.

- [ ] **Step 6: Implement dev and evidence commands**

Reverse 8081, 5173, and 3000, assert `adb reverse --list`, print `intoss://creatorx`, then run `granite dev --host 0.0.0.0 --port 8081`. Capture logcat to text. Capture screenshots with device `screencap` plus `adb pull`, never PowerShell binary redirection.

- [ ] **Step 7: Add package commands and verify**

Add `sandbox:android:install-tools`, `sandbox:android:doctor`, `sandbox:android:reverse`, `sandbox:android:dev`, `sandbox:android:logcat`, and `sandbox:android:screenshot`.

Run:

```powershell
npm run build:ait
npm run verify:artifact
npm run sandbox:android:install-tools -- -AcceptLicense
npm run sandbox:android:doctor
```

Expected on the current machine: artifact passes; tool installation passes; doctor reports the absent/unauthorized physical device and the unrelated port 5173 conflict distinctly.

```powershell
git add package.json package-lock.json .gitignore scripts/verify-ait-artifact.mjs tests/scripts/verify-ait-artifact.test.ts scripts/android
git commit -m "feat: automate android sandbox diagnostics"
```

### Task 10: Document console registration, run the full gate, and perform the device smoke test

**Files:**
- Create: `docs/apps-in-toss-sandbox.md`
- Modify: `README.md:21-75`

**Interfaces:**
- Consumes: all Plan 1 npm/Android commands and stable doctor codes
- Produces: operator runbook and fresh local/device verification evidence

- [ ] **Step 1: Write the exact operator runbook**

Document console display name `크리에이터X`, immutable `creatorx`, game type, no permissions, same Toss Business account in Sandbox, USB authorization, `intoss://creatorx`, doctor codes, evidence paths, and the official registration/Sandbox URLs.

- [ ] **Step 2: Run all automated gates**

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

Expected: all commands exit 0; artifact reports `creatorx`, `web/index.html`, and less than 104,857,600 uncompressed bytes.

- [ ] **Step 3: Clear or obtain approval for the Android prerequisites**

If port 5173 is still owned by PID 6060, report the command line and ask before stopping it. Ask the user to create the Toss Business account/workspace/`creatorx`, connect the Android phone, enable USB debugging, and approve the fingerprint. Do not mark Plan 1 complete while doctor exits 1 or 2.

- [ ] **Step 4: Run the physical-device smoke session**

```powershell
npm run sandbox:android:doctor
npm run sandbox:android:reverse
npm run sandbox:android:logcat
npm run sandbox:android:dev
```

In Sandbox open `intoss://creatorx`; verify home, creator detail, order, portfolio, back navigation, root close, and persistence after restart. Capture screenshots and stop logcat.

- [ ] **Step 5: Inspect device evidence**

Search the session log for `FATAL EXCEPTION`, Chromium renderer crashes, unhandled bridge rejection, or WebView load failure. Any hit triggers systematic debugging and a full rerun.

- [ ] **Step 6: Commit the runbook and Plan 1 evidence references**

```powershell
git add README.md docs/apps-in-toss-sandbox.md
git commit -m "docs: add android apps-in-toss sandbox runbook"
```

Plan 1 is complete only after the physical Sandbox smoke test passes. If Toss registration or device authorization remains outstanding, report that external gate and resume from Step 3 after the user completes it.
