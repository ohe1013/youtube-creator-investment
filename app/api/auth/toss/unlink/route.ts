import { unlinkCurrentTossSession } from "@/lib/server/auth/providers/toss";
import { requirePrincipal } from "@/lib/server/auth/request-auth";
import { corsPreflight, withApiRoute } from "@/lib/server/http/route-handler";

export const runtime = "nodejs";

/** Revokes the current local CreatorX Toss session; it does not call Toss APIs. */
export const POST = withApiRoute(async (request) => {
  const principal = await requirePrincipal(request);
  await unlinkCurrentTossSession(principal);
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
});

export const OPTIONS = corsPreflight;
