import {
  hasCreatorXSession,
  revokeCreatorXSessionFamily,
} from "@/lib/server/auth/guest-session";
import { requirePrincipal } from "@/lib/server/auth/request-auth";
import { corsPreflight, withApiRoute } from "@/lib/server/http/route-handler";

export const POST = withApiRoute(async (request) => {
  const principal = await requirePrincipal(request);
  if (hasCreatorXSession(principal)) {
    await revokeCreatorXSessionFamily(principal.sessionId);
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
});

export const OPTIONS = corsPreflight;
