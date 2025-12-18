import { MarketDashboard } from "@/components/market/MarketDashboard";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

// Force dynamic since we use DB
export const dynamic = 'force-dynamic';

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
      name: true,
      currentPrice: true,
      liquidity: true,
      currentSubs: true,
      currentViews: true,
      // For now, mock 24h stats or fetch from stats table if aggregated
      // We will compute simple stats or just show current price
    },
    orderBy: { currentSubs: 'desc' }, // simple ranking
    take: 50
  });

  // 2. Determine Selected Creator
  const selectedId = ticker || creators[0]?.id;
  const selectedCreator = creators.find(c => c.id === selectedId) || creators[0];

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
        where: { id: session.user.id },
        include: { 
          positions: {
            where: { creatorId: selectedCreator.id }
          }
        }
      });
      userBalance = freshUser?.balance || 0;
      userQuantity = freshUser?.positions[0]?.quantity || 0;
    }

    // 4. Generate/Fetch Chart Data
    // Mocking chart data based on price for now
    chartData = Array.from({ length: 50 }).map((_, i) => {
      const base = selectedCreator.currentPrice;
      const random = (Math.random() - 0.5) * (base * 0.05);
      return {
        date: `10:${i < 10 ? '0'+i : i}`,
        price: base + random
      };
    });

    // 5. Fetch Recent Trades
    const recentTrades = await prisma.trade.findMany({
      where: { creatorId: selectedCreator.id },
      orderBy: { createdAt: 'desc' },
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
    <main className="min-h-screen bg-[#0b0e11] text-[#eaecef] flex flex-col">
       <MarketDashboard 
          selectedCreator={selectedCreator}
          stats={{
            high24h: selectedCreator.currentPrice * 1.1, 
            low24h: selectedCreator.currentPrice * 0.9,  
            vol24h: selectedCreator.currentViews * 10,   
            change24h: selectedCreator.id === '1' ? 2.5 : -1.2 
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
