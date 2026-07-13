import { Prisma } from "@prisma/client";

import { serializeQuantity, serializeQuote } from "@/lib/contracts/trading";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/server/http/api-error";
import { corsPreflight, withApiRoute } from "@/lib/server/http/route-handler";

type RouteContext = { params: Promise<{ id: string }> };

function readDays(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const days = Number(value);
  if (!Number.isInteger(days) || days <= 0 || days > 3650) {
    throw new ApiError(400, "INVALID_REQUEST", "days must be a positive integer.");
  }
  return days;
}

function since(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

function addLevel(
  levels: Map<string, { price: Prisma.Decimal; quantity: Prisma.Decimal }>,
  price: Prisma.Decimal,
  quantity: Prisma.Decimal,
) {
  const key = serializeQuote(price);
  const existing = levels.get(key);
  if (existing) {
    existing.quantity = existing.quantity.plus(quantity);
    return;
  }
  levels.set(key, { price, quantity });
}

export const GET = withApiRoute<RouteContext>(
  async (request, { params }) => {
    const { id } = await params;
    const searchParams = new URL(request.url).searchParams;
    const publicCreator = await prisma.creator.findFirst({
      where: { id, isActive: true, visibility: "PUBLIC" },
      select: { initialPrice: true },
    });
    if (!publicCreator) {
      throw new ApiError(404, "CREATOR_NOT_FOUND", "Creator was not found.");
    }

    if (searchParams.get("orderbook") === "true") {
      const orders = await prisma.order.findMany({
        where: { creatorId: id, status: { in: ["OPEN", "PARTIAL"] } },
        select: { type: true, price: true, quantity: true, filled: true },
      });
      const asks = new Map<string, { price: Prisma.Decimal; quantity: Prisma.Decimal }>();
      const bids = new Map<string, { price: Prisma.Decimal; quantity: Prisma.Decimal }>();
      for (const order of orders) {
        const remaining = order.quantity.minus(order.filled);
        if (!remaining.greaterThan(0)) continue;
        addLevel(order.type === "SELL" ? asks : bids, order.price, remaining);
      }
      const serializeLevels = (levels: Map<string, { price: Prisma.Decimal; quantity: Prisma.Decimal }>, descending: boolean) =>
        [...levels.values()]
          .sort((left, right) => descending ? right.price.comparedTo(left.price) : left.price.comparedTo(right.price))
          .map((level) => ({
            price: serializeQuote(level.price),
            quantity: serializeQuantity(level.quantity),
          }));
      return Response.json({
        asks: serializeLevels(asks, false),
        bids: serializeLevels(bids, true),
      });
    }

    if (searchParams.get("history") === "true") {
      const executions = await prisma.tradeExecution.findMany({
        where: { creatorId: id, executedAt: { gte: since(readDays(searchParams.get("days"), 7)) } },
        orderBy: [{ executedAt: "asc" }, { id: "asc" }],
        select: { executedAt: true, price: true, quoteAmount: true },
      });
      if (executions.length > 0) {
        return Response.json({
          history: executions.map((execution) => ({
            date: execution.executedAt.toISOString(),
            price: serializeQuote(execution.price),
            volume: serializeQuote(execution.quoteAmount),
          })),
        });
      }
      return Response.json({
        history: [{
          date: new Date().toISOString(),
          price: serializeQuote(publicCreator.initialPrice),
          volume: "0.0000",
        }],
      });
    }

    if (searchParams.get("trades") === "true") {
      const executions = await prisma.tradeExecution.findMany({
        where: { creatorId: id },
        orderBy: [{ executedAt: "desc" }, { id: "desc" }],
        take: 50,
        select: {
          id: true,
          price: true,
          quantity: true,
          executedAt: true,
          takerOrder: { select: { type: true } },
        },
      });
      return Response.json({
        trades: executions.map((execution) => ({
          id: execution.id,
          price: serializeQuote(execution.price),
          quantity: serializeQuantity(execution.quantity),
          type: execution.takerOrder.type,
          createdAt: execution.executedAt.toISOString(),
        })),
      });
    }

    if (searchParams.get("stats") === "true") {
      const stats = await prisma.creatorStat.findMany({
        where: {
          creatorId: id,
          date: { gte: since(readDays(searchParams.get("days"), 30)) },
          period: "DAILY",
        },
        orderBy: { date: "asc" },
        select: {
          date: true,
          subs: true,
          views: true,
          videos: true,
          dailySubsChange: true,
          dailyViewsChange: true,
          avgLikes: true,
          avgComments: true,
        },
      });
      return Response.json({
        stats: stats.map((stat) => ({ ...stat, date: stat.date.toISOString() })),
      });
    }

    if (searchParams.get("videos") === "true") {
      const videos = await prisma.video.findMany({
        where: { creatorId: id },
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        take: 20,
      });
      return Response.json({
        videos: videos.map((video) => ({
          ...video,
          publishedAt: video.publishedAt.toISOString(),
          createdAt: video.createdAt.toISOString(),
          updatedAt: video.updatedAt.toISOString(),
        })),
      });
    }

    const creator = await prisma.creator.findFirst({
      where: { id, isActive: true, visibility: "PUBLIC" },
      include: { _count: { select: { videos: true } } },
    });
    if (!creator) throw new ApiError(404, "CREATOR_NOT_FOUND", "Creator was not found.");
    return Response.json({
      creator: {
        ...creator,
        initialPrice: serializeQuote(creator.initialPrice),
        currentPrice: serializeQuote(creator.currentPrice),
        totalSupply: serializeQuantity(creator.totalSupply),
        circulatingSupply: serializeQuantity(creator.circulatingSupply),
        reserveSupply: serializeQuantity(creator.reserveSupply),
        liquidity: serializeQuote(creator.liquidity),
        createdAt: creator.createdAt.toISOString(),
        updatedAt: creator.updatedAt.toISOString(),
        lastSyncedAt: creator.lastSyncedAt.toISOString(),
      },
    });
  },
);

export const OPTIONS = corsPreflight;
