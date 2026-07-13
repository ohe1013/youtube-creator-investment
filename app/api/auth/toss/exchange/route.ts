import { z } from "zod";

import { createTossSession } from "@/lib/server/auth/providers/toss";
import { ApiError } from "@/lib/server/http/api-error";
import { corsPreflight, withApiRoute } from "@/lib/server/http/route-handler";

export const runtime = "nodejs";

const requestSchema = z
  .object({
    authorizationCode: z.string().trim().min(1).max(4096),
    referrer: z.enum(["DEFAULT", "SANDBOX"]),
  })
  .strip();

async function readExchangeRequest(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, "INVALID_REQUEST", "A Toss authorization code is required.");
  }
  return parsed.data;
}

export const POST = withApiRoute(async (request) => {
  const input = await readExchangeRequest(request);
  const tokens = await createTossSession(input);
  return Response.json(tokens, {
    status: 201,
    headers: { "cache-control": "no-store" },
  });
});

export const OPTIONS = corsPreflight;
