import { creatorQuerySchema, placeOrderInputSchema } from "@/lib/data/contracts";
import { DemoDataClient } from "@/lib/data/demo-client";
import { CreatorXClientError } from "@/lib/data/errors";
import { parseRuntimeConfig } from "@/lib/runtime/config";
import {
  createClientStorage,
  type AsyncKeyValueStore,
  type KeyValueStorageBackend,
} from "@/lib/storage/client-storage";

const APP_IN_TOSS_MODE = process.env.NEXT_PUBLIC_APP_IN_TOSS === "1";
const DEMO_DATA_MODE = process.env.NEXT_PUBLIC_CREATORX_DATA_MODE === "demo";
const STORAGE_USER_KEY = "creatorx:appintoss:user-key";
const BROWSER_DEMO_NAMESPACE = "browser-demo-user";

type DemoBootstrap = {
  client: DemoDataClient;
  namespace: string;
};

declare global {
  interface Window {
    __creatorXAppInTossFetchInstalled?: boolean;
  }
}

let demoBootstrapPromise: Promise<DemoBootstrap> | null = null;

export function isAppInTossMode() {
  return APP_IN_TOSS_MODE;
}

export function installAppInTossFetch() {
  if (!APP_IN_TOSS_MODE || !DEMO_DATA_MODE || typeof window === "undefined") {
    return;
  }
  if (window.__creatorXAppInTossFetchInstalled) return;

  const originalFetch = window.fetch.bind(window);
  window.__creatorXAppInTossFetchInstalled = true;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = getRequestUrl(input);
    const method = getRequestMethod(input, init);

    if (
      !requestUrl ||
      requestUrl.origin !== window.location.origin ||
      !requestUrl.pathname.startsWith("/api/")
    ) {
      return originalFetch(input, init);
    }

    try {
      return await handleAppInTossApi(requestUrl, method, input, init);
    } catch (error) {
      return clientErrorResponse(error);
    }
  };
}

function getRequestUrl(input: RequestInfo | URL) {
  if (typeof window === "undefined") return null;
  if (typeof input === "string") return new URL(input, window.location.origin);
  if (input instanceof URL) return input;
  return new URL(input.url, window.location.origin);
}

function getRequestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input !== "string" && !(input instanceof URL) && input.method) {
    return input.method.toUpperCase();
  }
  return "GET";
}

async function handleAppInTossApi(
  url: URL,
  method: string,
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const { client, namespace } = await getDemoBootstrap();

  if (url.pathname === "/api/auth/session" && method === "GET") {
    const portfolio = await client.getPortfolio({ signal: init?.signal ?? undefined });
    return jsonResponse({
      user: { id: namespace, balance: portfolio.balance, role: "USER" },
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  if (url.pathname === "/api/categories" && method === "GET") {
    return jsonResponse({ categories: await client.listCategories() });
  }

  if (url.pathname === "/api/creators" && method === "GET") {
    const query = creatorQuerySchema.parse(readCreatorQuery(url.searchParams));
    return jsonResponse(await client.listCreators(query));
  }

  if (url.pathname === "/api/dashboard" && method === "GET") {
    return jsonResponse(await client.getDashboard());
  }

  if (url.pathname === "/api/portfolio" && method === "GET") {
    return jsonResponse(await client.getPortfolio());
  }

  if (url.pathname === "/api/trade" && method === "POST") {
    const orderInput = placeOrderInputSchema.parse(
      await readJsonBody(input, init),
    );
    return jsonResponse({ order: await client.placeOrder(orderInput) });
  }

  const orderMatch = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (orderMatch && method === "DELETE") {
    await client.cancelOrder(decodeURIComponent(orderMatch[1]));
    return jsonResponse({ ok: true });
  }

  const creatorMatch = url.pathname.match(/^\/api\/creators\/([^/]+)$/);
  if (creatorMatch && method === "GET") {
    return jsonResponse(
      await getCreatorResponse(
        client,
        decodeURIComponent(creatorMatch[1]),
        url.searchParams,
      ),
    );
  }

  if (url.pathname === "/api/rankings" && method === "GET") {
    const result = await client.listCreators({
      sort: "score",
      page: 1,
      limit: 20,
    });
    return jsonResponse({ rankings: result.creators });
  }

  return jsonResponse({ error: "Not found" }, { status: 404 });
}

async function getCreatorResponse(
  client: DemoDataClient,
  id: string,
  searchParams: URLSearchParams,
) {
  if (searchParams.get("orderbook") === "true") {
    return await client.getOrderBook(id);
  }
  if (searchParams.get("history") === "true") {
    return {
      history: await client.getCreatorHistory(id, {
        days: readDays(searchParams, 7),
      }),
    };
  }
  if (searchParams.get("trades") === "true") {
    return { trades: await client.getCreatorTrades(id) };
  }
  if (searchParams.get("stats") === "true") {
    return {
      stats: await client.getCreatorStats(id, {
        days: readDays(searchParams, 30),
      }),
    };
  }
  if (searchParams.get("videos") === "true") {
    return { videos: await client.getCreatorVideos(id) };
  }
  return { creator: await client.getCreator(id) };
}

function readCreatorQuery(searchParams: URLSearchParams) {
  const query: Record<string, string | number> = {};
  const category = searchParams.get("category");
  const sort = searchParams.get("sort");
  if (category) query.category = category;
  if (sort) query.sort = sort;

  for (const key of ["minSubs", "maxSubs", "page", "limit"] as const) {
    const raw = searchParams.get(key);
    if (raw !== null && raw !== "" && !(key === "maxSubs" && raw === "0")) {
      query[key] = Number(raw);
    }
  }
  return query;
}

function readDays(searchParams: URLSearchParams, fallback: number) {
  const raw = searchParams.get("days");
  return raw === null || raw === "" ? fallback : Number(raw);
}

async function readJsonBody(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.body) {
    return typeof init.body === "string"
      ? JSON.parse(init.body)
      : JSON.parse(String(init.body));
  }
  if (typeof input !== "string" && !(input instanceof URL)) {
    return await input.clone().json();
  }
  return {};
}

function getDemoBootstrap(): Promise<DemoBootstrap> {
  demoBootstrapPromise ??= createDemoBootstrap().catch((error: unknown) => {
    demoBootstrapPromise = null;
    throw error;
  });
  return demoBootstrapPromise;
}

async function createDemoBootstrap(): Promise<DemoBootstrap> {
  const runtimeConfig = parseRuntimeConfig({
    NEXT_PUBLIC_APP_IN_TOSS: process.env.NEXT_PUBLIC_APP_IN_TOSS,
    NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL:
      process.env.NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL,
    NEXT_PUBLIC_CREATORX_DATA_MODE:
      process.env.NEXT_PUBLIC_CREATORX_DATA_MODE,
    NEXT_PUBLIC_CREATORX_API_BASE_URL:
      process.env.NEXT_PUBLIC_CREATORX_API_BASE_URL,
    NEXT_PUBLIC_CREATORX_OPERATOR_NAME:
      process.env.NEXT_PUBLIC_CREATORX_OPERATOR_NAME,
    NEXT_PUBLIC_CREATORX_SUPPORT_URL:
      process.env.NEXT_PUBLIC_CREATORX_SUPPORT_URL,
    NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT:
      process.env.NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT,
    NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE:
      process.env.NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE,
    NEXT_PUBLIC_CREATORX_ICON_URL: process.env.NEXT_PUBLIC_CREATORX_ICON_URL,
  });
  const store = await createClientStorage({
    releaseChannel: runtimeConfig.releaseChannel,
    browser: getBrowserStorage(),
    loadNative: async () => {
      const sdk = await import("@apps-in-toss/web-framework");
      sdk.getAppsInTossGlobals();
      return {
        getItem: (key) => sdk.Storage.getItem(key),
        setItem: (key, value) => sdk.Storage.setItem(key, value),
        removeItem: (key) => sdk.Storage.removeItem(key),
      };
    },
  });
  const namespace = await resolveNamespace(
    store,
    runtimeConfig.releaseChannel,
  );
  return {
    client: new DemoDataClient({ store, namespace }),
    namespace,
  };
}

function getBrowserStorage(): KeyValueStorageBackend {
  return {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: (key) => window.localStorage.removeItem(key),
  };
}

async function resolveNamespace(
  store: AsyncKeyValueStore,
  releaseChannel: "development" | "sandbox" | "production",
) {
  const stored = await readStoredValue(store, STORAGE_USER_KEY);
  if (stored?.trim()) return stored;

  let anonymousHash: string | null = null;
  try {
    const { getAnonymousKey } = await import("@apps-in-toss/web-framework");
    const result = await getAnonymousKey();
    if (result && result !== "ERROR" && result.hash.trim()) {
      anonymousHash = result.hash;
    }
  } catch {
    // A nonproduction browser preview uses the explicit demo namespace below.
  }

  if (anonymousHash) {
    await writeStoredValue(store, STORAGE_USER_KEY, anonymousHash);
    return anonymousHash;
  }

  if (releaseChannel === "production") {
    throw new CreatorXClientError(
      "SESSION_UNAVAILABLE",
      "사용자 세션을 확인할 수 없습니다.",
      true,
    );
  }
  await writeStoredValue(store, STORAGE_USER_KEY, BROWSER_DEMO_NAMESPACE);
  return BROWSER_DEMO_NAMESPACE;
}

async function readStoredValue(store: AsyncKeyValueStore, key: string) {
  try {
    return await store.getItem(key);
  } catch {
    throw new CreatorXClientError(
      "STORAGE_UNAVAILABLE",
      "저장소를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      true,
    );
  }
}

async function writeStoredValue(
  store: AsyncKeyValueStore,
  key: string,
  value: string,
) {
  try {
    await store.setItem(key, value);
  } catch {
    throw new CreatorXClientError(
      "STORAGE_UNAVAILABLE",
      "저장소를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      true,
    );
  }
}

function clientErrorResponse(error: unknown) {
  if (error instanceof CreatorXClientError) {
    return jsonResponse(
      {
        error: error.userMessage,
        code: error.code,
        retryable: error.retryable,
      },
      { status: error.status ?? (error.retryable ? 503 : 400) },
    );
  }

  if (
    error instanceof SyntaxError ||
    (error instanceof Error && error.name === "ZodError")
  ) {
    return jsonResponse(
      { error: "요청 값이 올바르지 않습니다.", code: "REQUEST_REJECTED" },
      { status: 400 },
    );
  }

  return jsonResponse(
    { error: "App in Toss API error", code: "INVALID_RESPONSE" },
    { status: 500 },
  );
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}
