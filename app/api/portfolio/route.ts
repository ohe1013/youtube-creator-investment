import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Get user data
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        balance: true,
        initialBudget: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Get all positions with creator data
    const positions = await prisma.position.findMany({
      where: { userId },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            thumbnailUrl: true,
            category: true,
            currentPrice: true,
            currentScore: true,
            youtubeChannelId: true,
          },
        },
      },
    });

    // Calculate portfolio metrics
    let totalPositionValue = 0;
    const positionsWithMetrics = positions.map((position) => {
      const currentValue = position.quantity * position.creator.currentPrice;
      const costBasis = position.quantity * position.avgPrice;
      const profitLoss = currentValue - costBasis;
      const profitLossPercent = (profitLoss / costBasis) * 100;

      totalPositionValue += currentValue;

      return {
        id: position.id,
        creator: position.creator,
        quantity: position.quantity,
        avgPrice: position.avgPrice,
        currentPrice: position.creator.currentPrice,
        currentValue,
        costBasis,
        profitLoss,
        profitLossPercent,
      };
    });

    const totalAssets = user.balance + totalPositionValue;
    const totalProfitLoss = totalAssets - user.initialBudget;
    const totalProfitLossPercent = (totalProfitLoss / user.initialBudget) * 100;

    return NextResponse.json({
      portfolio: {
        balance: user.balance,
        totalPositionValue,
        totalAssets,
        totalProfitLoss,
        totalProfitLossPercent,
        initialBudget: user.initialBudget,
      },
      positions: positionsWithMetrics,
    });
  } catch (error) {
    console.error("Portfolio error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
