import { MarketDashboard } from "@/components/market/MarketDashboard";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

// Force dynamic since we use DB
export const dynamic = "force-dynamic";

export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const { ticker } = await searchParams;

  // 1. Fetch all active creators for the list
  // Top 50 by volume or liquidity or just all
  const creators = await prisma.creator.findMany({
    where: { isActive: true },
    select: {
      id: true,
      youtubeChannelId: true,
      name: true,
      currentPrice: true,
      currentSubs: true,
      currentViews: true,
      thumbnailUrl: true,
      currentScore: true,
      circulatingSupply: true,
      currentVideos: true,
      category: true,
      liquidity: true,
    },
    orderBy: { currentSubs: "desc" }, // simple ranking
    take: 50,
  });

  // 2. Determine Selected Creator
  const selectedId = ticker || creators[0]?.id;
  const selectedCreator =
    creators.find((c) => c.id === selectedId) || creators[0];

  if (!selectedCreator && creators.length > 0) {
    // fallback
  }

  // 3. User & Market Data
  let userBalance = 0;
  let userQuantity = 0;
  let chartData: any[] = [];
  let trades: any[] = [];

  if (selectedCreator) {
    if (session?.user) {
      const freshUser = await prisma.user.findUnique({
        where: { id: (session.user as any).id },
        include: {
          positions: {
            where: { creatorId: selectedCreator.id },
          },
        },
      });
      userBalance = freshUser?.balance || 0;
      userQuantity = freshUser?.positions[0]?.quantity || 0;
    }

    // 4. Fetch Real Trade Data for Chart (7 days history)
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    const historyTrades = await prisma.trade.findMany({
      where: {
        creatorId: selectedCreator.id,
        createdAt: { gte: startDate },
      },
      orderBy: { createdAt: "asc" },
      select: {
        createdAt: true,
        price: true,
        quantity: true,
      },
    });

    chartData = historyTrades.map((t) => ({
      date: t.createdAt.toISOString(),
      price: t.price,
      volume: t.quantity * t.price,
    }));

    if (chartData.length === 0) {
      chartData = [
        {
          date: new Date().toISOString(),
          price: selectedCreator.currentPrice,
          volume: 0,
        },
      ];
    }

    // 5. Calculate 24h Stats dynamically
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const last24hTrades = historyTrades.filter((t) => t.createdAt >= oneDayAgo);

    let high24h = selectedCreator.currentPrice;
    let low24h = selectedCreator.currentPrice;
    let vol24h = 0;
    let change24h = 0;

    if (last24hTrades.length > 0) {
      const prices = last24hTrades.map((t) => t.price);
      high24h = Math.max(...prices, selectedCreator.currentPrice);
      low24h = Math.min(...prices, selectedCreator.currentPrice);
      vol24h = last24hTrades.reduce((sum, t) => sum + t.quantity * t.price, 0);

      const firstPrice = last24hTrades[0].price;
      const lastPrice = last24hTrades[last24hTrades.length - 1].price;
      change24h = ((lastPrice - firstPrice) / firstPrice) * 100;
    }

    // 6. Fetch Recent Trades (for the trades list)
    const recentTrades = await prisma.trade.findMany({
      where: { creatorId: selectedCreator.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    trades = recentTrades.map((t: any) => ({
      id: t.id,
      price: t.price,
      quantity: t.quantity ?? 0,
      type: t.type,
      time: t.createdAt.toLocaleTimeString(),
    }));

    // 7. Fetch Historical Stats (for CreatorInfo Trending)
    const historyStats = await prisma.creatorStat.findMany({
      where: { creatorId: selectedCreator.id },
      orderBy: { date: "asc" },
    });

    // 8. Fetch Recent Videos (for CreatorInfo Content)
    const videos = await prisma.video.findMany({
      where: { creatorId: selectedCreator.id },
      orderBy: { publishedAt: "desc" },
      take: 10,
    });

    return (
      <main className="h-[calc(100vh-56px)] bg-background text-foreground flex flex-col overflow-hidden">
        <MarketDashboard
          selectedCreator={selectedCreator}
          stats={{
            high24h,
            low24h,
            vol24h,
            change24h,
          }}
          historyStats={historyStats}
          videos={videos}
          chartData={chartData}
          trades={trades}
          creators={creators}
          userBalance={userBalance}
          userQuantity={userQuantity}
        />
      </main>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">No creators found</h1>
        <p className="text-muted">Market is currently empty.</p>
      </div>
    </div>
  );
}
