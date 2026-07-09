import { appInTossDemoData, type AppInTossCreator } from "@/lib/appintoss-demo-data";

const APP_IN_TOSS_MODE = process.env.NEXT_PUBLIC_APP_IN_TOSS === "1";
const STORAGE_USER_KEY = "creatorx:appintoss:user-key";
const STORAGE_STATE_PREFIX = "creatorx:appintoss:state:";
const INITIAL_BALANCE = 100_000;

type LocalPosition = {
  id: string;
  creatorId: string;
  quantity: number;
  avgPrice: number;
};

type LocalOrder = {
  id: string;
  creatorId: string;
  type: "BUY" | "SELL";
  price: number;
  quantity: number;
  filled: number;
  status: "OPEN" | "PARTIAL" | "FILLED" | "CANCELLED";
  createdAt: string;
};

type LocalTrade = {
  id: string;
  creatorId: string;
  userId: string;
  price: number;
  quantity: number;
  type: "BUY" | "SELL";
  createdAt: string;
};

type LocalState = {
  balance: number;
  positions: LocalPosition[];
  openOrders: LocalOrder[];
  trades: LocalTrade[];
};
type TradeRequest = {
  creatorId?: unknown;
  side?: unknown;
  orderType?: unknown;
  price?: unknown;
  quantity?: unknown;
};


declare global {
  interface Window {
    __creatorXAppInTossFetchInstalled?: boolean;
  }
}

export function isAppInTossMode() {
  return APP_IN_TOSS_MODE;
}

export function installAppInTossFetch() {
  if (!APP_IN_TOSS_MODE || typeof window === "undefined") return;
  if (window.__creatorXAppInTossFetchInstalled) return;

  const originalFetch = window.fetch.bind(window);
  window.__creatorXAppInTossFetchInstalled = true;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = getRequestUrl(input);
    const method = getRequestMethod(input, init);

    if (!requestUrl || requestUrl.origin !== window.location.origin) {
      return originalFetch(input, init);
    }

    if (!requestUrl.pathname.startsWith("/api/")) {
      return originalFetch(input, init);
    }

    try {
      return await handleAppInTossApi(requestUrl, method, input, init);
    } catch (error) {
      return jsonResponse(
        { error: error instanceof Error ? error.message : "App in Toss API error" },
        { status: 400 }
      );
    }
  };
}

function getRequestUrl(input: RequestInfo | URL) {
  if (typeof window === "undefined") return null;

  if (typeof input === "string") {
    return new URL(input, window.location.origin);
  }

  if (input instanceof URL) {
    return input;
  }

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
  init?: RequestInit
) {
  if (url.pathname === "/api/auth/session") {
    const state = await readState();

    return jsonResponse({
      user: { id: await getUserKey(), balance: state.balance, role: "USER" },
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  if (url.pathname === "/api/categories" && method === "GET") {
    return jsonResponse({ categories: getCategories() });
  }

  if (url.pathname === "/api/creators" && method === "GET") {
    return jsonResponse(getCreatorsResponse(url.searchParams));
  }

  if (url.pathname === "/api/dashboard" && method === "GET") {
    return jsonResponse(await getDashboardResponse());
  }

  if (url.pathname === "/api/portfolio" && method === "GET") {
    return jsonResponse(await getPortfolioResponse());
  }

  if (url.pathname === "/api/trade" && method === "POST") {
    return jsonResponse(await placeLocalOrder(await readJsonBody(input, init)));
  }

  const orderMatch = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (orderMatch && method === "DELETE") {
    return jsonResponse(await cancelLocalOrder(decodeURIComponent(orderMatch[1])));
  }

  const creatorMatch = url.pathname.match(/^\/api\/creators\/([^/]+)$/);
  if (creatorMatch && method === "GET") {
    return jsonResponse(await getCreatorResponse(decodeURIComponent(creatorMatch[1]), url.searchParams));
  }

  if (url.pathname === "/api/rankings" && method === "GET") {
    return jsonResponse({ rankings: rankedCreators().slice(0, 20) });
  }

  return jsonResponse({ error: "Not found" }, { status: 404 });
}

async function readJsonBody(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.body) {
    return typeof init.body === "string" ? JSON.parse(init.body) : JSON.parse(String(init.body));
  }

  if (typeof input !== "string" && !(input instanceof URL)) {
    return input.clone().json();
  }

  return {};
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
}

function rankedCreators() {
  return [...appInTossDemoData.creators].sort(
    (a, b) => b.currentScore - a.currentScore
  );
}

function getCategories() {
  return [
    "전체",
    ...Array.from(new Set(appInTossDemoData.creators.map((creator) => creator.category))).sort(),
  ];
}

function getCreatorsResponse(searchParams: URLSearchParams) {
  const category = searchParams.get("category");
  const minSubs = Number(searchParams.get("minSubs") || 0);
  const maxSubs = Number(searchParams.get("maxSubs") || 0);
  const sort = searchParams.get("sort") || "score";
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const limit = Math.max(1, Number(searchParams.get("limit") || 20));

  let creators = appInTossDemoData.creators.filter(
    (creator) => creator.isActive && creator.visibility === "PUBLIC"
  );

  if (category && category !== "전체") {
    creators = creators.filter((creator) => creator.category === category);
  }

  if (minSubs > 0) {
    creators = creators.filter((creator) => creator.currentSubs >= minSubs);
  }

  if (maxSubs > 0) {
    creators = creators.filter((creator) => creator.currentSubs <= maxSubs);
  }

  creators = creators.sort((a, b) => {
    switch (sort) {
      case "subs":
        return b.currentSubs - a.currentSubs;
      case "price":
        return b.currentPrice - a.currentPrice;
      case "growth":
      case "score":
      default:
        return b.currentScore - a.currentScore;
    }
  });

  const total = creators.length;
  const start = (page - 1) * limit;

  return {
    creators: creators.slice(start, start + limit),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function getCreatorResponse(id: string, searchParams: URLSearchParams) {
  const creator = getCreator(id);
  if (!creator) {
    return { error: "Creator not found" };
  }

  if (searchParams.get("orderbook") === "true") {
    return getOrderBook(id, await readState());
  }

  if (searchParams.get("history") === "true") {
    const history = getTradesForCreator(id, await readState())
      .slice()
      .reverse()
      .map((trade) => ({
        date: trade.createdAt,
        price: trade.price,
        volume: trade.quantity * trade.price,
      }));

    return {
      history:
        history.length > 0
          ? history
          : [{ date: appInTossDemoData.generatedAt, price: creator.currentPrice, volume: 0 }],
    };
  }

  if (searchParams.get("trades") === "true") {
    return { trades: getTradesForCreator(id, await readState()) };
  }

  if (searchParams.get("stats") === "true") {
    return { stats: appInTossDemoData.stats[id] || [] };
  }

  if (searchParams.get("videos") === "true") {
    return { videos: appInTossDemoData.videos[id] || [] };
  }

  return { creator };
}

async function getDashboardResponse() {
  const state = await readState();
  const creators = rankedCreators();
  const totalMarketCap = creators.reduce(
    (sum, creator) => sum + creator.currentPrice * creator.circulatingSupply,
    0
  );
  const totalVolume24h = Object.values(appInTossDemoData.trades)
    .flat()
    .reduce((sum, trade) => sum + trade.price * trade.quantity, 0);
  const positions = enrichPositions(state.positions);
  const portfolioValue = positions.reduce(
    (sum, position) => sum + position.quantity * position.creator.currentPrice,
    0
  );

  return {
    stats: {
      totalMarketCap,
      totalVolume24h,
      totalCreators: creators.length,
      activeTraders: 124,
    },
    rankings: creators.slice(0, 10).map((creator) => ({
      ...creator,
      marketCap: creator.currentPrice * creator.circulatingSupply,
    })),
    newListings: [...creators]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 5),
    user: {
      balance: state.balance,
      portfolioValue,
      totalAssets: state.balance + portfolioValue,
      topHolding: positions[0]?.creator.name || null,
    },
  };
}

async function getPortfolioResponse() {
  const state = await readState();

  return {
    balance: state.balance,
    positions: enrichPositions(state.positions),
    openOrders: state.openOrders
      .filter((order) => order.status === "OPEN" || order.status === "PARTIAL")
      .map((order) => ({ ...order, creator: getCreator(order.creatorId) })),
    trades: state.trades.map((trade) => ({ ...trade, creator: getCreator(trade.creatorId) })),
  };
}

function enrichPositions(positions: LocalPosition[]) {
  return positions.reduce<Array<LocalPosition & { creator: AppInTossCreator }>>(
    (items, position) => {
      const creator = getCreator(position.creatorId);
      if (position.quantity > 0 && creator) {
        items.push({ ...position, creator });
      }
      return items;
    },
    []
  );
}

async function placeLocalOrder(input: TradeRequest) {
  const creatorId = typeof input.creatorId === "string" ? input.creatorId : "";
  const creator = getCreator(creatorId);
  if (!creator) throw new Error("Creator not found");

  const side = input.side === "SELL" ? "SELL" : "BUY";
  const orderType = input.orderType === "MARKET" ? "MARKET" : "LIMIT";
  const price = Number(input.price || creator.currentPrice);
  const quantity = Number(input.quantity || 0);

  if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid price");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Invalid quantity");

  const state = await readState();
  const total = price * quantity;
  const shouldFill =
    orderType === "MARKET" ||
    (side === "BUY" && price >= creator.currentPrice) ||
    (side === "SELL" && price <= creator.currentPrice);

  if (side === "BUY") {
    if (state.balance < total) throw new Error("Insufficient balance");
    state.balance -= total;
  } else {
    const position = state.positions.find((item) => item.creatorId === creator.id);
    if (!position || position.quantity < quantity) throw new Error("Insufficient shares");
    position.quantity -= quantity;
  }

  const order: LocalOrder = {
    id: `appintoss-order-${Date.now()}`,
    creatorId: creator.id,
    type: side,
    price,
    quantity,
    filled: shouldFill ? quantity : 0,
    status: shouldFill ? "FILLED" : "OPEN",
    createdAt: new Date().toISOString(),
  };

  if (shouldFill) {
    if (side === "BUY") {
      addPosition(state, creator, quantity, price);
    } else {
      state.balance += total;
    }

    state.trades.unshift({
      id: `appintoss-trade-${Date.now()}`,
      creatorId: creator.id,
      userId: await getUserKey(),
      price,
      quantity,
      type: side,
      createdAt: order.createdAt,
    });
  } else {
    state.openOrders.unshift(order);
  }

  await writeState(state);

  return { order };
}

function addPosition(
  state: LocalState,
  creator: AppInTossCreator,
  quantity: number,
  price: number
) {
  const position = state.positions.find((item) => item.creatorId === creator.id);

  if (!position) {
    state.positions.push({
      id: `appintoss-position-${creator.id}`,
      creatorId: creator.id,
      quantity,
      avgPrice: price,
    });
    return;
  }

  const currentValue = position.avgPrice * position.quantity;
  const addedValue = price * quantity;
  position.quantity += quantity;
  position.avgPrice = (currentValue + addedValue) / position.quantity;
}

async function cancelLocalOrder(orderId: string) {
  const state = await readState();
  const order = state.openOrders.find((item) => item.id === orderId);
  if (!order) throw new Error("Order not found");

  const remaining = order.quantity - order.filled;
  if (order.type === "BUY") {
    state.balance += remaining * order.price;
  } else {
    const creator = getCreator(order.creatorId);
    if (creator) addPosition(state, creator, remaining, order.price);
  }

  order.status = "CANCELLED";
  state.openOrders = state.openOrders.filter((item) => item.id !== orderId);
  await writeState(state);

  return { ok: true };
}

function getTradesForCreator(id: string, state: LocalState) {
  return [
    ...state.trades.filter((trade) => trade.creatorId === id),
    ...(appInTossDemoData.trades[id] || []),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function getOrderBook(id: string, state: LocalState) {
  const orders = [
    ...(appInTossDemoData.orders[id] || []),
    ...state.openOrders.filter(
      (order) => order.creatorId === id && (order.status === "OPEN" || order.status === "PARTIAL")
    ),
  ];
  const asks = new Map<number, number>();
  const bids = new Map<number, number>();

  for (const order of orders) {
    const remaining = order.quantity - order.filled;
    if (remaining <= 0) continue;

    const target = order.type === "SELL" ? asks : bids;
    target.set(order.price, (target.get(order.price) || 0) + remaining);
  }

  return {
    asks: Array.from(asks.entries())
      .map(([price, quantity]) => ({ price, quantity }))
      .sort((a, b) => a.price - b.price),
    bids: Array.from(bids.entries())
      .map(([price, quantity]) => ({ price, quantity }))
      .sort((a, b) => b.price - a.price),
  };
}

function getCreator(id: string) {
  return appInTossDemoData.creators.find((creator) => creator.id === id) || null;
}

async function readState(): Promise<LocalState> {
  const raw = await getStoredValue(await getStateKey());
  if (!raw) return getInitialState();

  try {
    const parsed = JSON.parse(raw) as LocalState;
    return {
      balance: Number(parsed.balance ?? INITIAL_BALANCE),
      positions: Array.isArray(parsed.positions) ? parsed.positions : [],
      openOrders: Array.isArray(parsed.openOrders) ? parsed.openOrders : [],
      trades: Array.isArray(parsed.trades) ? parsed.trades : [],
    };
  } catch {
    return getInitialState();
  }
}

async function writeState(state: LocalState) {
  await setStoredValue(await getStateKey(), JSON.stringify(state));
}

function getInitialState(): LocalState {
  return {
    balance: INITIAL_BALANCE,
    positions: [],
    openOrders: [],
    trades: [],
  };
}

async function getStateKey() {
  return `${STORAGE_STATE_PREFIX}${await getUserKey()}`;
}

let userKeyPromise: Promise<string> | null = null;

async function getUserKey() {
  userKeyPromise ??= resolveUserKey();
  return userKeyPromise;
}

async function resolveUserKey() {
  const stored = await getStoredValue(STORAGE_USER_KEY);
  if (stored) return stored;

  try {
    const { getAnonymousKey } = await import("@apps-in-toss/web-framework");
    const result = await getAnonymousKey();

    if (result && result !== "ERROR") {
      await setStoredValue(STORAGE_USER_KEY, result.hash);
      return result.hash;
    }
  } catch {
    // Browser preview outside Toss falls back to a stable local key.
  }

  const fallback = "browser-demo-user";
  await setStoredValue(STORAGE_USER_KEY, fallback);
  return fallback;
}

async function getStoredValue(key: string) {
  try {
    const { Storage } = await import("@apps-in-toss/web-framework");
    const value = await Storage.getItem(key);
    if (value != null) return value;
  } catch {
    // Use web storage outside Toss/Sandbox.
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

async function setStoredValue(key: string, value: string) {
  try {
    const { Storage } = await import("@apps-in-toss/web-framework");
    await Storage.setItem(key, value);
  } catch {
    // Use web storage outside Toss/Sandbox.
  }

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore unavailable storage in private WebViews.
  }
}
