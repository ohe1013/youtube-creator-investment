import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getChannelStats, getChannelsStats } from "@/lib/youtube";
import { updateCreatorScoreAndPrice } from "@/lib/scoring";

export async function POST(request: NextRequest) {
  try {
    // Verify secret token
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (token !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch all active creators
    const creators = await prisma.creator.findMany({
      where: {
        isActive: true,
      },
      select: {
        id: true,
        youtubeChannelId: true,
        name: true,
        currentSubs: true,
        currentViews: true,
      },
    });

    console.log(`Updating stats for ${creators.length} creators...`);

    // 1. Batch Fetch Latest Stats (Quota Efficient: 1 unit per 50 creators)
    const channelIds = creators.map((c) => c.youtubeChannelId);
    const latestStatsList = await getChannelsStats(channelIds);
    const statsMap = new Map(latestStatsList.map((s) => [s.channelId, s]));

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    // 2. Update each creator using batched data
    for (const creator of creators) {
      try {
        const stats = statsMap.get(creator.youtubeChannelId) as any;

        if (!stats) {
          results.failed++;
          results.errors.push(`Failed to fetch stats for ${creator.name}`);
          continue;
        }

        // Calculate daily changes
        const dailySubsChange = stats.subs - creator.currentSubs;
        const dailyViewsChange = stats.views - creator.currentViews;

        // Create snapshot
        await prisma.creatorStat.create({
          data: {
            creatorId: creator.id,
            date: new Date(),
            period: "DAILY",
            subs: stats.subs,
            views: stats.views,
            videos: stats.videos,
            dailySubsChange,
            dailyViewsChange,
          },
        });

        // Update creator current metrics
        await prisma.creator.update({
          where: { id: creator.id },
          data: {
            currentSubs: stats.subs,
            currentViews: stats.views,
            currentVideos: stats.videos,
            name: stats.name,
            thumbnailUrl: stats.thumbnailUrl,
            lastSyncedAt: new Date(),
          },
        });

        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push(
          `Error updating ${creator.name}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    }

    console.log(
      `Update complete: ${results.success} success, ${results.failed} failed`
    );

    return NextResponse.json({
      message: "Stats update complete",
      results,
    });
  } catch (error) {
    console.error("Cron job error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
