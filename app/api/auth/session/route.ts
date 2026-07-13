import { requirePrincipal } from "@/lib/server/auth/request-auth";
import { corsPreflight, withApiRoute } from "@/lib/server/http/route-handler";

export const GET = withApiRoute(async (request) => {
  const principal = await requirePrincipal(request);
  return Response.json(
    { principal },
    { headers: { "cache-control": "no-store" } },
  );
});

export const OPTIONS = corsPreflight;
