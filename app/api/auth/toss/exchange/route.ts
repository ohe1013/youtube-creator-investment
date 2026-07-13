import { isIP } from "node:net";
import { z } from "zod";

import { readServerEnv } from "@/lib/config/server-env";
import { createTossSession } from "@/lib/server/auth/providers/toss";
import { ApiError } from "@/lib/server/http/api-error";
import { enforceRateLimit } from "@/lib/server/http/rate-limit";
import { corsPreflight, withApiRoute } from "@/lib/server/http/route-handler";

export const runtime = "nodejs";

const requestSchema = z
  .object({
    authorizationCode: z.string().trim().min(1).max(4096),
    referrer: z.enum(["DEFAULT", "SANDBOX"]),
  })
  .strip();

const TOSS_EXCHANGE_RATE_LIMIT = {
  scope: "toss-login-exchange",
  maxRequests: 5,
  windowMs: 60_000,
} as const;
const ANONYMOUS_RATE_LIMIT_IDENTIFIER = "anonymous";
const MAX_FORWARDED_FOR_HEADER_LENGTH = 256;
const MAX_IP_ADDRESS_LENGTH = 45;

async function readExchangeRequest(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, "INVALID_REQUEST", "A Toss authorization code is required.");
  }
  return parsed.data;
}

function readRateLimitIdentifier(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (
    !readServerEnv().trustForwardedProto ||
    !forwardedFor ||
    forwardedFor.length > MAX_FORWARDED_FOR_HEADER_LENGTH
  ) {
    return ANONYMOUS_RATE_LIMIT_IDENTIFIER;
  }

  const firstSeparator = forwardedFor.indexOf(",");
  const firstForwardedFor =
    firstSeparator === -1
      ? forwardedFor
      : forwardedFor.slice(0, firstSeparator);
  const candidate = firstForwardedFor.trim();
  if (
    !candidate ||
    candidate.length > MAX_IP_ADDRESS_LENGTH ||
    isIP(candidate) === 0
  ) {
    return ANONYMOUS_RATE_LIMIT_IDENTIFIER;
  }
  return candidate.toLowerCase();
}

export const POST = withApiRoute(async (request) => {
  const input = await readExchangeRequest(request);
  await enforceRateLimit({
    ...TOSS_EXCHANGE_RATE_LIMIT,
    identifier: readRateLimitIdentifier(request),
  });
  const tokens = await createTossSession(input);
  return Response.json(tokens, {
    status: 201,
    headers: { "cache-control": "no-store" },
  });
});

export const OPTIONS = corsPreflight;
