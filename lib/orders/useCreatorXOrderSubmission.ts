"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  useCreatorXDataClient,
  useCreatorXOrderAttemptStore,
} from "@/components/runtime/CreatorXDataProvider";
import type {
  CreatorXDataClient,
  Order,
  PlaceOrderInput,
} from "@/lib/data/contracts";
import {
  CreatorXClientError,
  type CreatorXErrorCode,
} from "@/lib/data/errors";
import {
  createMemoryOrderAttemptStore,
  type OrderAttemptSettlement,
  type OrderAttemptStore,
} from "@/lib/orders/order-attempt-store";
import { useCreatorXSession } from "@/lib/session/CreatorXSessionProvider";

const memoryAttempts = new WeakMap<CreatorXDataClient, OrderAttemptStore>();
const DEFINITIVE_REJECTION_CODES = new Set<CreatorXErrorCode>([
  "REQUEST_REJECTED",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "INSUFFICIENT_BALANCE",
  "INSUFFICIENT_SHARES",
  "ORDER_NOT_FOUND",
  "IDEMPOTENCY_KEY_REUSED",
]);

function memoryAttemptsFor(client: CreatorXDataClient): OrderAttemptStore {
  let attempts = memoryAttempts.get(client);
  if (attempts === undefined) {
    attempts = createMemoryOrderAttemptStore();
    memoryAttempts.set(client, attempts);
  }
  return attempts;
}

function orderSignature(input: PlaceOrderInput): string {
  return JSON.stringify([
    input.creatorId,
    input.side,
    input.orderType,
    input.quantity,
    input.orderType === "LIMIT" ? input.limitPrice : input.maxSlippageBps ?? null,
  ]);
}

function isDefinitiveRejection(error: unknown): error is CreatorXClientError {
  return (
    error instanceof CreatorXClientError &&
    DEFINITIVE_REJECTION_CODES.has(error.code)
  );
}

function reportSettlementConcern(
  message: string,
  settlement: OrderAttemptSettlement,
): void {
  if (settlement.storageConcern !== null) {
    console.error(message, settlement.storageConcern);
  }
}

export function useCreatorXOrderSubmission(): {
  isSubmitting: boolean;
  submit(input: PlaceOrderInput): Promise<Order | null>;
} {
  const client = useCreatorXDataClient();
  const persistentAttempts = useCreatorXOrderAttemptStore();
  const session = useCreatorXSession();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const mounted = useRef(true);
  const activeCount = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = useCallback(
    async (input: PlaceOrderInput): Promise<Order | null> => {
      const signature = orderSignature(input);
      const attempts = persistentAttempts ?? memoryAttemptsFor(client);
      const lease = await attempts.acquireLease(signature);
      if (lease === null) return null;
      activeCount.current += 1;
      if (mounted.current) setIsSubmitting(true);

      try {
        const attempt = await attempts.resolve(signature, () =>
          crypto.randomUUID(),
        );

        let order: Order;
        try {
          order = await client.placeOrder(input, {
            idempotencyKey: attempt.idempotencyKey,
          });
        } catch (error) {
          if (isDefinitiveRejection(error)) {
            reportSettlementConcern(
              "CreatorX definitive order rejection was not persisted",
              await attempts.settle(attempt),
            );
          }
          throw error;
        }

        reportSettlementConcern(
          "CreatorX order was accepted, but attempt settlement was not persisted",
          await attempts.settle(attempt),
        );
        await session.refresh().catch(() => undefined);
        return order;
      } finally {
        lease.release();
        activeCount.current = Math.max(0, activeCount.current - 1);
        if (mounted.current) setIsSubmitting(activeCount.current > 0);
      }
    },
    [client, persistentAttempts, session],
  );

  return { isSubmitting, submit };
}
