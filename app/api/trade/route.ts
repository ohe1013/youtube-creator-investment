import { placeOrderRequestSchema } from "@/lib/contracts/trading";
import { requirePrincipal } from "@/lib/server/auth/request-auth";
import {
  enforcePrincipalRateLimit,
  rateLimitHeaders,
  requireIdempotencyKey,
} from "@/lib/server/http/creatorx-route";
import { ApiError } from "@/lib/server/http/api-error";
import { corsPreflight, withApiRoute } from "@/lib/server/http/route-handler";
import { placeOrder } from "@/lib/server/trading/matching-service";

export const POST = withApiRoute(async (request, { requestId }) => {
  const principal = await requirePrincipal(request);
  const rateLimit = await enforcePrincipalRateLimit(principal, "place-order");
  const idempotencyKey = requireIdempotencyKey(request);
  const body = await request.json().catch(() => null);
  const parsed = placeOrderRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, "INVALID_ORDER_INPUT", "The order input is invalid.");
  }

  const result = await placeOrder(principal, parsed.data, idempotencyKey);
  return Response.json(result, {
    status: result.responseStatus,
    headers: {
      ...rateLimitHeaders(rateLimit),
      "x-request-id": requestId,
    },
  });
});

export const OPTIONS = corsPreflight;
