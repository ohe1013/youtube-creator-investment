import "server-only";

import { timingSafeEqual } from "node:crypto";

import { readServerEnv } from "@/lib/config/server-env";
import { ApiError } from "@/lib/server/http/api-error";

export function requireCronSecret(request: Request): void {
  const secret = readServerEnv().cronSecret;
  if (!secret) {
    throw new ApiError(503, "CRON_UNAVAILABLE", "Cron is not configured.", undefined, true);
  }

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  const token = match?.[1];
  if (!token) {
    throw new ApiError(401, "UNAUTHORIZED", "Authentication is required.");
  }

  const tokenBytes = Buffer.from(token);
  const secretBytes = Buffer.from(secret);
  if (
    tokenBytes.byteLength !== secretBytes.byteLength ||
    !timingSafeEqual(tokenBytes, secretBytes)
  ) {
    throw new ApiError(401, "UNAUTHORIZED", "Authentication is required.");
  }
}
