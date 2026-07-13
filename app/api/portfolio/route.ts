import { requirePrincipal } from "@/lib/server/auth/request-auth";
import {
  enforcePrincipalRateLimit,
  rateLimitHeaders,
} from "@/lib/server/http/creatorx-route";
import { corsPreflight, withApiRoute } from "@/lib/server/http/route-handler";
import { getPortfolio } from "@/lib/server/trading/portfolio-service";

export const dynamic = "force-dynamic";

export const GET = withApiRoute(async (request, { requestId }) => {
  const principal = await requirePrincipal(request);
  const rateLimit = await enforcePrincipalRateLimit(principal, "portfolio-read");
  const portfolio = await getPortfolio(principal);
  return Response.json(portfolio, {
    headers: {
      ...rateLimitHeaders(rateLimit),
      "x-request-id": requestId,
    },
  });
});

export const OPTIONS = corsPreflight;
