import { describe, expect, it, vi } from "vitest";

import {
  createPersistentOrderAttemptStore,
  type OrderAttempt,
} from "@/lib/orders/order-attempt-store";
import type { AsyncKeyValueStore } from "@/lib/storage/client-storage";

function memoryStore(): AsyncKeyValueStore & {
  values: Map<string, string>;
  removeItem: ReturnType<typeof vi.fn<AsyncKeyValueStore["removeItem"]>>;
} {
  const values = new Map<string, string>();
  return {
    values,
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    removeItem: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
}

const first: OrderAttempt = {
  signature: '["creator-1","BUY","MARKET",125,2]',
  idempotencyKey: "attempt-key-1",
};

const changed: OrderAttempt = {
  signature: '["creator-1","BUY","MARKET",125,3]',
  idempotencyKey: "attempt-key-2",
};

describe("persistent order attempt store", () => {
  it("persists one namespaced attempt in the selected store", async () => {
    const selectedStore = memoryStore();
    const attempts = createPersistentOrderAttemptStore(
      selectedStore,
      "restart-device",
    );

    expect(await attempts.get()).toBeNull();
    await attempts.set(first);

    expect(await attempts.get()).toEqual(first);
    expect([...selectedStore.values]).toEqual([
      ["creatorx:order-attempt:restart-device", JSON.stringify(first)],
    ]);
  });

  it("overwrites changed input and prevents stale completion from clearing it", async () => {
    const selectedStore = memoryStore();
    const attempts = createPersistentOrderAttemptStore(
      selectedStore,
      "restart-device",
    );
    await attempts.set(first);
    await attempts.set(changed);

    await attempts.clear(first);
    expect(await attempts.get()).toEqual(changed);
    expect(selectedStore.removeItem).not.toHaveBeenCalled();

    await attempts.clear(changed);
    expect(await attempts.get()).toBeNull();
    expect(selectedStore.removeItem).toHaveBeenCalledTimes(1);
  });

  it("serializes stale clear against a changed attempt on the same selected store", async () => {
    const values = new Map<string, string>();
    const readStarted = Promise.withResolvers<void>();
    const releaseRead = Promise.withResolvers<void>();
    let blockNextRead = false;
    const selectedStore: AsyncKeyValueStore = {
      async getItem(key) {
        const captured = values.get(key) ?? null;
        if (blockNextRead) {
          blockNextRead = false;
          readStarted.resolve();
          await releaseRead.promise;
        }
        return captured;
      },
      async setItem(key, value) {
        values.set(key, value);
      },
      async removeItem(key) {
        values.delete(key);
      },
    };
    const staleView = createPersistentOrderAttemptStore(
      selectedStore,
      "restart-device",
    );
    const changedView = createPersistentOrderAttemptStore(
      selectedStore,
      "restart-device",
    );
    await staleView.set(first);
    blockNextRead = true;

    const staleClear = staleView.clear(first);
    await readStarted.promise;
    const changedSet = changedView.set(changed);
    releaseRead.resolve();
    await Promise.all([staleClear, changedSet]);

    expect(await changedView.get()).toEqual(changed);
  });

  it("resolves one key across concurrent adapters for the same signature", async () => {
    const selectedStore = memoryStore();
    const firstView = createPersistentOrderAttemptStore(
      selectedStore,
      "restart-device",
    );
    const secondView = createPersistentOrderAttemptStore(
      selectedStore,
      "restart-device",
    );
    const keyFactory = vi
      .fn<() => string>()
      .mockReturnValueOnce("attempt-key-1")
      .mockReturnValueOnce("attempt-key-2");

    const [left, right] = await Promise.all([
      firstView.resolve(first.signature, keyFactory),
      secondView.resolve(first.signature, keyFactory),
    ]);

    expect(left).toEqual(first);
    expect(right).toEqual(first);
    expect(keyFactory).toHaveBeenCalledTimes(1);
  });
});
