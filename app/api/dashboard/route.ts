import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    // 1. Global Market Stats
    const totalCreators = await prisma.creator.count({
      where: { isActive: true, visibility: "PUBLIC" },
    });

    const activeCreators = await prisma.creator.findMany({
      where: { isActive: true, visibility: "PUBLIC" },
      select: { currentPrice: true, circulatingSupply: true },
    });

    const totalMarketCap = activeCreators.reduce(
      (sum, c) => sum + c.currentPrice * (c.circulatingSupply || 0),
      0
    );

    // 24h Volume (Trades in last 24h)
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const volumeData = await prisma.trade.aggregate({
      where: { createdAt: { gte: oneDayAgo } },
      _sum: { price: true, quantity: true }, // Simplified, really needs price * quantity per trade
    });

    // Better volume calc
    const last24hTrades = await prisma.trade.findMany({
      where: { createdAt: { gte: oneDayAgo } },
      select: { price: true, quantity: true },
    });
    const totalVolume24h = last24hTrades.reduce(
      (sum, t) => sum + t.price * t.quantity,
      0
    );

    // 2. Rankings
    // Top Gainers (Mocked for now as we don't have 24h starting prices stored explicitly yet,
    // but we can use currentScore or price as a proxy for 'Top')
    const topRankings = await prisma.creator.findMany({
      where: { isActive: true, visibility: "PUBLIC" },
      orderBy: { currentScore: "desc" },
      take: 10,
      select: {
        id: true,
        name: true,
        thumbnailUrl: true,
        currentPrice: true,
        currentScore: true,
        category: true,
        circulatingSupply: true,
      },
    });

    // 3. New Listings
    const newListings = await prisma.creator.findMany({
      where: { isActive: true, visibility: "PUBLIC" },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    // 4. User Snapshot
    let userSnapshot = null;
    if (session?.user) {
      const user = await prisma.user.findUnique({
        where: { id: (session.user as any).id },
        include: {
          positions: {
            include: { creator: true },
            orderBy: { quantity: "desc" },
          },
        },
      });
      if (user) {
        const portfolioValue = user.positions.reduce(
          (sum, p) => sum + p.quantity * p.creator.currentPrice,
          0
        );
        userSnapshot = {
          balance: user.balance,
          portfolioValue,
          totalAssets: user.balance + portfolioValue,
          topHolding: user.positions[0]?.creator.name || null,
        };
      }
    }

    return NextResponse.json({
      stats: {
        totalMarketCap,
        totalVolume24h,
        totalCreators,
        activeTraders: 124, // Mocked for now
      },
      rankings: topRankings.map((r) => ({
        ...r,
        marketCap: r.currentPrice * (r.circulatingSupply || 200000),
      })),
      newListings,
      user: userSnapshot,
    });
  } catch (error) {
    console.error("Dashboard API Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard" },
      { status: 500 }
    );
  }
}
