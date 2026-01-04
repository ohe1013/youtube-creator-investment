import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { tradeSchema } from "@/lib/validation";
import { tradeLimiter } from "@/lib/rate-limit";
import { calculateNewPrice } from "@/lib/market";

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);

    if (!session?.user || !('id' in session.user)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as any).id as string;

    // Rate limiting
    const rateLimitResult = tradeLimiter.check(userId);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validationResult = tradeSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: (validationResult.error as any).issues },
        { status: 400 }
      );
    }

    const { creatorId, quantity, orderType, limitPrice } = validationResult.data;

    // Execute buy transaction
    const result = await prisma.$transaction(async (tx: any) => {
      // Get user
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { balance: true },
      });

      if (!user) {
        throw new Error("User not found");
      }

      // Get creator and current price
      const creator = await tx.creator.findUnique({
        where: { id: creatorId },
        select: { 
          currentPrice: true, 
          name: true, 
          isActive: true,
          liquidity: true
        },
      });

      if (!creator) {
        throw new Error("Creator not found");
      }

      // Check Limit Price condition
      if (orderType === "LIMIT" && limitPrice && creator.currentPrice > limitPrice) {
        throw new Error(
          `Current price (${creator.currentPrice}) is higher than your limit price (${limitPrice})`
        );
      }

      if (!creator.isActive) {
        throw new Error("This creator is no longer available for trading");
      }

      // Calculate total cost (using current price)
      const totalCost = quantity * creator.currentPrice;

      // Check balance
      if (user.balance < totalCost) {
        throw new Error("Insufficient balance");
      }

      // Calculate new price based on Price Impact
      const newPrice = calculateNewPrice(
        creator.currentPrice,
        totalCost,
        'BUY',
        creator.liquidity
      );

      // Create trade record
      const trade = await tx.trade.create({
        data: {
          userId,
          creatorId,
          type: "BUY",
          quantity,
          price: creator.currentPrice, // Price at which it was executed
        },
      });

      // Update or create position
      const existingPosition = await tx.position.findUnique({
        where: {
          userId_creatorId: {
            userId,
            creatorId,
          },
        },
      });

      if (existingPosition) {
        // Update existing position
        const newQuantity = existingPosition.quantity + quantity;
        const newAvgPrice =
          (existingPosition.avgPrice * existingPosition.quantity +
            creator.currentPrice * quantity) /
          newQuantity;

        await tx.position.update({
          where: {
            userId_creatorId: {
              userId,
              creatorId,
            },
          },
          data: {
            quantity: newQuantity,
            avgPrice: newAvgPrice,
          },
        });
      } else {
        // Create new position
        await tx.position.create({
          data: {
            userId,
            creatorId,
            quantity,
            avgPrice: creator.currentPrice,
          },
        });
      }

      // Deduct balance
      await tx.user.update({
        where: { id: userId },
        data: {
          balance: user.balance - totalCost,
        },
      });

      // Update Creator currentPrice
      await tx.creator.update({
        where: { id: creatorId },
        data: {
          currentPrice: newPrice,
        },
      });

      return {
        trade,
        totalCost,
        newBalance: user.balance - totalCost,
        creatorName: creator.name,
        newPrice,
      };
    });

    return NextResponse.json({
      success: true,
      message: `Successfully bought ${quantity} shares of ${result.creatorName}`,
      data: {
        tradeId: result.trade.id,
        totalCost: result.totalCost,
        newBalance: result.newBalance,
      },
    });
  } catch (error) {
    console.error("Buy trade error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
