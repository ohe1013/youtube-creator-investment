import { z } from "zod";

import { CreatorXClientError } from "@/lib/data/errors";
import type { AsyncKeyValueStore } from "@/lib/storage/client-storage";

const ATTEMPT_KEY_PREFIX = "creatorx:order-attempt:v2:";

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b,
  0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7,
  0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152,
  0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const orderAttemptSchema = z
  .object({
    signature: z.string().min(1),
    idempotencyKey: z.string().min(1),
  })
  .strict();

const persistedAttemptSchema = z
  .object({
    status: z.enum(["pending", "settled"]),
    idempotencyKey: z.string().min(1),
  })
  .strict();

type PersistedAttempt = z.infer<typeof persistedAttemptSchema>;

const operationQueues = new Map<string, Promise<void>>();
const activeLeases = new Set<string>();
const volatileSettledKeys = new Map<string, string>();

export type OrderAttempt = z.infer<typeof orderAttemptSchema>;

export type OrderAttemptSettlement = {
  storageConcern: CreatorXClientError | null;
};

export interface OrderSubmissionLease {
  release(): void;
}

export interface OrderAttemptStore {
  acquireLease(signature: string): Promise<OrderSubmissionLease | null>;
  resolve(
    signature: string,
    createIdempotencyKey: () => string,
  ): Promise<OrderAttempt>;
  settle(attempt: OrderAttempt): Promise<OrderAttemptSettlement>;
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Hex(value: string): string {
  const input = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = input.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f,
    0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15] ?? 0;
      const right = words[index - 2] ?? 0;
      const sigma0 =
        rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 =
        rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] =
        ((words[index - 16] ?? 0) +
          sigma0 +
          (words[index - 7] ?? 0) +
          sigma1) >>>
        0;
    }

    let a = hash[0] ?? 0;
    let b = hash[1] ?? 0;
    let c = hash[2] ?? 0;
    let d = hash[3] ?? 0;
    let e = hash[4] ?? 0;
    let f = hash[5] ?? 0;
    let g = hash[6] ?? 0;
    let h = hash[7] ?? 0;

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 =
        (h +
          sum1 +
          choice +
          (SHA256_CONSTANTS[index] ?? 0) +
          (words[index] ?? 0)) >>>
        0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = ((hash[0] ?? 0) + a) >>> 0;
    hash[1] = ((hash[1] ?? 0) + b) >>> 0;
    hash[2] = ((hash[2] ?? 0) + c) >>> 0;
    hash[3] = ((hash[3] ?? 0) + d) >>> 0;
    hash[4] = ((hash[4] ?? 0) + e) >>> 0;
    hash[5] = ((hash[5] ?? 0) + f) >>> 0;
    hash[6] = ((hash[6] ?? 0) + g) >>> 0;
    hash[7] = ((hash[7] ?? 0) + h) >>> 0;
  }

  return [...hash]
    .map((part) => part.toString(16).padStart(8, "0"))
    .join("");
}

export async function deriveOrderAttemptStorageKey(
  scope: string,
  signature: string,
): Promise<string> {
  return `${ATTEMPT_KEY_PREFIX}${sha256Hex(scope)}:${sha256Hex(signature)}`;
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

function storageConcern(error: unknown): CreatorXClientError {
  return error instanceof CreatorXClientError ? error : storageError();
}

function enqueueOperation<T>(
  logicalKey: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = operationQueues.get(logicalKey) ?? Promise.resolve();
  const result = previous.then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  operationQueues.set(logicalKey, tail);
  void tail.then(() => {
    if (operationQueues.get(logicalKey) === tail) {
      operationQueues.delete(logicalKey);
    }
  });
  return result;
}

function createLease(logicalKey: string): OrderSubmissionLease | null {
  if (activeLeases.has(logicalKey)) return null;
  activeLeases.add(logicalKey);
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      activeLeases.delete(logicalKey);
    },
  };
}

function attempt(signature: string, idempotencyKey: string): OrderAttempt {
  return orderAttemptSchema.parse({ signature, idempotencyKey });
}

type SettlementRecordState =
  | "absent"
  | "different"
  | "exact-pending"
  | "exact-settled";

function settlementRecordState(
  record: PersistedAttempt | null,
  idempotencyKey: string,
): SettlementRecordState {
  if (record === null) return "absent";
  if (record.idempotencyKey !== idempotencyKey) return "different";
  return record.status === "settled" ? "exact-settled" : "exact-pending";
}

export function createMemoryOrderAttemptStore(): OrderAttemptStore {
  const records = new Map<string, PersistedAttempt>();
  const leases = new Set<string>();
  return {
    async acquireLease(signature) {
      if (leases.has(signature)) return null;
      leases.add(signature);
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          leases.delete(signature);
        },
      };
    },
    async resolve(signature, createIdempotencyKey) {
      const current = records.get(signature);
      if (current?.status === "pending") {
        return attempt(signature, current.idempotencyKey);
      }
      const next = attempt(signature, createIdempotencyKey());
      records.set(signature, {
        status: "pending",
        idempotencyKey: next.idempotencyKey,
      });
      return next;
    },
    async settle(expected) {
      const current = records.get(expected.signature);
      if (
        current?.status === "pending" &&
        current.idempotencyKey === expected.idempotencyKey
      ) {
        records.set(expected.signature, {
          status: "settled",
          idempotencyKey: expected.idempotencyKey,
        });
      }
      return { storageConcern: null };
    },
  };
}

export function createPersistentOrderAttemptStore(
  store: AsyncKeyValueStore,
  namespace: string,
): OrderAttemptStore {
  const scope = z.string().min(1).parse(namespace);
  const storageKeys = new Map<string, Promise<string>>();
  const keyFor = (signature: string) => {
    const parsed = z.string().min(1).parse(signature);
    let key = storageKeys.get(parsed);
    if (key === undefined) {
      key = deriveOrderAttemptStorageKey(scope, parsed);
      storageKeys.set(parsed, key);
    }
    return key;
  };

  const read = async (key: string): Promise<PersistedAttempt | null> => {
    let raw: string | null;
    try {
      raw = await store.getItem(key);
    } catch {
      throw storageError();
    }
    if (raw === null) return null;
    try {
      return persistedAttemptSchema.parse(JSON.parse(raw));
    } catch {
      throw invalidAttemptError();
    }
  };

  const write = async (key: string, value: PersistedAttempt): Promise<void> => {
    const parsed = persistedAttemptSchema.parse(value);
    try {
      await store.setItem(key, JSON.stringify(parsed));
    } catch {
      throw storageError();
    }
  };

  const remove = async (key: string): Promise<void> => {
    try {
      await store.removeItem(key);
    } catch {
      throw storageError();
    }
  };

  return {
    async acquireLease(signature) {
      return createLease(await keyFor(signature));
    },
    async resolve(signature, createIdempotencyKey) {
      const key = await keyFor(signature);
      return await enqueueOperation(key, async () => {
        const current = await read(key);
        const volatileSettled = volatileSettledKeys.get(key);
        if (
          volatileSettled !== undefined &&
          current?.status === "pending" &&
          current.idempotencyKey !== volatileSettled
        ) {
          volatileSettledKeys.delete(key);
          return attempt(signature, current.idempotencyKey);
        }
        if (volatileSettled === undefined && current?.status === "pending") {
          return attempt(signature, current.idempotencyKey);
        }

        const next = attempt(signature, createIdempotencyKey());
        const pending: PersistedAttempt = {
          status: "pending",
          idempotencyKey: next.idempotencyKey,
        };
        try {
          await write(key, pending);
        } catch (error) {
          let committed = false;
          try {
            const stored = await read(key);
            committed =
              stored?.status === "pending" &&
              stored.idempotencyKey === next.idempotencyKey;
          } catch {
            // Preserve the original storage failure when readback is unavailable.
          }
          if (!committed) throw error;
        }
        volatileSettledKeys.delete(key);
        return next;
      });
    },
    async settle(expected) {
      let key: string;
      try {
        key = await keyFor(expected.signature);
      } catch (error) {
        return { storageConcern: storageConcern(error) };
      }
      return await enqueueOperation(key, async () => {
        let current: PersistedAttempt | null;
        try {
          current = await read(key);
        } catch (error) {
          volatileSettledKeys.set(key, expected.idempotencyKey);
          return { storageConcern: storageConcern(error) };
        }
        const initialState = settlementRecordState(
          current,
          expected.idempotencyKey,
        );
        if (initialState === "absent" || initialState === "different") {
          return { storageConcern: null };
        }

        let concern: CreatorXClientError | null = null;
        let durableBarrier = initialState === "exact-settled";
        let lastReadState: SettlementRecordState = initialState;

        if (!durableBarrier) {
          for (let writeAttempt = 0; writeAttempt < 2; writeAttempt += 1) {
            try {
              await write(key, {
                status: "settled",
                idempotencyKey: expected.idempotencyKey,
              });
              durableBarrier = true;
              break;
            } catch (error) {
              concern ??= storageConcern(error);
              try {
                lastReadState = settlementRecordState(
                  await read(key),
                  expected.idempotencyKey,
                );
              } catch (readError) {
                volatileSettledKeys.set(key, expected.idempotencyKey);
                concern ??= storageConcern(readError);
                return { storageConcern: concern };
              }
              if (lastReadState === "exact-settled") {
                durableBarrier = true;
                break;
              }
              if (lastReadState === "absent") {
                volatileSettledKeys.delete(key);
                return { storageConcern: concern };
              }
              if (lastReadState === "different") {
                return { storageConcern: concern };
              }
            }
          }

          if (!durableBarrier) {
            try {
              lastReadState = settlementRecordState(
                await read(key),
                expected.idempotencyKey,
              );
            } catch (error) {
              volatileSettledKeys.set(key, expected.idempotencyKey);
              concern ??= storageConcern(error);
              return { storageConcern: concern };
            }
            if (lastReadState === "exact-settled") {
              durableBarrier = true;
            } else if (lastReadState === "absent") {
              volatileSettledKeys.delete(key);
              return { storageConcern: concern };
            } else if (lastReadState === "different") {
              return { storageConcern: concern };
            } else {
              try {
                await remove(key);
              } catch (error) {
                volatileSettledKeys.set(key, expected.idempotencyKey);
                concern ??= storageConcern(error);
                return { storageConcern: concern };
              }
              try {
                lastReadState = settlementRecordState(
                  await read(key),
                  expected.idempotencyKey,
                );
              } catch (error) {
                volatileSettledKeys.set(key, expected.idempotencyKey);
                concern ??= storageConcern(error);
                return { storageConcern: concern };
              }
              if (
                lastReadState === "absent" ||
                lastReadState === "exact-settled"
              ) {
                volatileSettledKeys.delete(key);
              } else if (lastReadState === "exact-pending") {
                volatileSettledKeys.set(key, expected.idempotencyKey);
                concern ??= storageError();
              }
              return { storageConcern: concern };
            }
          }
        }

        volatileSettledKeys.delete(key);
        try {
          await remove(key);
        } catch (error) {
          concern ??= storageConcern(error);
          return { storageConcern: concern };
        }
        try {
          lastReadState = settlementRecordState(
            await read(key),
            expected.idempotencyKey,
          );
        } catch (error) {
          concern ??= storageConcern(error);
          return { storageConcern: concern };
        }
        if (lastReadState === "exact-pending") {
          volatileSettledKeys.set(key, expected.idempotencyKey);
          concern ??= storageError();
        }
        return { storageConcern: concern };
      });
    },
  };
}
