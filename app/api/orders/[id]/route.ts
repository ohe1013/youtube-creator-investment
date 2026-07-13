import { requirePrincipal } from "@/lib/server/auth/request-auth";
import {
  enforcePrincipalRateLimit,
  rateLimitHeaders,
  requireIdempotencyKey,
} from "@/lib/server/http/creatorx-route";
import { corsPreflight, withApiRoute } from "@/lib/server/http/route-handler";
import { cancelOrder } from "@/lib/server/trading/matching-service";

type RouteContext = { params: Promise<{ id: string }> };

export const DELETE = withApiRoute<RouteContext>(
  async (request, { params, requestId }) => {
    const principal = await requirePrincipal(request);
    const rateLimit = await enforcePrincipalRateLimit(principal, "cancel-order");
    const idempotencyKey = requireIdempotencyKey(request);
    const { id } = await params;
    const result = await cancelOrder(principal, id, idempotencyKey);
    return Response.json(result, {
      status: result.responseStatus,
      headers: {
        ...rateLimitHeaders(rateLimit),
        "x-request-id": requestId,
      },
    });
  },
);

export const OPTIONS = corsPreflight;
