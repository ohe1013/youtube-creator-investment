import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { statsQuerySchema } from "@/lib/validation";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);

    // Check if requesting stats
    const statsParam = searchParams.get("stats");

    if (statsParam === "true") {
      // Return historical stats
      const queryResult = statsQuerySchema.safeParse({
        days: searchParams.get("days") ? Number(searchParams.get("days")) : 30,
      });

      if (!queryResult.success) {
        return NextResponse.json(
          { error: "Invalid query parameters" },
          { status: 400 }
        );
      }

      const { days } = queryResult.data;

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const stats = await prisma.creatorStat.findMany({
        where: {
          creatorId: id,
          date: {
            gte: startDate,
            lte: endDate,
          },
          period: "DAILY",
        },
        orderBy: {
          date: "asc",
        },
        select: {
          date: true,
          subs: true,
          views: true,
          videos: true,
          dailySubsChange: true,
          dailyViewsChange: true,
        },
      });

      return NextResponse.json({ stats });
    }

    // Return creator details
    const creator = await prisma.creator.findUnique({
      where: { id },
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
        createdAt: true,
      },
    });

    if (!creator) {
      return NextResponse.json({ error: "Creator not found" }, { status: 404 });
    }

    return NextResponse.json({ creator });
  } catch (error) {
    console.error("Error fetching creator:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
