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
    const tradesParam = searchParams.get("trades");
    const historyParam = searchParams.get("history");
    const orderbookParam = searchParams.get("orderbook");

    if (orderbookParam === "true") {
      // Check if Order model exists on prisma client (it might not if generation failed)
      if (!(prisma as any).order) {
        return NextResponse.json({ asks: [], bids: [] });
      }

      const orders = await (prisma as any).order.findMany({
        where: { creatorId: id, status: { in: ["OPEN", "PARTIAL"] } },
        select: { type: true, price: true, quantity: true, filled: true },
      });

      const askMap = new Map<number, number>();
      const bidMap = new Map<number, number>();

      orders.forEach((o: any) => {
        const remaining = o.quantity - o.filled;
        if (remaining <= 0) return;

        if (o.type === "SELL") {
          askMap.set(o.price, (askMap.get(o.price) || 0) + remaining);
        } else {
          bidMap.set(o.price, (bidMap.get(o.price) || 0) + remaining);
        }
      });

      const asks = Array.from(askMap.entries())
        .map(([price, quantity]) => ({ price, quantity }))
        .sort((a, b) => a.price - b.price);

      const bids = Array.from(bidMap.entries())
        .map(([price, quantity]) => ({ price, quantity }))
        .sort((a, b) => b.price - a.price);

      return NextResponse.json({ asks, bids });
    }

    if (historyParam === "true") {
      const days = searchParams.get("days")
        ? Number(searchParams.get("days"))
        : 7;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // 1. Fetch Daily Stats
      const stats = await prisma.creatorStat.findMany({
        where: { creatorId: id, date: { gte: startDate } },
        orderBy: { date: "asc" },
        select: { date: true, subs: true, views: true, videos: true },
      });

      // 2. Fetch All Trades in that period (for price movements)
      const trades = await prisma.trade.findMany({
        where: { creatorId: id, createdAt: { gte: startDate } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true, price: true, quantity: true },
      });

      // 3. Map to HistoryPoints
      // We assume initialPrice was the price before the first trade or the first stat
      const creator = await prisma.creator.findUnique({
        where: { id },
        select: { initialPrice: true },
      });

      const history = trades.map((t) => ({
        date: t.createdAt,
        price: t.price,
        volume: t.quantity * t.price,
      }));

      // If no trades, use currentPrice or a dummy point from stats
      if (history.length === 0 && creator) {
        history.push({
          date: new Date(),
          price: creator.initialPrice,
          volume: 0,
        });
      }

      return NextResponse.json({ history });
    }

    if (tradesParam === "true") {
      const trades = await prisma.trade.findMany({
        where: { creatorId: id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          price: true,
          quantity: true,
          type: true,
          createdAt: true,
        },
      });
      return NextResponse.json({ trades });
    }

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
