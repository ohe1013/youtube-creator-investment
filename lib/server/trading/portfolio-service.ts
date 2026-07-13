import "server-only";

import { Prisma } from "@prisma/client";

import {
  serializeQuote,
  serializeTradingExecution,
  serializeTradingOrder,
  serializeTradingPosition,
  type TradingPortfolio,
} from "@/lib/contracts/trading";
import { prisma } from "@/lib/prisma";
import type { AuthPrincipal } from "@/lib/server/auth/types";
import { TradingServiceError } from "@/lib/server/trading/errors";

type TradingReadClient = Prisma.TransactionClient;

export async function getPortfolioInTransaction(
  tx: TradingReadClient,
  principal: AuthPrincipal,
): Promise<TradingPortfolio> {
  const user = await tx.user.findUnique({
    where: { id: principal.userId },
    select: { balance: true, reservedBalance: true },
  });

  if (!user) {
    throw new TradingServiceError(404, "USER_NOT_FOUND", "Trading user was not found.");
  }

  const positions = await tx.position.findMany({
    where: { userId: principal.userId },
    orderBy: [{ creatorId: "asc" }, { id: "asc" }],
  });
  const openOrders = await tx.order.findMany({
    where: { userId: principal.userId, status: { in: ["OPEN", "PARTIAL"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const executions = await tx.tradeExecution.findMany({
    where: { OR: [{ buyerId: principal.userId }, { sellerId: principal.userId }] },
    orderBy: [{ executedAt: "desc" }, { id: "desc" }],
  });

  return {
    balance: serializeQuote(user.balance),
    reservedBalance: serializeQuote(user.reservedBalance),
    availableBalance: serializeQuote(user.balance.minus(user.reservedBalance)),
    positions: positions.map(serializeTradingPosition),
    openOrders: openOrders.map(serializeTradingOrder),
    executions: executions.map(serializeTradingExecution),
  };
}

export async function getPortfolio(principal: AuthPrincipal): Promise<TradingPortfolio> {
  return getPortfolioInTransaction(prisma, principal);
}
