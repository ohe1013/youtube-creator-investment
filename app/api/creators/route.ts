import type { Prisma } from "@prisma/client";

import { serializeDecimal } from "@/lib/contracts/decimal";
import type { CreatorSummary } from "@/lib/data/contracts";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/server/http/api-error";
import { corsPreflight, withApiRoute } from "@/lib/server/http/route-handler";
import { creatorFilterSchema } from "@/lib/validation";

export const GET = withApiRoute(async (request) => {
  const { searchParams } = new URL(request.url);
  const filterResult = creatorFilterSchema.safeParse({
    category: searchParams.get("category") || undefined,
    minSubs: searchParams.get("minSubs")
      ? Number(searchParams.get("minSubs"))
      : undefined,
    maxSubs: searchParams.get("maxSubs")
      ? Number(searchParams.get("maxSubs"))
      : undefined,
    sort: searchParams.get("sort") || "score",
    page: searchParams.get("page") ? Number(searchParams.get("page")) : 1,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : 20,
  });
  if (!filterResult.success) {
    throw new ApiError(400, "INVALID_QUERY", "Invalid creator query.");
  }

  const { category, minSubs, maxSubs, sort, page, limit } = filterResult.data;
  const where: Prisma.CreatorWhereInput = {
    visibility: "PUBLIC",
    isActive: true,
  };
  if (category) where.category = category;
  if (minSubs !== undefined || maxSubs !== undefined) {
    where.currentSubs = {};
    if (minSubs !== undefined) where.currentSubs.gte = minSubs;
    if (maxSubs !== undefined) where.currentSubs.lte = maxSubs;
  }

  const orderBy: Prisma.CreatorOrderByWithRelationInput = {};
  switch (sort) {
    case "subs":
      orderBy.currentSubs = "desc";
      break;
    case "price":
      orderBy.currentPrice = "desc";
      break;
    case "growth":
    case "score":
    default:
      orderBy.currentScore = "desc";
      break;
  }

  const [creators, total] = await Promise.all([
    prisma.creator.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        youtubeChannelId: true,
        name: true,
        thumbnailUrl: true,
        category: true,
        country: true,
        currentSubs: true,
        currentViews: true,
        currentVideos: true,
        currentScore: true,
        initialPrice: true,
        currentPrice: true,
        totalSupply: true,
        circulatingSupply: true,
        reserveSupply: true,
        liquidity: true,
        isActive: true,
        visibility: true,
        avgLikes: true,
        avgComments: true,
        engagementRate: true,
        viewsPerSubs: true,
        createdAt: true,
        lastSyncedAt: true,
        _count: { select: { videos: true } },
      },
    }),
    prisma.creator.count({ where }),
  ]);

  const summaries: CreatorSummary[] = creators.map((creator) => ({
    ...creator,
    initialPrice: serializeDecimal(creator.initialPrice),
    currentPrice: serializeDecimal(creator.currentPrice),
    totalSupply: serializeDecimal(creator.totalSupply),
    circulatingSupply: serializeDecimal(creator.circulatingSupply),
    reserveSupply: serializeDecimal(creator.reserveSupply),
    liquidity: serializeDecimal(creator.liquidity),
    createdAt: creator.createdAt.toISOString(),
    lastSyncedAt: creator.lastSyncedAt.toISOString(),
  }));

  return Response.json({
    creators: summaries,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

export const OPTIONS = corsPreflight;
