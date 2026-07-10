"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useCreatorXDataClient } from "@/components/runtime/CreatorXDataProvider";
import type { Order, PlaceOrderInput } from "@/lib/data/contracts";
import { CreatorXClientError } from "@/lib/data/errors";
import { useCreatorXSession } from "@/lib/session/CreatorXSessionProvider";

type PendingAttempt = { signature: string; idempotencyKey: string };

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
  const pendingAttempt = useRef<PendingAttempt | null>(null);

  useEffect(() => {
    inFlight.current = false;
    pendingAttempt.current = null;
  }, [client]);

  const submit = useCallback(
    async (input: PlaceOrderInput): Promise<Order | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setIsSubmitting(true);

      const signature = orderSignature(input);
      const idempotencyKey =
        pendingAttempt.current?.signature === signature
          ? pendingAttempt.current.idempotencyKey
          : crypto.randomUUID();
      pendingAttempt.current = { signature, idempotencyKey };

      let order: Order;
      try {
        order = await client.placeOrder(input, { idempotencyKey });
      } catch (error) {
        if (!(error instanceof CreatorXClientError && error.retryable)) {
          pendingAttempt.current = null;
        }
        inFlight.current = false;
        setIsSubmitting(false);
        throw error;
      }

      pendingAttempt.current = null;
      try {
        await session.refresh();
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
