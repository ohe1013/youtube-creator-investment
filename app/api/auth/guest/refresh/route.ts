import { refreshCreatorXSessionRequestSchema } from "@/lib/contracts/session";
import {
  assertGuestSessionsAllowed,
  refreshCreatorXSession,
} from "@/lib/server/auth/providers/guest";
import { ApiError } from "@/lib/server/http/api-error";
import { corsPreflight, withApiRoute } from "@/lib/server/http/route-handler";

async function readRefreshRequest(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = refreshCreatorXSessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, "INVALID_REQUEST", "refreshToken is required.");
  }
  return parsed.data;
}

export const POST = withApiRoute(async (request) => {
  assertGuestSessionsAllowed();
  const { refreshToken } = await readRefreshRequest(request);
  const tokens = await refreshCreatorXSession(refreshToken);
  return Response.json(tokens, {
    headers: { "cache-control": "no-store" },
  });
});

export const OPTIONS = corsPreflight;
