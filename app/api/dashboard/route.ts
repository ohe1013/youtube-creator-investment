import { Prisma } from "@prisma/client";

import { serializeDecimal } from "@/lib/contracts/decimal";
import { prisma } from "@/lib/prisma";
import { resolveOptionalRequestPrincipal } from "@/lib/server/auth/request-auth";
import { corsPreflight, withApiRoute } from "@/lib/server/http/route-handler";

export const dynamic = "force-dynamic";

const ZERO = new Prisma.Decimal(0);

function sumDecimals(values: Iterable<Prisma.Decimal>) {
  let total = ZERO;
  for (const value of values) total = total.plus(value);
  return total;
}

export const GET = withApiRoute(async (request) => {
  const principal = await resolveOptionalRequestPrincipal(request);
  const publicCreatorWhere = { isActive: true, visibility: "PUBLIC" } as const;

  const totalCreators = await prisma.creator.count({ where: publicCreatorWhere });
  const activeCreators = await prisma.creator.findMany({
    where: publicCreatorWhere,
    select: { currentPrice: true, circulatingSupply: true },
  });
  const totalMarketCap = sumDecimals(
    activeCreators.map((creator) =>
      creator.currentPrice.mul(creator.circulatingSupply),
    ),
  );

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const last24hExecutions = await prisma.tradeExecution.findMany({
    where: { executedAt: { gte: oneDayAgo } },
    select: { quoteAmount: true },
  });
  const totalVolume24h = sumDecimals(
    last24hExecutions.map((execution) => execution.quoteAmount),
  );

  const topRankings = await prisma.creator.findMany({
    where: publicCreatorWhere,
    orderBy: { currentScore: "desc" },
    take: 10,
    select: {
      id: true,
      name: true,
      thumbnailUrl: true,
      currentPrice: true,
      currentScore: true,
      category: true,
      circulatingSupply: true,
    },
  });
  const newListings = await prisma.creator.findMany({
    where: publicCreatorWhere,
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      name: true,
      thumbnailUrl: true,
      currentPrice: true,
      createdAt: true,
    },
  });

  let userSnapshot: {
    balance: ReturnType<typeof serializeDecimal>;
    portfolioValue: ReturnType<typeof serializeDecimal>;
    totalAssets: ReturnType<typeof serializeDecimal>;
    topHolding: string | null;
  } | null = null;
  if (principal) {
    const user = await prisma.user.findUnique({
      where: { id: principal.userId },
      include: {
        positions: {
          include: { creator: { select: { currentPrice: true, name: true } } },
          orderBy: { quantity: "desc" },
        },
      },
    });
    if (user) {
      const portfolioValue = sumDecimals(
        user.positions.map((position) =>
          position.quantity.mul(position.creator.currentPrice),
        ),
      );
      userSnapshot = {
        balance: serializeDecimal(user.balance),
        portfolioValue: serializeDecimal(portfolioValue),
        totalAssets: serializeDecimal(user.balance.plus(portfolioValue)),
        topHolding: user.positions[0]?.creator.name ?? null,
      };
    }
  }

  return Response.json({
    stats: {
      totalMarketCap: serializeDecimal(totalMarketCap),
      totalVolume24h: serializeDecimal(totalVolume24h),
      totalCreators,
      activeTraders: 124,
    },
    rankings: topRankings.map((ranking) => ({
      ...ranking,
      currentPrice: serializeDecimal(ranking.currentPrice),
      circulatingSupply: serializeDecimal(ranking.circulatingSupply),
      marketCap: serializeDecimal(
        ranking.currentPrice.mul(ranking.circulatingSupply),
      ),
    })),
    newListings: newListings.map((creator) => ({
      ...creator,
      currentPrice: serializeDecimal(creator.currentPrice),
      createdAt: creator.createdAt.toISOString(),
    })),
    user: userSnapshot,
  });
});

export const OPTIONS = corsPreflight;
