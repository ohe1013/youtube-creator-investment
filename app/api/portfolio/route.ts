import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    // 1. User Balance
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });

    // 2. Positions (Holdings)
    const positions = await prisma.position.findMany({
      where: { userId, quantity: { gt: 0 } },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            currentPrice: true,
            thumbnailUrl: true,
          },
        },
      },
    });

    // 3. Open Orders (Limit Orders)
    const openOrders = await prisma.order.findMany({
      where: {
        userId,
        status: { in: ["OPEN", "PARTIAL"] },
      },
      orderBy: { createdAt: "desc" },
      include: {
        creator: { select: { id: true, name: true } },
      },
    });

    // 4. Trade History
    const trades = await prisma.legacyTrade.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        creator: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({
      balance: user ? Number(user.balance) : 0,
      positions: positions.map((position) => ({
        id: position.id,
        userId: position.userId,
        creatorId: position.creatorId,
        quantity: Number(position.quantity),
        avgPrice: Number(position.avgPrice),
        createdAt: position.createdAt,
        updatedAt: position.updatedAt,
        creator: {
          ...position.creator,
          currentPrice: Number(position.creator.currentPrice),
        },
      })),
      openOrders: openOrders.map((order) => ({
        id: order.id,
        userId: order.userId,
        creatorId: order.creatorId,
        type: order.type,
        orderType: order.orderType,
        price: Number(order.price),
        quantity: Number(order.quantity),
        filled: Number(order.filled),
        status: order.status,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        creator: order.creator,
      })),
      trades: trades.map((trade) => ({
        ...trade,
        price: Number(trade.price),
        quantity: Number(trade.quantity),
      })),
    });
  } catch (error) {
    console.error("Portfolio Fetch Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
