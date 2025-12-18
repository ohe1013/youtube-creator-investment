import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "all"; // all, 30days

    // Calculate date filter
    let dateFilter: any = {};
    if (period === "30days") {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      dateFilter = { gte: thirtyDaysAgo };
    }

    // Get all users with their trades
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        image: true,
        balance: true,
        initialBudget: true,
        createdAt: true,
        positions: {
          include: {
            creator: {
              select: {
                currentPrice: true,
              },
            },
          },
        },
      },
    });

    // Calculate total assets for each user
    const rankings = users
      .map((user) => {
        const totalPositionValue = user.positions.reduce(
          (sum, position) =>
            sum + position.quantity * position.creator.currentPrice,
          0
        );

        const totalAssets = user.balance + totalPositionValue;
        const profitLoss = totalAssets - user.initialBudget;
        const profitLossPercent = (profitLoss / user.initialBudget) * 100;

        return {
          userId: user.id,
          name: user.name || "Anonymous",
          image: user.image,
          totalAssets,
          profitLoss,
          profitLossPercent,
          positionCount: user.positions.length,
          joinedAt: user.createdAt,
        };
      })
      .sort((a, b) => b.profitLossPercent - a.profitLossPercent)
      .map((user, index) => ({
        rank: index + 1,
        ...user,
      }));

    return NextResponse.json({
      rankings,
      period,
    });
  } catch (error) {
    console.error("Rankings error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
