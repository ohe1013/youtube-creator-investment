import { z } from "zod";

import { CreatorXClientError } from "@/lib/data/errors";
import type { AsyncKeyValueStore } from "@/lib/storage/client-storage";

const ATTEMPT_KEY_PREFIX = "creatorx:order-attempt:";

const orderAttemptSchema = z
  .object({
    signature: z.string().min(1),
    idempotencyKey: z.string().min(1),
  })
  .strict();

const operationQueues = new WeakMap<
  AsyncKeyValueStore,
  Map<string, Promise<void>>
>();

export type OrderAttempt = z.infer<typeof orderAttemptSchema>;

export interface OrderAttemptStore {
  get(): Promise<OrderAttempt | null>;
  resolve(
    signature: string,
    createIdempotencyKey: () => string,
  ): Promise<OrderAttempt>;
  set(attempt: OrderAttempt): Promise<void>;
  clear(attempt: OrderAttempt): Promise<void>;
}

function storageError(): CreatorXClientError {
  return new CreatorXClientError(
    "STORAGE_UNAVAILABLE",
    "주문 재시도 정보를 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    true,
  );
}

function invalidAttemptError(): CreatorXClientError {
  return new CreatorXClientError(
    "INVALID_RESPONSE",
    "저장된 주문 재시도 정보를 읽을 수 없습니다.",
    true,
  );
}

function sameAttempt(left: OrderAttempt, right: OrderAttempt): boolean {
  return (
    left.signature === right.signature &&
    left.idempotencyKey === right.idempotencyKey
  );
}

function enqueueOperation<T>(
  store: AsyncKeyValueStore,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  let queues = operationQueues.get(store);
  if (queues === undefined) {
    queues = new Map();
    operationQueues.set(store, queues);
  }
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) !== tail) return;
    queues.delete(key);
    if (queues.size === 0) operationQueues.delete(store);
  });
  return result;
}

export function createMemoryOrderAttemptStore(): OrderAttemptStore {
  let current: OrderAttempt | null = null;
  return {
    async get() {
      return current === null ? null : { ...current };
    },
    async resolve(signature, createIdempotencyKey) {
      if (current?.signature === signature) return { ...current };
      current = orderAttemptSchema.parse({
        signature,
        idempotencyKey: createIdempotencyKey(),
      });
      return { ...current };
    },
    async set(attempt) {
      current = orderAttemptSchema.parse(attempt);
    },
    async clear(attempt) {
      if (current !== null && sameAttempt(current, attempt)) current = null;
    },
  };
}

export function createPersistentOrderAttemptStore(
  store: AsyncKeyValueStore,
  namespace: string,
): OrderAttemptStore {
  const key = `${ATTEMPT_KEY_PREFIX}${namespace}`;

  const read = async (): Promise<OrderAttempt | null> => {
    let raw: string | null;
    try {
      raw = await store.getItem(key);
    } catch {
      throw storageError();
    }
    if (raw === null) return null;
    try {
      return orderAttemptSchema.parse(JSON.parse(raw));
    } catch {
      throw invalidAttemptError();
    }
  };

  const write = async (attempt: OrderAttempt): Promise<void> => {
    const parsed = orderAttemptSchema.parse(attempt);
    try {
      await store.setItem(key, JSON.stringify(parsed));
    } catch {
      throw storageError();
    }
  };

  return {
    get() {
      return enqueueOperation(store, key, read);
    },
    resolve(signature, createIdempotencyKey) {
      return enqueueOperation(store, key, async () => {
        const current = await read();
        if (current?.signature === signature) return current;
        const attempt = orderAttemptSchema.parse({
          signature,
          idempotencyKey: createIdempotencyKey(),
        });
        await write(attempt);
        return attempt;
      });
    },
    set(attempt) {
      return enqueueOperation(store, key, () => write(attempt));
    },
    clear(attempt) {
      return enqueueOperation(store, key, async () => {
        const current = await read();
        if (current === null || !sameAttempt(current, attempt)) return;
        try {
          await store.removeItem(key);
        } catch {
          throw storageError();
        }
      });
    },
  };
}
