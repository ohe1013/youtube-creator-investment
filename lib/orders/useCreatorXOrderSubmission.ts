"use client";

import { useCallback, useRef, useState } from "react";

import { useCreatorXDataClient } from "@/components/runtime/CreatorXDataProvider";
import type {
  CreatorXDataClient,
  Order,
  PlaceOrderInput,
} from "@/lib/data/contracts";
import { CreatorXClientError } from "@/lib/data/errors";
import { useCreatorXSession } from "@/lib/session/CreatorXSessionProvider";

const ambiguousAttempts = new WeakMap<CreatorXDataClient, Map<string, string>>();

function attemptsFor(client: CreatorXDataClient): Map<string, string> {
  let attempts = ambiguousAttempts.get(client);
  if (attempts === undefined) {
    attempts = new Map();
    ambiguousAttempts.set(client, attempts);
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

export function useCreatorXOrderSubmission(): {
  isSubmitting: boolean;
  submit(input: PlaceOrderInput): Promise<Order | null>;
} {
  const client = useCreatorXDataClient();
  const session = useCreatorXSession();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inFlight = useRef(false);

  const submit = useCallback(
    async (input: PlaceOrderInput): Promise<Order | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setIsSubmitting(true);

      const signature = orderSignature(input);
      const attempts = attemptsFor(client);
      const idempotencyKey = attempts.get(signature) ?? crypto.randomUUID();
      attempts.set(signature, idempotencyKey);

      let order: Order;
      try {
        order = await client.placeOrder(input, { idempotencyKey });
      } catch (error) {
        if (!(error instanceof CreatorXClientError && error.retryable)) {
          attempts.delete(signature);
        }
        inFlight.current = false;
        setIsSubmitting(false);
        throw error;
      }

      attempts.delete(signature);
      try {
        await session.refresh().catch(() => undefined);
        return order;
      } finally {
        inFlight.current = false;
        setIsSubmitting(false);
      }
    },
    [client, session],
  );

  return { isSubmitting, submit };
}
