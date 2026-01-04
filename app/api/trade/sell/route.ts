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

    // Execute sell transaction
    const result = await prisma.$transaction(async (tx: any) => {
      // Get position
      const position = await tx.position.findUnique({
        where: {
          userId_creatorId: {
            userId,
            creatorId,
          },
        },
      });

      if (!position) {
        throw new Error("You do not own any shares of this creator");
      }

      if (position.quantity < quantity) {
        throw new Error(
          `Insufficient shares. You own ${position.quantity} but trying to sell ${quantity}`
        );
      }

      // Get creator and current price
      const creator = await tx.creator.findUnique({
        where: { id: creatorId },
        select: { 
          currentPrice: true, 
          name: true,
          liquidity: true
        },
      });

      if (!creator) {
        throw new Error("Creator not found");
      }

      // Check Limit Price condition
      if (orderType === "LIMIT" && limitPrice && creator.currentPrice < limitPrice) {
        throw new Error(
          `Current price (${creator.currentPrice}) is lower than your limit price (${limitPrice})`
        );
      }

      // Calculate proceeds (using current price)
      const proceeds = quantity * creator.currentPrice;

      // Calculate new price based on Price Impact
      const newPrice = calculateNewPrice(
        creator.currentPrice,
        proceeds,
        'SELL',
        creator.liquidity
      );

      // Create trade record
      const trade = await tx.trade.create({
        data: {
          userId,
          creatorId,
          type: "SELL",
          quantity,
          price: creator.currentPrice, // Price at which it was executed
        },
      });

      // Update position
      const newQuantity = position.quantity - quantity;

      if (newQuantity === 0) {
        // Delete position if fully sold
        await tx.position.delete({
          where: {
            userId_creatorId: {
              userId,
              creatorId,
            },
          },
        });
      } else {
        // Update position quantity
        await tx.position.update({
          where: {
            userId_creatorId: {
              userId,
              creatorId,
            },
          },
          data: {
            quantity: newQuantity,
          },
        });
      }

      // Add proceeds to balance
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { balance: true },
      });

      if (!user) {
        throw new Error("User not found");
      }

      await tx.user.update({
        where: { id: userId },
        data: {
          balance: user.balance + proceeds,
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
        proceeds,
        newBalance: user.balance + proceeds,
        creatorName: creator.name,
        newPrice,
      };
    });

    return NextResponse.json({
      success: true,
      message: `Successfully sold ${quantity} shares of ${result.creatorName}`,
      data: {
        tradeId: result.trade.id,
        proceeds: result.proceeds,
        newBalance: result.newBalance,
        newPrice: result.newPrice,
      },
    });
  } catch (error) {
    console.error("Sell trade error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
