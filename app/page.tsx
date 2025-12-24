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

    // 4. Generate/Fetch Chart Data (Higher Density: 5 ticks/min)
    const now = new Date();
    let current = selectedCreator.currentPrice;
    const ticksPerMinute = 5;
    const totalMinutes = 120;
    const totalPoints = totalMinutes * ticksPerMinute;

    chartData = Array.from({ length: totalPoints }).map((_, i) => {
      const volatility = 0.002; // 0.2% max movement per tick
      const noise = (Math.random() - 0.5) * (current * volatility);
      current += noise;

      // Intervals of 12 seconds
      const time = new Date(
        now.getTime() - (totalPoints - i) * (60 / ticksPerMinute) * 1000
      );

      return {
        date: time.toISOString(),
        price: current,
      };
    });

    // 5. Fetch Recent Trades
    const recentTrades = await prisma.trade.findMany({
      where: { creatorId: selectedCreator.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    trades = recentTrades.map((t: any) => ({
      id: t.id,
      price: t.price,
      quantity: t.quantity,
      type: t.type,
      time: t.createdAt.toLocaleTimeString(),
    }));
  }

  return (
    <main className="h-[calc(100vh-56px)] bg-background text-foreground flex flex-col overflow-hidden">
      <MarketDashboard
        selectedCreator={selectedCreator}
        stats={{
          high24h: selectedCreator.currentPrice * 1.1,
          low24h: selectedCreator.currentPrice * 0.9,
          vol24h: selectedCreator.currentViews * 10,
          change24h: selectedCreator.id === "1" ? 2.5 : -1.2,
        }}
        chartData={chartData}
        trades={trades}
        creators={creators}
        userBalance={userBalance}
        userQuantity={userQuantity}
      />
    </main>
  );
}
