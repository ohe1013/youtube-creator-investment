import { describe, expect, it, vi } from "vitest";

import { appInTossDemoData } from "@/lib/appintoss-demo-data";
import {
  creatorSchema,
  creatorStatSchema,
  creatorVideoSchema,
  dashboardSchema,
  historyPointSchema,
  orderBookSchema,
  orderSchema,
  paginatedCreatorsSchema,
  portfolioSchema,
  tradeSchema,
} from "@/lib/data/contracts";
import { DemoDataClient } from "@/lib/data/demo-client";
import type { AsyncKeyValueStore } from "@/lib/storage/client-storage";

const CREATOR_ID = "creator-kpop-lab";
const STATE_KEY_PREFIX = "creatorx:appintoss:state:";
const FIXED_NOW = new Date("2026-07-10T10:11:12.000Z");

class MemoryStore implements AsyncKeyValueStore {
  readonly values = new Map<string, string>();

  async getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  async removeItem(key: string) {
    this.values.delete(key);
  }
}

class ControlledWriteStore extends MemoryStore {
  private nextWriteGate: {
    markStarted: () => void;
    waitForRelease: Promise<void>;
  } | null = null;

  blockNextWrite() {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    this.nextWriteGate = {
      markStarted: () => started.resolve(),
      waitForRelease: release.promise,
    };
    return {
      started: started.promise,
      release: () => release.resolve(),
    };
  }

  async setItem(key: string, value: string) {
    const gate = this.nextWriteGate;
    if (gate) {
      this.nextWriteGate = null;
      gate.markStarted();
      await gate.waitForRelease;
    }
    await super.setItem(key, value);
  }
}

async function allowConcurrentMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createDemoClient(
  namespace = "device-a",
  store: AsyncKeyValueStore = new MemoryStore(),
) {
  let id = 0;
  return new DemoDataClient({
    store,
    namespace,
    now: () => FIXED_NOW,
    idFactory: () => `fixture-${++id}`,
  });
}

describe("DemoDataClient reads", () => {
  it("preserves all eight fixtures and deterministic seeded ordering", async () => {
    const client = createDemoClient();

    const first = await client.listCreators({ sort: "score", limit: 100 });
    const second = await client.listCreators({ sort: "score", limit: 100 });

    expect(first).toEqual(second);
    expect(first.creators).toHaveLength(8);
    expect(first.creators.map(({ id }) => id)).toEqual([
      "creator-kpop-lab",
      "creator-foodie-seoul",
      "creator-tech-under10",
      "creator-run-day",
      "creator-edu-signal",
      "creator-vlog-nomad",
      "creator-beauty-note",
      "creator-game-meta",
    ]);
    expect(first.creators).not.toBe(appInTossDemoData.creators);
    first.creators[0].name = "mutated by caller";
    expect((await client.getCreator(CREATOR_ID)).name).toBe("K-POP LAB");
  });

  it("implements every typed read with schema-valid legacy demo semantics", async () => {
    const client = createDemoClient();

    const categories = await client.listCategories();
    const creators = await client.listCreators({
      category: "K-POP",
      minSubs: 1,
      maxSubs: 5_000_000,
      sort: "subs",
      page: 1,
      limit: 20,
    });
    const creator = await client.getCreator(CREATOR_ID);
    const stats = await client.getCreatorStats(CREATOR_ID, { days: 90 });
    const videos = await client.getCreatorVideos(CREATOR_ID);
    const history = await client.getCreatorHistory(CREATOR_ID, { days: 7 });
    const trades = await client.getCreatorTrades(CREATOR_ID);
    const orderBook = await client.getOrderBook(CREATOR_ID);
    const dashboard = await client.getDashboard();
    const portfolio = await client.getPortfolio();

    expect(categories).toEqual([
      "전체",
      "Beauty",
      "Education",
      "Food",
      "Gaming",
      "K-POP",
      "Sports",
      "Tech",
      "Vlog",
    ]);
    expect(() => paginatedCreatorsSchema.parse(creators)).not.toThrow();
    expect(creators.creators.map(({ id }) => id)).toEqual([CREATOR_ID]);
    expect(() => creatorSchema.parse(creator)).not.toThrow();
    expect(() => creatorStatSchema.array().parse(stats)).not.toThrow();
    expect(stats).toEqual(appInTossDemoData.stats[CREATOR_ID]);
    expect(() => creatorVideoSchema.array().parse(videos)).not.toThrow();
    expect(videos).toEqual(appInTossDemoData.videos[CREATOR_ID]);
    expect(() => historyPointSchema.array().parse(history)).not.toThrow();
    expect(history).toHaveLength(appInTossDemoData.trades[CREATOR_ID].length);
    expect(history[0].date <= history.at(-1)!.date).toBe(true);
    expect(() => tradeSchema.array().parse(trades)).not.toThrow();
    expect(() => orderBookSchema.parse(orderBook)).not.toThrow();
    expect(orderBook.asks.map(({ price }) => price)).toEqual(
      [...orderBook.asks.map(({ price }) => price)].sort((a, b) => a - b),
    );
    expect(orderBook.bids.map(({ price }) => price)).toEqual(
      [...orderBook.bids.map(({ price }) => price)].sort((a, b) => b - a),
    );
    expect(() => dashboardSchema.parse(dashboard)).not.toThrow();
    expect(dashboard.stats.totalCreators).toBe(8);
    expect(() => portfolioSchema.parse(portfolio)).not.toThrow();
    expect(portfolio).toMatchObject({
      balance: 100_000,
      positions: [],
      openOrders: [],
      trades: [],
    });
  });

  it("uses the exact namespace key and isolates namespaces", async () => {
    const store = new MemoryStore();
    const deviceA = createDemoClient("device-a", store);
    const deviceB = createDemoClient("device-b", store);

    await deviceA.placeOrder({
      creatorId: CREATOR_ID,
      side: "BUY",
      orderType: "MARKET",
      price: 1_280,
      quantity: 2,
    });

    expect((await deviceA.getPortfolio()).positions[0].quantity).toBe(2);
    expect(await deviceB.getPortfolio()).toMatchObject({
      balance: 100_000,
      positions: [],
    });
    expect([...store.values.keys()]).toEqual([
      `${STATE_KEY_PREFIX}device-a`,
    ]);
  });

  it("loads persisted state in a new client instance", async () => {
    const store = new MemoryStore();
    await createDemoClient("device-a", store).placeOrder({
      creatorId: CREATOR_ID,
      side: "BUY",
      orderType: "MARKET",
      price: 1_280,
      quantity: 3,
    });

    const restored = createDemoClient("device-a", store);
    expect(await restored.getPortfolio()).toMatchObject({
      balance: 96_160,
      positions: [{ creatorId: CREATOR_ID, quantity: 3, avgPrice: 1_280 }],
    });
  });

  it("migrates the legacy state key and missing orderType in place", async () => {
    const store = new MemoryStore();
    const key = `${STATE_KEY_PREFIX}device-a`;
    store.values.set(
      key,
      JSON.stringify({
        balance: 99_990,
        positions: [],
        openOrders: [
          {
            id: "legacy-order",
            creatorId: CREATOR_ID,
            type: "BUY",
            price: 1,
            quantity: 10,
            filled: 0,
            status: "OPEN",
            createdAt: "2026-07-09T09:00:00.000Z",
          },
        ],
        trades: [],
      }),
    );
    const client = createDemoClient("device-a", store);

    expect((await client.getPortfolio()).openOrders[0]).toMatchObject({
      id: "legacy-order",
      orderType: "LIMIT",
    });
    await client.cancelOrder("legacy-order");
    expect((await client.getPortfolio()).balance).toBe(100_000);
    expect([...store.values.keys()]).toEqual([key]);
  });

  it.each(["balance", "positions", "openOrders", "trades"])(
    "rejects persisted JSON missing %s without overwriting it",
    async (missingField) => {
      const store = new MemoryStore();
      const key = `${STATE_KEY_PREFIX}device-a`;
      const incomplete: Record<string, unknown> = {
        balance: 100_000,
        positions: [],
        openOrders: [],
        trades: [],
      };
      delete incomplete[missingField];
      const raw = JSON.stringify(incomplete);
      store.values.set(key, raw);
      const setItem = vi.spyOn(store, "setItem");

      await expect(
        createDemoClient("device-a", store).getPortfolio(),
      ).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
        retryable: true,
      });
      expect(store.values.get(key)).toBe(raw);
      expect(setItem).not.toHaveBeenCalled();
    },
  );
});

describe("DemoDataClient orders", () => {
  it("fills a market buy and calls now once for the logical order", async () => {
    const store = new MemoryStore();
    const now = vi.fn(() => FIXED_NOW);
    let id = 0;
    const client = new DemoDataClient({
      store,
      namespace: "device-a",
      now,
      idFactory: () => `fixture-${++id}`,
    });

    const order = await client.placeOrder({
      creatorId: CREATOR_ID,
      side: "BUY",
      orderType: "MARKET",
      price: 1_280,
      quantity: 2,
    });

    expect(() => orderSchema.parse(order)).not.toThrow();
    expect(order).toMatchObject({
      id: "appintoss-order-fixture-1",
      type: "BUY",
      orderType: "MARKET",
      filled: 2,
      status: "FILLED",
      createdAt: FIXED_NOW.toISOString(),
    });
    expect(now).toHaveBeenCalledTimes(1);
    expect(await client.getPortfolio()).toMatchObject({
      balance: 97_440,
      positions: [{ creatorId: CREATOR_ID, quantity: 2, avgPrice: 1_280 }],
      openOrders: [],
      trades: [
        {
          id: "appintoss-trade-fixture-2",
          userId: "device-a",
          type: "BUY",
          quantity: 2,
        },
      ],
    });
  });

  it("reserves a non-crossing limit buy and refunds it exactly once", async () => {
    const client = createDemoClient();
    const order = await client.placeOrder({
      creatorId: CREATOR_ID,
      side: "BUY",
      orderType: "LIMIT",
      price: 1,
      quantity: 10,
    });

    expect(order.status).toBe("OPEN");
    expect(await client.getPortfolio()).toMatchObject({
      balance: 99_990,
      openOrders: [{ id: order.id }],
    });

    await client.cancelOrder(order.id);
    await expect(client.cancelOrder(order.id)).rejects.toMatchObject({
      code: "ORDER_NOT_FOUND",
      retryable: false,
    });
    expect(await client.getPortfolio()).toMatchObject({
      balance: 100_000,
      openOrders: [],
    });
  });

  it("reserves non-crossing sell shares and restores them on cancel", async () => {
    const client = createDemoClient();
    await client.placeOrder({
      creatorId: CREATOR_ID,
      side: "BUY",
      orderType: "MARKET",
      price: 1_280,
      quantity: 3,
    });
    const sell = await client.placeOrder({
      creatorId: CREATOR_ID,
      side: "SELL",
      orderType: "LIMIT",
      price: 2_000,
      quantity: 2,
    });

    expect(await client.getPortfolio()).toMatchObject({
      positions: [{ quantity: 1 }],
      openOrders: [{ id: sell.id, type: "SELL" }],
    });
    await client.cancelOrder(sell.id);
    expect(await client.getPortfolio()).toMatchObject({
      positions: [{ quantity: 3, avgPrice: 1_280 }],
      openOrders: [],
    });
  });

  it("persists a market sale of the entire position", async () => {
    const store = new MemoryStore();
    const client = createDemoClient("device-a", store);
    await client.placeOrder({
      creatorId: CREATOR_ID,
      side: "BUY",
      orderType: "MARKET",
      price: 1_280,
      quantity: 2,
    });

    const sell = await client.placeOrder({
      creatorId: CREATOR_ID,
      side: "SELL",
      orderType: "MARKET",
      price: 1_280,
      quantity: 2,
    });

    expect(sell.status).toBe("FILLED");
    expect(await createDemoClient("device-a", store).getPortfolio()).toMatchObject({
      balance: 100_000,
      positions: [],
      openOrders: [],
    });
  });

  it("restores a legacy reserved sell at the retained position average", async () => {
    const store = new MemoryStore();
    const key = `${STATE_KEY_PREFIX}device-a`;
    store.values.set(
      key,
      JSON.stringify({
        balance: 100_000,
        positions: [
          {
            id: `appintoss-position-${CREATOR_ID}`,
            creatorId: CREATOR_ID,
            quantity: 2,
            avgPrice: 100,
          },
        ],
        openOrders: [
          {
            id: "legacy-sell",
            creatorId: CREATOR_ID,
            type: "SELL",
            price: 200,
            quantity: 3,
            filled: 0,
            status: "OPEN",
            createdAt: "2026-07-09T09:00:00.000Z",
          },
        ],
        trades: [],
      }),
    );
    const client = createDemoClient("device-a", store);

    await client.cancelOrder("legacy-sell");

    expect(await client.getPortfolio()).toMatchObject({
      positions: [{ creatorId: CREATOR_ID, quantity: 5, avgPrice: 100 }],
      openOrders: [],
    });
  });

  it("rejects a legacy sell refund when no cost basis can be trusted", async () => {
    const store = new MemoryStore();
    const key = `${STATE_KEY_PREFIX}device-a`;
    const raw = JSON.stringify({
      balance: 100_000,
      positions: [],
      openOrders: [
        {
          id: "legacy-sell",
          creatorId: CREATOR_ID,
          type: "SELL",
          price: 200,
          quantity: 3,
          filled: 0,
          status: "OPEN",
          createdAt: "2026-07-09T09:00:00.000Z",
        },
      ],
      trades: [],
    });
    store.values.set(key, raw);
    const setItem = vi.spyOn(store, "setItem");

    await expect(
      createDemoClient("device-a", store).cancelOrder("legacy-sell"),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE", retryable: true });
    expect(store.values.get(key)).toBe(raw);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("rejects duplicate generated order IDs before changing persisted assets", async () => {
    const store = new MemoryStore();
    const client = new DemoDataClient({
      store,
      namespace: "device-a",
      now: () => FIXED_NOW,
      idFactory: () => "duplicate",
    });
    const input = {
      creatorId: CREATOR_ID,
      side: "BUY" as const,
      orderType: "LIMIT" as const,
      price: 1,
      quantity: 10,
    };
    const first = await client.placeOrder(input);

    await expect(client.placeOrder(input)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      retryable: true,
    });
    expect(await client.getPortfolio()).toMatchObject({
      balance: 99_990,
      openOrders: [{ id: first.id }],
    });
    await client.cancelOrder(first.id);
    await expect(client.cancelOrder(first.id)).rejects.toMatchObject({
      code: "ORDER_NOT_FOUND",
    });
    expect((await client.getPortfolio()).balance).toBe(100_000);
  });

  it("rejects duplicate generated trade IDs before changing persisted assets", async () => {
    const store = new MemoryStore();
    const client = new DemoDataClient({
      store,
      namespace: "device-a",
      now: () => FIXED_NOW,
      idFactory: () => "duplicate",
    });
    const input = {
      creatorId: CREATOR_ID,
      side: "BUY" as const,
      orderType: "MARKET" as const,
      price: 1_280,
      quantity: 1,
    };
    await client.placeOrder(input);

    await expect(client.placeOrder(input)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      retryable: true,
    });
    expect(await client.getPortfolio()).toMatchObject({
      balance: 98_720,
      positions: [{ creatorId: CREATOR_ID, quantity: 1 }],
      trades: [{ id: "appintoss-trade-duplicate" }],
    });
  });

  it("rejects insufficient balance and shares without persisting", async () => {
    const store = new MemoryStore();
    const client = createDemoClient("device-a", store);

    await expect(
      client.placeOrder({
        creatorId: CREATOR_ID,
        side: "BUY",
        orderType: "MARKET",
        price: 100_001,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    await expect(
      client.placeOrder({
        creatorId: CREATOR_ID,
        side: "SELL",
        orderType: "MARKET",
        price: 1_280,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_SHARES" });
    expect(store.values.size).toBe(0);
  });
});

describe("DemoDataClient concurrent mutations", () => {
  it("serializes two open buys across clients sharing one store and namespace", async () => {
    const store = new ControlledWriteStore();
    let id = 0;
    const dependencies = {
      store,
      namespace: "device-a",
      now: () => FIXED_NOW,
      idFactory: () => `concurrent-${++id}`,
    };
    const firstClient = new DemoDataClient(dependencies);
    const secondClient = new DemoDataClient(dependencies);
    const input = {
      creatorId: CREATOR_ID,
      side: "BUY" as const,
      orderType: "LIMIT" as const,
      price: 1,
      quantity: 10,
    };
    const gate = store.blockNextWrite();
    const first = firstClient.placeOrder(input);
    await gate.started;
    const second = secondClient.placeOrder(input);
    await allowConcurrentMicrotasks();
    gate.release();

    const orders = await Promise.all([first, second]);
    expect(new Set(orders.map(({ id: orderId }) => orderId)).size).toBe(2);
    const portfolio = await firstClient.getPortfolio();
    expect(portfolio.balance).toBe(99_980);
    expect(portfolio.openOrders.map(({ id: orderId }) => orderId)).toEqual(
      orders.map(({ id: orderId }) => orderId).sort(),
    );
  });

  it("allows exactly one concurrent cancel and refunds exactly once", async () => {
    const store = new ControlledWriteStore();
    const firstClient = createDemoClient("device-a", store);
    const secondClient = createDemoClient("device-a", store);
    const order = await firstClient.placeOrder({
      creatorId: CREATOR_ID,
      side: "BUY",
      orderType: "LIMIT",
      price: 1,
      quantity: 10,
    });
    const gate = store.blockNextWrite();
    const firstCancel = firstClient.cancelOrder(order.id);
    await gate.started;
    const secondCancel = secondClient.cancelOrder(order.id);
    await allowConcurrentMicrotasks();
    gate.release();

    const results = await Promise.allSettled([firstCancel, secondCancel]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({ code: "ORDER_NOT_FOUND" });
    expect(await firstClient.getPortfolio()).toMatchObject({
      balance: 100_000,
      openOrders: [],
    });
  });

  it("continues the namespace queue after a rejected mutation", async () => {
    const store = new MemoryStore();
    const firstClient = createDemoClient("device-a", store);
    const secondClient = createDemoClient("device-a", store);
    const rejected = firstClient.placeOrder({
      creatorId: CREATOR_ID,
      side: "BUY",
      orderType: "MARKET",
      price: 100_001,
      quantity: 1,
    });
    const accepted = secondClient.placeOrder({
      creatorId: CREATOR_ID,
      side: "BUY",
      orderType: "LIMIT",
      price: 1,
      quantity: 10,
    });

    await expect(rejected).rejects.toMatchObject({
      code: "INSUFFICIENT_BALANCE",
    });
    await expect(accepted).resolves.toMatchObject({ status: "OPEN" });
    expect(await firstClient.getPortfolio()).toMatchObject({
      balance: 99_990,
      openOrders: [{ quantity: 10 }],
    });
  });

  it.each([
    ["another namespace", "device-b", false],
    ["another store", "device-a", true],
  ] as const)(
    "does not block %s behind an unrelated mutation",
    async (_label, secondNamespace, useAnotherStore) => {
      const blockedStore = new ControlledWriteStore();
      const secondStore = useAnotherStore ? new MemoryStore() : blockedStore;
      const blockedClient = createDemoClient("device-a", blockedStore);
      const unrelatedClient = createDemoClient(secondNamespace, secondStore);
      const input = {
        creatorId: CREATOR_ID,
        side: "BUY" as const,
        orderType: "LIMIT" as const,
        price: 1,
        quantity: 1,
      };
      const gate = blockedStore.blockNextWrite();
      const blocked = blockedClient.placeOrder(input);
      await gate.started;
      const unrelated = unrelatedClient.placeOrder(input);
      const timeout = Promise.withResolvers<"blocked">();
      const timeoutId = setTimeout(() => timeout.resolve("blocked"), 250);
      const outcome = await Promise.race([
        unrelated.then(() => "completed" as const),
        timeout.promise,
      ]);
      clearTimeout(timeoutId);
      gate.release();
      await Promise.all([blocked, unrelated]);

      expect(outcome).toBe("completed");
    },
  );
});

describe("DemoDataClient validation and storage failures", () => {
  it.each([
    ["zero price", { price: 0 }],
    ["negative price", { price: -1 }],
    ["NaN price", { price: Number.NaN }],
    ["infinite price", { price: Number.POSITIVE_INFINITY }],
    ["zero quantity", { quantity: 0 }],
    ["negative quantity", { quantity: -1 }],
    ["NaN quantity", { quantity: Number.NaN }],
    ["infinite quantity", { quantity: Number.POSITIVE_INFINITY }],
    ["empty creator", { creatorId: "" }],
    ["invalid side", { side: "HOLD" }],
    ["invalid order type", { orderType: "STOP" }],
  ])("rejects %s as a stable request error", async (_label, override) => {
    const client = createDemoClient();
    const input: unknown = {
      creatorId: CREATOR_ID,
      side: "BUY",
      orderType: "LIMIT",
      price: 1_280,
      quantity: 1,
      ...override,
    };

    await expect(client.placeOrder(input as never)).rejects.toMatchObject({
      code: "REQUEST_REJECTED",
      retryable: false,
    });
  });

  it("rejects invalid read enums, days, and empty IDs", async () => {
    const client = createDemoClient();

    await expect(
      client.listCreators({ sort: "alphabetical" } as never),
    ).rejects.toMatchObject({ code: "REQUEST_REJECTED" });
    await expect(
      client.getCreatorStats(CREATOR_ID, { days: 0 }),
    ).rejects.toMatchObject({ code: "REQUEST_REJECTED" });
    await expect(client.getCreator(" ")).rejects.toMatchObject({
      code: "REQUEST_REJECTED",
    });
    await expect(client.cancelOrder("")).rejects.toMatchObject({
      code: "REQUEST_REJECTED",
    });
  });

  it("reports an unknown creator without writing state", async () => {
    const store = new MemoryStore();
    const client = createDemoClient("device-a", store);

    for (const action of [
      () => client.getCreator("missing"),
      () => client.getCreatorStats("missing", { days: 7 }),
      () => client.getCreatorVideos("missing"),
      () => client.getCreatorHistory("missing", { days: 7 }),
      () => client.getCreatorTrades("missing"),
      () => client.getOrderBook("missing"),
      () =>
        client.placeOrder({
          creatorId: "missing",
          side: "BUY",
          orderType: "MARKET",
          price: 1,
          quantity: 1,
        }),
    ]) {
      await expect(action()).rejects.toMatchObject({
        code: "NOT_FOUND",
        retryable: false,
      });
    }
    expect(store.values.size).toBe(0);
  });

  it("surfaces corrupt JSON as retryable INVALID_RESPONSE without overwriting it", async () => {
    const store = new MemoryStore();
    const key = `${STATE_KEY_PREFIX}device-a`;
    store.values.set(key, "{ definitely-not-json");
    const setItem = vi.spyOn(store, "setItem");

    await expect(createDemoClient("device-a", store).getPortfolio()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      retryable: true,
    });
    expect(store.values.get(key)).toBe("{ definitely-not-json");
    expect(setItem).not.toHaveBeenCalled();
  });

  it.each(["get", "set"])(
    "normalizes store %s failures as STORAGE_UNAVAILABLE",
    async (operation) => {
      const store: AsyncKeyValueStore = {
        getItem: async () => {
          if (operation === "get") throw new Error("native get failed");
          return null;
        },
        setItem: async () => {
          if (operation === "set") throw new Error("native set failed");
        },
        removeItem: async () => undefined,
      };
      const client = createDemoClient("device-a", store);
      const action =
        operation === "get"
          ? () => client.getPortfolio()
          : () =>
              client.placeOrder({
                creatorId: CREATOR_ID,
                side: "BUY",
                orderType: "LIMIT",
                price: 1,
                quantity: 1,
              });

      await expect(action()).rejects.toMatchObject({
        code: "STORAGE_UNAVAILABLE",
        retryable: true,
      });
    },
  );
});
