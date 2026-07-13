import { executeBotTrade } from "@/lib/bot-manager";
import { requireCronSecret } from "@/lib/server/http/cron-auth";
import { corsPreflight, withApiRoute } from "@/lib/server/http/route-handler";

export const POST = withApiRoute(async (request) => {
  requireCronSecret(request);

  const tradeCount = Math.floor(Math.random() * 5) + 1;
  for (let index = 0; index < tradeCount; index += 1) {
    await executeBotTrade();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return Response.json({
    message: "Bot activity triggered successfully",
    tradeCount,
  });
});

export const OPTIONS = corsPreflight;
