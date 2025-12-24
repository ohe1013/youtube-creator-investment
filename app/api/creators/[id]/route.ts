import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { statsQuerySchema } from "@/lib/validation";
import { getRecentVideos } from "@/lib/youtube";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);

    const statsParam = searchParams.get("stats");
    const videosParam = searchParams.get("videos");

    if (statsParam === "true") {
      const queryResult = statsQuerySchema.safeParse({
        days: searchParams.get("days") ? Number(searchParams.get("days")) : 30,
      });

      if (!queryResult.success) {
        return NextResponse.json(
          { error: "Invalid parameters" },
          { status: 400 }
        );
      }

      const { days } = queryResult.data;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const stats = await prisma.creatorStat.findMany({
        where: {
          creatorId: id,
          date: { gte: startDate },
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

      return NextResponse.json({ stats });
    }

    if (videosParam === "true") {
      const creator = await prisma.creator.findUnique({
        where: { id },
        select: { id: true, youtubeChannelId: true, currentSubs: true },
      });

      if (!creator) {
        return NextResponse.json(
          { error: "Creator not found" },
          { status: 404 }
        );
      }

      // 1. Fetch from YouTube
      const ytVideos = await getRecentVideos(creator.youtubeChannelId);

      if (ytVideos.length > 0) {
        // 2. Persist to DB (Incremental Upsert)
        await Promise.all(
          ytVideos.map((v) =>
            prisma.video.upsert({
              where: { id: v.id },
              update: {
                viewCount: v.viewCount,
                likeCount: v.likeCount,
                commentCount: v.commentCount,
                title: v.title,
                thumbnailUrl: v.thumbnailUrl,
              },
              create: {
                id: v.id,
                creatorId: creator.id,
                title: v.title,
                thumbnailUrl: v.thumbnailUrl,
                publishedAt: new Date(v.publishedAt),
                duration: v.duration,
                type: v.type, // LONG or SHORTS
                viewCount: v.viewCount,
                likeCount: v.likeCount,
                commentCount: v.commentCount,
              },
            })
          )
        );

        // 3. Calculate Aggregate Metrics
        const totalViews = ytVideos.reduce((sum, v) => sum + v.viewCount, 0);
        const totalLikes = ytVideos.reduce((sum, v) => sum + v.likeCount, 0);
        const totalComments = ytVideos.reduce(
          (sum, v) => sum + v.commentCount,
          0
        );
        const avgViews = totalViews / ytVideos.length;

        const engagementRate =
          totalViews > 0
            ? ((totalLikes + totalComments) / totalViews) * 100
            : 0;
        const viewsPerSubs =
          creator.currentSubs > 0 ? (avgViews / creator.currentSubs) * 100 : 0;

        // 4. Update Creator
        await prisma.creator.update({
          where: { id: creator.id },
          data: {
            avgLikes: totalLikes / ytVideos.length,
            avgComments: totalComments / ytVideos.length,
            engagementRate,
            viewsPerSubs,
          },
        });
      }

      const dbVideos = await prisma.video.findMany({
        where: { creatorId: id },
        orderBy: { publishedAt: "desc" },
        take: 20,
      });

      return NextResponse.json({ videos: dbVideos });
    }

    const creator = await prisma.creator.findUnique({
      where: { id },
      include: {
        _count: { select: { videos: true } },
      },
    });

    if (!creator) {
      return NextResponse.json({ error: "Creator not found" }, { status: 404 });
    }

    return NextResponse.json({ creator });
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
