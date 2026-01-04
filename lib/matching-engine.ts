import { prisma } from "@/lib/prisma";
import { TradeType, OrderType, OrderStatus, Prisma } from "@prisma/client";

/**
 * Places a new order and attempts to match it immediately.
 */
export async function placeOrder(
  userId: string,
  creatorId: string,
  side: TradeType,
  price: number,
  quantity: number,
  orderType: OrderType = "LIMIT"
) {
  // Use a transaction to ensure integrity
  return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // 1. Asset Verification
    if (side === "BUY") {
      const user = await tx.user.findUnique({ where: { id: userId } });
      const requiredAmount = price * quantity; // Conservative locking for Limit
      if (!user || user.balance < requiredAmount) {
        throw new Error("Insufficient balance");
      }

      // Deduct balance immediately (lock funds)
      // For a real exchange, we'd move to "lockedBalance", but here we just deduct.
      // If unfilled, we might need a way to return it?
      // Simplified: Deduct now. If cancelled, refund.
      await tx.user.update({
        where: { id: userId },
        data: { balance: { decrement: requiredAmount } },
      });
    } else {
      // SELL
      const position = await tx.position.findUnique({
        where: { userId_creatorId: { userId, creatorId } },
      });
      if (!position || position.quantity < quantity) {
        throw new Error("Insufficient position");
      }
      // Deduct shares immediately (lock shares)
      await tx.position.update({
        where: { id: position.id },
        data: { quantity: { decrement: quantity } },
      });
    }

    // 2. Create Order
    const order = await tx.order.create({
      data: {
        userId,
        creatorId,
        type: side,
        orderType,
        price,
        quantity,
        filled: 0,
        status: "OPEN",
      },
    });

    // 3. Match Order
    await matchOrder(tx, order.id);

    return order;
  });
}

/**
 * Matches an order against the order book.
 */
async function matchOrder(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order || order.status === "FILLED" || order.status === "CANCELLED")
    return;

  const isBuy = order.type === "BUY";

  // Find matching candidates
  // BUY matches with SELLs (lowest price first)
  // SELL matches with BUYs (highest price first)
  const candidates = await tx.order.findMany({
    where: {
      creatorId: order.creatorId,
      type: isBuy ? "SELL" : "BUY",
      status: { in: ["OPEN", "PARTIAL"] },
      price: isBuy ? { lte: order.price } : { gte: order.price },
    },
    orderBy: [
      { price: isBuy ? "asc" : "desc" },
      { createdAt: "asc" }, // Time priority
    ],
    take: 50, // Batch match
  });

  let remainingQty = order.quantity - order.filled;
  let totalCost = 0; // For refunds if BUY order filled at better price

  for (const match of candidates) {
    if (remainingQty <= 0) break;

    const matchRemaining = match.quantity - match.filled;
    const fillQty = Math.min(remainingQty, matchRemaining);
    if (fillQty <= 0) continue;

    // Execution Price is Maker's Price
    const tradePrice = match.price;
    const tradeValue = fillQty * tradePrice;

    // --- EXECUTE TRADE ---

    // 1. Create Trade Records
    // Taker Trade
    await tx.trade.create({
      data: {
        userId: order.userId,
        creatorId: order.creatorId,
        type: order.type,
        quantity: fillQty,
        price: tradePrice,
        orderId: order.id,
      },
    });

    // Maker Trade
    await tx.trade.create({
      data: {
        userId: match.userId,
        creatorId: match.creatorId,
        type: match.type,
        quantity: fillQty,
        price: tradePrice,
        orderId: match.id,
      },
    });

    // 2. Update Balances/Positions based on Fill
    // Maker (Liquidity Provider) Updates
    if (match.type === "SELL") {
      // Maker was selling, now executed -> gets Cash
      await tx.user.update({
        where: { id: match.userId },
        data: { balance: { increment: tradeValue } },
      });
    } else {
      // Maker was buying, now executed -> gets Shares
      // Check if position exists
      const pos = await tx.position.findUnique({
        where: {
          userId_creatorId: {
            userId: match.userId,
            creatorId: match.creatorId,
          },
        },
      });
      if (pos) {
        await tx.position.update({
          where: { id: pos.id },
          data: {
            quantity: { increment: fillQty },
            avgPrice:
              (pos.avgPrice * pos.quantity + tradeValue) /
              (pos.quantity + fillQty),
          },
        });
      } else {
        await tx.position.create({
          data: {
            userId: match.userId,
            creatorId: match.creatorId,
            quantity: fillQty,
            avgPrice: tradePrice,
          },
        });
      }
    }

    // Taker Updates
    // We already deducted Taker's assets at Open.
    // If Taker BUY: Deducted (limit * qty). Filled at tradePrice.
    // Refund diff: (limit - tradePrice) * fillQty
    if (order.type === "BUY") {
      const lockPrice = order.price;
      const refund = (lockPrice - tradePrice) * fillQty;
      if (refund > 0) {
        await tx.user.update({
          where: { id: order.userId },
          data: { balance: { increment: refund } },
        });
      }

      // Taker gets Shares
      const pos = await tx.position.findUnique({
        where: {
          userId_creatorId: {
            userId: order.userId,
            creatorId: order.creatorId,
          },
        },
      });
      if (pos) {
        await tx.position.update({
          where: { id: pos.id },
          data: {
            quantity: { increment: fillQty },
            avgPrice:
              (pos.avgPrice * pos.quantity + tradeValue) /
              (pos.quantity + fillQty),
          },
        });
      } else {
        await tx.position.create({
          data: {
            userId: order.userId,
            creatorId: order.creatorId,
            quantity: fillQty,
            avgPrice: tradePrice,
          },
        });
      }
    } else {
      // Taker SELL: Shares already deducted.
      // Taker gets Cash.
      await tx.user.update({
        where: { id: order.userId },
        data: { balance: { increment: tradeValue } },
      });
    }

    // 3. Update Maker Order Status
    const matchNewFilled = match.filled + fillQty;
    const matchStatus = matchNewFilled >= match.quantity ? "FILLED" : "PARTIAL";
    await tx.order.update({
      where: { id: match.id },
      data: { filled: matchNewFilled, status: matchStatus },
    });

    // 4. Update Market Price
    await tx.creator.update({
      where: { id: order.creatorId },
      data: { currentPrice: tradePrice },
    });

    remainingQty -= fillQty;
  }

  // Update Taker Order Status
  const status =
    remainingQty <= 0
      ? "FILLED"
      : remainingQty < order.quantity
      ? "PARTIAL"
      : "OPEN";
  await tx.order.update({
    where: { id: order.id },
    data: {
      filled: order.quantity - remainingQty,
      status,
    },
  });
}

/**
 * Cancels an order and refunds locked assets.
 */
export async function cancelOrder(userId: string, orderId: string) {
  return await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (
      !order ||
      order.userId !== userId ||
      (order.status !== "OPEN" && order.status !== "PARTIAL")
    ) {
      throw new Error("Cannot cancel order");
    }

    const remainingQty = order.quantity - order.filled;

    // Refund
    if (order.type === "BUY") {
      const lockedFund = remainingQty * order.price;
      await tx.user.update({
        where: { id: userId },
        data: { balance: { increment: lockedFund } },
      });
    } else {
      // Refund Shares
      const pos = await tx.position.findUnique({
        where: { userId_creatorId: { userId, creatorId: order.creatorId } },
      });
      if (pos) {
        await tx.position.update({
          where: { id: pos.id },
          data: { quantity: { increment: remainingQty } },
        });
      }
    }

    // Set Status
    return await tx.order.update({
      where: { id: orderId },
      data: { status: "CANCELLED" },
    });
  });
}
