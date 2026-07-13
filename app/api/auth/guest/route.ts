import { createGuestSessionRequestSchema } from "@/lib/contracts/session";
import {
  assertGuestSessionsAllowed,
  createGuestSession,
} from "@/lib/server/auth/providers/guest";
import { ApiError } from "@/lib/server/http/api-error";
import { corsPreflight, withApiRoute } from "@/lib/server/http/route-handler";

async function readGuestRequest(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = createGuestSessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, "INVALID_REQUEST", "anonymousKey is required.");
  }
  return parsed.data;
}

export const POST = withApiRoute(async (request) => {
  assertGuestSessionsAllowed();
  const { anonymousKey } = await readGuestRequest(request);
  const tokens = await createGuestSession(anonymousKey);
  return Response.json(tokens, {
    status: 201,
    headers: { "cache-control": "no-store" },
  });
});

export const OPTIONS = corsPreflight;
