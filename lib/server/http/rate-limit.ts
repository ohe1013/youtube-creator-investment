import { createHmac } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { readServerEnv } from "@/lib/config/server-env";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/server/http/api-error";

type RateLimitDatabase = Pick<PrismaClient, "$queryRaw">;

export type RateLimitInput = {
  scope: string;
  identifier: string;
  maxRequests: number;
  windowMs: number;
};

export type RateLimitDecision = {
  allowed: true;
  limit: number;
  remaining: number;
  resetAt: string;
};

type BucketRow = {
  count: number;
  expiresAt: Date;
  databaseNow: Date;
};

function validateInput(input: RateLimitInput) {
  if (!input.scope.trim() || !input.identifier.trim()) {
    throw new TypeError("rate-limit scope and identifier are required");
  }
  if (!Number.isInteger(input.maxRequests) || input.maxRequests <= 0) {
    throw new RangeError("maxRequests must be a positive integer");
  }
  if (!Number.isInteger(input.windowMs) || input.windowMs <= 0) {
    throw new RangeError("windowMs must be a positive integer");
  }
}

export function hashRateLimitKey(
  scope: string,
  identifier: string,
  hashSecret: string,
) {
  if (!hashSecret) throw new Error("rate-limit hashing secret is required");
  return createHmac("sha256", hashSecret)
    .update(`creatorx-rate-limit\0${scope}\0${identifier}`)
    .digest("hex");
}

export async function enforceRateLimit(
  input: RateLimitInput,
  database: RateLimitDatabase = prisma,
): Promise<RateLimitDecision> {
  validateInput(input);
  const hashSecret = readServerEnv().identityPepper;
  if (!hashSecret) {
    throw new Error("rate-limit hashing secret is not configured");
  }
  const keyHash = hashRateLimitKey(input.scope, input.identifier, hashSecret);
  const rows = await database.$queryRaw<BucketRow[]>(Prisma.sql`
    INSERT INTO "RateLimitBucket" ("keyHash", "count", "expiresAt", "updatedAt")
    VALUES (
      ${keyHash},
      1,
      CURRENT_TIMESTAMP + (${input.windowMs} * INTERVAL '1 millisecond'),
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("keyHash") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimitBucket"."expiresAt" <= CURRENT_TIMESTAMP THEN 1
        ELSE "RateLimitBucket"."count" + 1
      END,
      "expiresAt" = CASE
        WHEN "RateLimitBucket"."expiresAt" <= CURRENT_TIMESTAMP
          THEN CURRENT_TIMESTAMP + (${input.windowMs} * INTERVAL '1 millisecond')
        ELSE "RateLimitBucket"."expiresAt"
      END,
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "count", "expiresAt", CURRENT_TIMESTAMP AS "databaseNow"
  `);
  const bucket = rows[0];
  if (!bucket) throw new Error("rate-limit bucket update returned no row");

  const remaining = Math.max(0, input.maxRequests - bucket.count);
  const resetAt = bucket.expiresAt.toISOString();
  if (bucket.count > input.maxRequests) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(
        (bucket.expiresAt.getTime() - bucket.databaseNow.getTime()) / 1000,
      ),
    );
    throw new ApiError(429, "RATE_LIMITED", "요청이 너무 많습니다.", {
      limit: input.maxRequests,
      remaining: 0,
      resetAt,
      retryAfterSeconds,
    });
  }

  return {
    allowed: true,
    limit: input.maxRequests,
    remaining,
    resetAt,
  };
}
