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
import { CreatorXClientError } from "@/lib/data/errors";
import {
  createMemoryOrderAttemptStore,
  type OrderAttemptStore,
} from "@/lib/orders/order-attempt-store";
import { useCreatorXSession } from "@/lib/session/CreatorXSessionProvider";

const memoryAttempts = new WeakMap<CreatorXDataClient, OrderAttemptStore>();
const inFlightSignatures = new WeakMap<CreatorXDataClient, Set<string>>();

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
    input.price,
    input.quantity,
  ]);
}

function acquireSubmission(client: CreatorXDataClient, signature: string): boolean {
  let signatures = inFlightSignatures.get(client);
  if (signatures === undefined) {
    signatures = new Set();
    inFlightSignatures.set(client, signatures);
  }
  if (signatures.has(signature)) return false;
  signatures.add(signature);
  return true;
}

function releaseSubmission(client: CreatorXDataClient, signature: string): void {
  const signatures = inFlightSignatures.get(client);
  if (signatures === undefined) return;
  signatures.delete(signature);
  if (signatures.size === 0) inFlightSignatures.delete(client);
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

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = useCallback(
    async (input: PlaceOrderInput): Promise<Order | null> => {
      const signature = orderSignature(input);
      if (!acquireSubmission(client, signature)) return null;
      if (mounted.current) setIsSubmitting(true);

      const attempts = persistentAttempts ?? memoryAttemptsFor(client);

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
          if (!(error instanceof CreatorXClientError && error.retryable)) {
            await attempts.clear(attempt).catch(() => undefined);
          }
          throw error;
        }

        await attempts.clear(attempt).catch(() => undefined);
        await session.refresh().catch(() => undefined);
        return order;
      } finally {
        releaseSubmission(client, signature);
        if (mounted.current) setIsSubmitting(false);
      }
    },
    [client, persistentAttempts, session],
  );

  return { isSubmitting, submit };
}
