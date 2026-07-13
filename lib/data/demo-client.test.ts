import { describe, expect, it, vi } from "vitest";

import {
  creatorSchema,
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

  override async setItem(key: string, value: string) {
    const gate = this.nextWriteGate;
    if (gate) {
      this.nextWriteGate = null;
      gate.markStarted();
      await gate.waitForRelease;
    }
    await super.setItem(key, value);
  }
}

class CommitThenFailStore extends MemoryStore {
  failAfterNextCommit = false;

  override async setItem(key: string, value: string) {
    await super.setItem(key, value);
    if (!this.failAfterNextCommit) return;
    this.failAfterNextCommit = false;
    throw new Error("response lost after durable commit");
  }
}

function freshStoreAdapter(backing: AsyncKeyValueStore): AsyncKeyValueStore {
  return {
    getItem: async (key) => await backing.getItem(key),
    setItem: async (key, value) => await backing.setItem(key, value),
    removeItem: async (key) => await backing.removeItem(key),
  };
}

async function allowConcurrentMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createClient(
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

const limitOrder = {
  creatorId: CREATOR_ID,
  side: "BUY" as const,
  orderType: "LIMIT" as const,
  limitPrice: "1",
  quantity: "10",
};

describe("DemoDataClient Task 6 contract", () => {
  it("returns schema-valid public reads with decimal strings", async () => {
    const client = createClient();
    const creators = await client.listCreators({ sort: "score", limit: 20 });
    const creator = await client.getCreator(CREATOR_ID);
    const history = await client.getCreatorHistory(CREATOR_ID, { days: 7 });
    const trades = await client.getCreatorTrades(CREATOR_ID);
    const orderBook = await client.getOrderBook(CREATOR_ID);
    const portfolio = await client.getPortfolio();

    expect(() => paginatedCreatorsSchema.parse(creators)).not.toThrow();
    expect(() => creatorSchema.parse(creator)).not.toThrow();
    expect(() => historyPointSchema.array().parse(history)).not.toThrow();
    expect(() => tradeSchema.array().parse(trades)).not.toThrow();
    expect(() => orderBookSchema.parse(orderBook)).not.toThrow();
    expect(() => portfolioSchema.parse(portfolio)).not.toThrow();
    expect(typeof creator.currentPrice).toBe("string");
    expect(typeof orderBook.asks[0]?.price).toBe("string");
    expect(portfolio).toMatchObject({
      balance: "100000",
      reservedBalance: "0",
      availableBalance: "100000",
      positions: [],
      openOrders: [],
      executions: [],
    });
  });

  it("keeps demo state namespaces isolated", async () => {
    const store = new MemoryStore();
    const deviceA = createClient("device-a", store);
    const deviceB = createClient("device-b", store);

    await deviceA.placeOrder({
      creatorId: CREATOR_ID,
      side: "BUY",
      orderType: "MARKET",
      quantity: "2",
    });

    expect((await deviceA.getPortfolio()).positions[0]?.quantity).toBe("2");
    expect(await deviceB.getPortfolio()).toMatchObject({
      availableBalance: "100000",
      positions: [],
    });
    expect([...store.values.keys()]).toEqual([
      `${STATE_KEY_PREFIX}device-a`,
    ]);
  });

  it("uses the Task 6 limit DTO and preserves balance reservations", async () => {
    const client = createClient();
    const order = await client.placeOrder(limitOrder);
    const reserved = await client.getPortfolio();

    expect(() => orderSchema.parse(order)).not.toThrow();
    expect(order).toMatchObject({
      side: "BUY",
      orderType: "LIMIT",
      price: "1",
      quantity: "10",
      reservedQuote: "10",
      status: "OPEN",
    });
    expect(reserved).toMatchObject({
      balance: "100000",
      reservedBalance: "10",
      availableBalance: "99990",
      openOrders: [{ id: order.id, side: "BUY" }],
    });

    await client.cancelOrder(order.id, { idempotencyKey: "cancel-1" });
    expect(await client.getPortfolio()).toMatchObject({
      reservedBalance: "0",
      availableBalance: "100000",
      openOrders: [],
    });
  });

  it("does not accept a client price for market orders", async () => {
    const client = createClient();

    await expect(
      client.placeOrder({
        creatorId: CREATOR_ID,
        side: "BUY",
        orderType: "MARKET",
        quantity: "1",
        price: "999999",
      } as never),
    ).rejects.toMatchObject({ code: "REQUEST_REJECTED", retryable: false });

    const order = await client.placeOrder({
      creatorId: CREATOR_ID,
      side: "BUY",
      orderType: "MARKET",
      quantity: "1",
    });
    expect(order.price).toBe("1280");
    expect((await client.getPortfolio()).executions).toHaveLength(1);
  });

  it("replays an idempotent order and rejects a reused key with changed input", async () => {
    const store = new MemoryStore();
    const first = await createClient("device-a", store).placeOrder(limitOrder, {
      idempotencyKey: "idem-order-1",
    });
    const replay = await createClient("device-a", store).placeOrder(limitOrder, {
      idempotencyKey: "idem-order-1",
    });

    expect(replay).toEqual(first);
    await expect(
      createClient("device-a", store).placeOrder(
        { ...limitOrder, quantity: "11" },
        { idempotencyKey: "idem-order-1" },
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 });
  });

  it("recovers a durably committed idempotent order after the store loses its response", async () => {
    const store = new CommitThenFailStore();
    const setItem = vi.spyOn(store, "setItem");
    const input = {
      creatorId: CREATOR_ID,
      side: "BUY" as const,
      orderType: "MARKET" as const,
      quantity: "2",
    };

    store.failAfterNextCommit = true;
    await expect(
      createClient("device-a", store).placeOrder(input, {
        idempotencyKey: "durable-commit-replay",
      }),
    ).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
      retryable: true,
    });

    const restarted = createClient("device-a", store);
    const replay = await restarted.placeOrder(input, {
      idempotencyKey: "durable-commit-replay",
    });

    expect(replay).toMatchObject({ status: "FILLED", quantity: "2" });
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(await restarted.getPortfolio()).toMatchObject({
      availableBalance: "97440",
      positions: [{ creatorId: CREATOR_ID, quantity: "2" }],
      executions: [{ creatorId: CREATOR_ID, quantity: "2", side: "BUY" }],
    });
  });

  it("migrates persisted numeric demo state while emitting Task 6 strings", async () => {
    const store = new MemoryStore();
    store.values.set(
      `${STATE_KEY_PREFIX}device-a`,
      JSON.stringify({
        balance: 99990,
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
            createdAt: FIXED_NOW.toISOString(),
          },
        ],
        trades: [],
      }),
    );

    const portfolio = await createClient("device-a", store).getPortfolio();
    expect(portfolio.openOrders[0]).toMatchObject({
      id: "legacy-order",
      side: "BUY",
      orderType: "LIMIT",
      price: "1",
      quantity: "10",
    });
  });

  it("serializes concurrent mutations sharing a store and namespace", async () => {
    const store = new MemoryStore();
    let id = 0;
    const dependencies = {
      store,
      namespace: "device-a",
      now: () => FIXED_NOW,
      idFactory: () => `shared-${++id}`,
    };
    const first = new DemoDataClient(dependencies);
    const second = new DemoDataClient(dependencies);

    const [firstOrder, secondOrder] = await Promise.all([
      first.placeOrder(limitOrder),
      second.placeOrder({ ...limitOrder, limitPrice: "2" }),
    ]);
    const portfolio = await first.getPortfolio();

    expect(new Set([firstOrder.id, secondOrder.id]).size).toBe(2);
    expect(portfolio).toMatchObject({
      reservedBalance: "30",
      availableBalance: "99970",
    });
    expect(portfolio.openOrders).toHaveLength(2);
  });

  it("serializes fresh adapters sharing a persisted backing with one storage scope", async () => {
    const backing = new ControlledWriteStore();
    let id = 0;
    const createScopedClient = () =>
      new DemoDataClient({
        store: freshStoreAdapter(backing),
        namespace: "device-a",
        storageScope: "shared-backing-device-a",
        now: () => FIXED_NOW,
        idFactory: () => `fresh-wrapper-${++id}`,
      });
    const firstClient = createScopedClient();
    const secondClient = createScopedClient();
    const gate = backing.blockNextWrite();

    const first = firstClient.placeOrder(limitOrder);
    await gate.started;
    const second = secondClient.placeOrder({ ...limitOrder, limitPrice: "2" });
    await allowConcurrentMicrotasks();
    gate.release();
    const orders = await Promise.all([first, second]);

    const portfolio = await firstClient.getPortfolio();
    expect(new Set(orders.map((order) => order.id)).size).toBe(2);
    expect(portfolio).toMatchObject({
      reservedBalance: "30",
      availableBalance: "99970",
    });
    expect(portfolio.openOrders.map((order) => order.id).sort()).toEqual(
      orders.map((order) => order.id).sort(),
    );
  });

  it("preserves a newer fresh-adapter order while another adapter cancels an older order", async () => {
    const backing = new ControlledWriteStore();
    let id = 0;
    const createScopedClient = () =>
      new DemoDataClient({
        store: freshStoreAdapter(backing),
        namespace: "device-a",
        storageScope: "shared-backing-device-a",
        now: () => FIXED_NOW,
        idFactory: () => `cancel-wrapper-${++id}`,
      });
    const cancelClient = createScopedClient();
    const orderClient = createScopedClient();
    const existing = await cancelClient.placeOrder(limitOrder);
    const gate = backing.blockNextWrite();

    const cancellation = cancelClient.cancelOrder(existing.id);
    await gate.started;
    const nextOrder = orderClient.placeOrder({
      ...limitOrder,
      limitPrice: "2",
    });
    await allowConcurrentMicrotasks();
    gate.release();
    const [, accepted] = await Promise.all([cancellation, nextOrder]);

    expect(await cancelClient.getPortfolio()).toMatchObject({
      reservedBalance: "20",
      availableBalance: "99980",
      openOrders: [{ id: accepted.id, price: "2" }],
    });
  });

  it("does not overwrite corrupt persisted state while surfacing a retryable error", async () => {
    const store = new MemoryStore();
    const key = `${STATE_KEY_PREFIX}device-a`;
    store.values.set(key, "{ definitely-not-json");
    const setItem = vi.spyOn(store, "setItem");

    await expect(createClient("device-a", store).getPortfolio()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      retryable: true,
    });
    expect(store.values.get(key)).toBe("{ definitely-not-json");
    expect(setItem).not.toHaveBeenCalled();
  });

  it.each([
    { ...limitOrder, quantity: "0" },
    { ...limitOrder, quantity: "-1" },
    { ...limitOrder, limitPrice: "0" },
    { ...limitOrder, limitPrice: "-1" },
    { ...limitOrder, creatorId: "" },
  ])("rejects invalid public order input", async (input) => {
    await expect(createClient().placeOrder(input)).rejects.toMatchObject({
      code: "REQUEST_REJECTED",
      retryable: false,
    });
  });
});
