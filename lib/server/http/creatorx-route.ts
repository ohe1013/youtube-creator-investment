import "server-only";

import type { AuthPrincipal } from "@/lib/server/auth/types";
import { ApiError } from "@/lib/server/http/api-error";
import {
  enforceRateLimit,
  type RateLimitDecision,
} from "@/lib/server/http/rate-limit";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,128}$/;

const RATE_LIMIT_OPERATIONS = {
  "place-order": { scope: "trade-place", maxRequests: 10, windowMs: 60_000 },
  "cancel-order": { scope: "trade-cancel", maxRequests: 20, windowMs: 60_000 },
  "portfolio-read": { scope: "portfolio-read", maxRequests: 60, windowMs: 60_000 },
} as const;

export type CreatorXRateLimitOperation = keyof typeof RATE_LIMIT_OPERATIONS;

export function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!IDEMPOTENCY_KEY.test(key)) {
    throw new ApiError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "A valid Idempotency-Key header is required.",
    );
  }
  return key;
}

export async function enforcePrincipalRateLimit(
  principal: AuthPrincipal,
  operation: CreatorXRateLimitOperation,
): Promise<RateLimitDecision> {
  const policy = RATE_LIMIT_OPERATIONS[operation];
  return await enforceRateLimit({
    scope: policy.scope,
    identifier: principal.userId,
    maxRequests: policy.maxRequests,
    windowMs: policy.windowMs,
  });
}

export function rateLimitHeaders(decision: RateLimitDecision): HeadersInit {
  return {
    "RateLimit-Limit": String(decision.limit),
    "RateLimit-Remaining": String(decision.remaining),
    "RateLimit-Reset": decision.resetAt,
  };
}
