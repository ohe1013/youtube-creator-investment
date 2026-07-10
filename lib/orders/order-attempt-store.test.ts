import { describe, expect, it, vi } from "vitest";

import {
  createPersistentOrderAttemptStore,
  deriveOrderAttemptStorageKey,
} from "@/lib/orders/order-attempt-store";
import type { AsyncKeyValueStore } from "@/lib/storage/client-storage";

const SIGNATURE_A = '["creator-1","BUY","MARKET",125,2]';
const SIGNATURE_B = '["creator-2","SELL","LIMIT",130,3]';

type SharedBacking = Map<string, string>;

function adapter(
  backing: SharedBacking,
  overrides: Partial<AsyncKeyValueStore> = {},
): AsyncKeyValueStore {
  return {
    async getItem(key) {
      return backing.get(key) ?? null;
    },
    async setItem(key, value) {
      backing.set(key, value);
    },
    async removeItem(key) {
      backing.delete(key);
    },
    ...overrides,
  };
}

function record(
  backing: SharedBacking,
  idempotencyKey: string,
): unknown {
  for (const raw of backing.values()) {
    const candidate = JSON.parse(raw) as { idempotencyKey?: string };
    if (candidate.idempotencyKey === idempotencyKey) return candidate;
  }
  return null;
}

function keyFactory(...keys: string[]) {
  const factory = vi.fn<() => string>();
  for (const key of keys) factory.mockReturnValueOnce(key);
  return factory;
}

describe("persistent order attempt store", () => {
  it("keeps concurrent A and B records independent so ambiguous A reuses key1 after B settles", async () => {
    const backing: SharedBacking = new Map();
    const attempts = createPersistentOrderAttemptStore(
      adapter(backing),
      "restart-device",
    );
    const createKey = keyFactory("key1", "key2", "key3");

    const [attemptA, attemptB] = await Promise.all([
      attempts.resolve(SIGNATURE_A, createKey),
      attempts.resolve(SIGNATURE_B, createKey),
    ]);
    expect(attemptA.idempotencyKey).toBe("key1");
    expect(attemptB.idempotencyKey).toBe("key2");

    await expect(attempts.settle(attemptB)).resolves.toEqual({
      storageConcern: null,
    });
    const retryA = await attempts.resolve(SIGNATURE_A, createKey);

    expect(retryA).toEqual(attemptA);
    expect(createKey).toHaveBeenCalledTimes(2);
    expect(record(backing, "key1")).toEqual({
      status: "pending",
      idempotencyKey: "key1",
    });
    expect(record(backing, "key2")).toBeNull();
  });

  it("starts a new pending key after a settled record survives adapter recreation", async () => {
    const backing: SharedBacking = new Map();
    const firstView = createPersistentOrderAttemptStore(
      adapter(backing, { removeItem: async () => undefined }),
      "restart-device",
    );
    const first = await firstView.resolve(
      SIGNATURE_A,
      keyFactory("attempt-key-1"),
    );
    await expect(firstView.settle(first)).resolves.toEqual({
      storageConcern: null,
    });

    const restartedView = createPersistentOrderAttemptStore(
      adapter(backing),
      "restart-device",
    );
    const second = await restartedView.resolve(
      SIGNATURE_A,
      keyFactory("attempt-key-2"),
    );

    expect(second.idempotencyKey).toBe("attempt-key-2");
    expect(record(backing, "attempt-key-2")).toEqual({
      status: "pending",
      idempotencyKey: "attempt-key-2",
    });
  });

  it("does not depend on physical removal when removeItem always fails", async () => {
    const backing: SharedBacking = new Map();
    const removeItem = vi.fn(async () => {
      throw new Error("native removal unavailable");
    });
    const attempts = createPersistentOrderAttemptStore(
      adapter(backing, { removeItem }),
      "restart-device",
    );
    const first = await attempts.resolve(
      SIGNATURE_A,
      keyFactory("attempt-key-1"),
    );

    await expect(attempts.settle(first)).resolves.toMatchObject({
      storageConcern: {
        code: "STORAGE_UNAVAILABLE",
        retryable: true,
      },
    });
    const second = await attempts.resolve(
      SIGNATURE_A,
      keyFactory("attempt-key-2"),
    );

    expect(second.idempotencyKey).toBe("attempt-key-2");
    expect(removeItem).toHaveBeenCalledTimes(1);
  });

  it("retains a safe in-memory settled state when the settled write fails", async () => {
    const backing: SharedBacking = new Map();
    const failingAdapter = adapter(backing, {
      async setItem(key, value) {
        const next = JSON.parse(value) as { status?: string };
        if (next.status === "settled") {
          throw new Error("native settled write failed");
        }
        backing.set(key, value);
      },
    });
    const firstView = createPersistentOrderAttemptStore(
      failingAdapter,
      "restart-device",
    );
    const first = await firstView.resolve(
      SIGNATURE_A,
      keyFactory("attempt-key-1"),
    );

    const settlement = await firstView.settle(first);
    expect(settlement.storageConcern).toMatchObject({
      code: "STORAGE_UNAVAILABLE",
      retryable: true,
    });

    const freshView = createPersistentOrderAttemptStore(
      adapter(backing),
      "restart-device",
    );
    const second = await freshView.resolve(
      SIGNATURE_A,
      keyFactory("attempt-key-2"),
    );
    expect(second.idempotencyKey).toBe("attempt-key-2");
    expect(record(backing, "attempt-key-2")).toEqual({
      status: "pending",
      idempotencyKey: "attempt-key-2",
    });
  });

  it("reads back a settled barrier when native storage commits and then throws", async () => {
    const backing: SharedBacking = new Map();
    const commitThenThrow = adapter(backing, {
      async setItem(key, value) {
        backing.set(key, value);
        const next = JSON.parse(value) as { status?: string };
        if (next.status === "settled") {
          throw new Error("native response lost after settled commit");
        }
      },
      async removeItem() {
        // Keep the confirmed tombstone so the readback path is observable.
      },
    });
    const firstView = createPersistentOrderAttemptStore(
      commitThenThrow,
      "restart-device",
    );
    const first = await firstView.resolve(
      SIGNATURE_A,
      keyFactory("attempt-key-1"),
    );

    const settlement = await firstView.settle(first);
    expect(settlement.storageConcern).toMatchObject({
      code: "STORAGE_UNAVAILABLE",
      retryable: true,
    });
    expect(record(backing, "attempt-key-1")).toEqual({
      status: "settled",
      idempotencyKey: "attempt-key-1",
    });

    const restartedView = createPersistentOrderAttemptStore(
      adapter(backing),
      "restart-device",
    );
    await expect(
      restartedView.resolve(SIGNATURE_A, keyFactory("attempt-key-2")),
    ).resolves.toMatchObject({ idempotencyKey: "attempt-key-2" });
  });

  it("serializes fresh wrappers by stable scope and ignores an old settlement after a newer attempt", async () => {
    const backing: SharedBacking = new Map();
    const readStarted = Promise.withResolvers<void>();
    const releaseRead = Promise.withResolvers<void>();
    let blockNextRead = false;
    const blockingWrapper = adapter(backing, {
      async getItem(key) {
        const captured = backing.get(key) ?? null;
        if (blockNextRead) {
          blockNextRead = false;
          readStarted.resolve();
          await releaseRead.promise;
        }
        return captured;
      },
    });
    const firstView = createPersistentOrderAttemptStore(
      blockingWrapper,
      "restart-device",
    );
    const freshView = createPersistentOrderAttemptStore(
      adapter(backing),
      "restart-device",
    );
    const oldView = createPersistentOrderAttemptStore(
      adapter(backing),
      "restart-device",
    );
    const first = await firstView.resolve(
      SIGNATURE_A,
      keyFactory("attempt-key-1"),
    );
    blockNextRead = true;

    const settling = firstView.settle(first);
    await readStarted.promise;
    const nextKey = keyFactory("attempt-key-2");
    const nextAttempt = freshView.resolve(SIGNATURE_A, nextKey);
    await Promise.resolve();
    await Promise.resolve();
    expect(nextKey).not.toHaveBeenCalled();

    releaseRead.resolve();
    await expect(settling).resolves.toEqual({ storageConcern: null });
    const second = await nextAttempt;
    expect(second.idempotencyKey).toBe("attempt-key-2");

    await expect(oldView.settle(first)).resolves.toEqual({
      storageConcern: null,
    });
    expect(record(backing, "attempt-key-2")).toEqual({
      status: "pending",
      idempotencyKey: "attempt-key-2",
    });
  });

  it("does not serialize or share records across different subjects", async () => {
    const backing: SharedBacking = new Map();
    const readStarted = Promise.withResolvers<void>();
    const releaseRead = Promise.withResolvers<void>();
    const blockedWrapper = adapter(backing, {
      async getItem(key) {
        const captured = backing.get(key) ?? null;
        readStarted.resolve();
        await releaseRead.promise;
        return captured;
      },
    });
    const subjectA = createPersistentOrderAttemptStore(
      blockedWrapper,
      "subject-a",
    );
    const subjectB = createPersistentOrderAttemptStore(
      adapter(backing),
      "subject-b",
    );

    const pendingA = subjectA.resolve(SIGNATURE_A, keyFactory("key-a"));
    await readStarted.promise;
    await expect(
      subjectB.resolve(SIGNATURE_A, keyFactory("key-b")),
    ).resolves.toMatchObject({ idempotencyKey: "key-b" });

    releaseRead.resolve();
    await expect(pendingA).resolves.toMatchObject({ idempotencyKey: "key-a" });
    expect(record(backing, "key-a")).toEqual({
      status: "pending",
      idempotencyKey: "key-a",
    });
    expect(record(backing, "key-b")).toEqual({
      status: "pending",
      idempotencyKey: "key-b",
    });
  });

  it("holds one process lease across fresh wrappers until the owner releases it", async () => {
    const backing: SharedBacking = new Map();
    const firstView = createPersistentOrderAttemptStore(
      adapter(backing),
      "restart-device",
    );
    const freshView = createPersistentOrderAttemptStore(
      adapter(backing),
      "restart-device",
    );

    const firstLease = await firstView.acquireLease(SIGNATURE_A);
    expect(firstLease).not.toBeNull();
    await expect(freshView.acquireLease(SIGNATURE_A)).resolves.toBeNull();

    firstLease?.release();
    const nextLease = await freshView.acquireLease(SIGNATURE_A);
    expect(nextLease).not.toBeNull();
    nextLease?.release();
  });

  it("derives a bounded canonical storage key for long opaque scopes and signatures", async () => {
    await expect(deriveOrderAttemptStorageKey("abc", "abc")).resolves.toBe(
      "creatorx:order-attempt:v2:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    const key = await deriveOrderAttemptStorageKey(
      `scope:${"한글 / ? #".repeat(200)}`,
      `signature:${"opaque & %".repeat(500)}`,
    );

    expect(key).toMatch(
      /^creatorx:order-attempt:v2:[0-9a-f]{64}:[0-9a-f]{64}$/,
    );
    expect(key.length).toBeLessThanOrEqual(160);
  });
});
