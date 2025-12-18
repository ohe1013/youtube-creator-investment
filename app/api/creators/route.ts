import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { creatorFilterSchema } from "@/lib/validation";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Parse and validate query parameters
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
      return NextResponse.json(
        {
          error: "Invalid query parameters",
          details: filterResult.error.issues,
        },
        { status: 400 }
      );
    }

    const { category, minSubs, maxSubs, sort, page, limit } = filterResult.data;

    // Build where clause
    const where: any = {
      visibility: "PUBLIC",
      isActive: true,
    };

    if (category) {
      where.category = category;
    }

    if (minSubs !== undefined || maxSubs !== undefined) {
      where.currentSubs = {};
      if (minSubs !== undefined) where.currentSubs.gte = minSubs;
      if (maxSubs !== undefined) where.currentSubs.lte = maxSubs;
    }

    // Build orderBy clause
    const orderBy: any = {};
    switch (sort) {
      case "score":
        orderBy.currentScore = "desc";
        break;
      case "subs":
        orderBy.currentSubs = "desc";
        break;
      case "price":
        orderBy.currentPrice = "desc";
        break;
      case "growth":
        orderBy.currentScore = "desc"; // Same as score for now
        break;
      default:
        orderBy.currentScore = "desc";
    }

    // Fetch creators with pagination
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
          currentPrice: true,
          lastSyncedAt: true,
        },
      }),
      prisma.creator.count({ where }),
    ]);

    return NextResponse.json({
      creators,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching creators:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
