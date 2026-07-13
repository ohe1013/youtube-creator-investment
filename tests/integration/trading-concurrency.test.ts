import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PlaceOrderResult } from "@/lib/contracts/trading";
import { placeOrder } from "@/lib/server/trading/matching-service";
import {
  createTradingCreator,
  createTradingUser,
  decimal,
  decimalEquals,
  resetTradingFixtureTables,
  snapshotTradingAssets,
  TRADING_CREATOR_ID,
  tradingPrincipal,
} from "./trading-test-helpers";

const prisma = new PrismaClient();
const REAL_POSTGRES_TIMEOUT_MS = 20_000;

beforeAll(async () => prisma.$connect());
afterAll(async () => prisma.$disconnect());

describe.sequential("transactional trading concurrency", () => {
  beforeEach(async () => {
    await resetTradingFixtureTables(prisma);
    await createTradingCreator(prisma);
  });

  afterEach(async () => {
    await resetTradingFixtureTables(prisma);
  });

  it("does not allow concurrent buy reservations to overspend one balance", async () => {
    const buyer = await createTradingUser(prisma, { id: "concurrent-buyer" });
    const principal = tradingPrincipal(buyer.id);
    const before = await snapshotTradingAssets(prisma, [buyer.id]);

    const outcomes = await Promise.allSettled([
      placeOrder(
        principal,
        {
          creatorId: TRADING_CREATOR_ID,
          side: "BUY",
          orderType: "LIMIT",
          quantity: decimal("10"),
          limitPrice: decimal("10"),
        },
        "concurrent-buy-one",
      ),
      placeOrder(
        principal,
        {
          creatorId: TRADING_CREATOR_ID,
          side: "BUY",
          orderType: "LIMIT",
          quantity: decimal("10"),
          limitPrice: decimal("10"),
        },
        "concurrent-buy-two",
      ),
    ]);

    const fulfilled = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<PlaceOrderResult> =>
        outcome.status === "fulfilled",
    );
    const rejected = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected?.reason).toMatchObject({
      status: 409,
      code: "INSUFFICIENT_AVAILABLE_BALANCE",
    });

    const buyerAfter = await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } });
    const after = await snapshotTradingAssets(prisma, [buyer.id]);
    expect(decimalEquals(buyerAfter.balance, "100")).toBe(true);
    expect(decimalEquals(buyerAfter.reservedBalance, "100")).toBe(true);
    expect(decimalEquals(after.availableQuote, "0")).toBe(true);
    expect(decimalEquals(after.reservedQuote, "100")).toBe(true);
    expect(decimalEquals(after.totalQuote, before.totalQuote.toFixed())).toBe(true);
    expect(decimalEquals(after.activeOrderReservedQuote, "100")).toBe(true);
  }, REAL_POSTGRES_TIMEOUT_MS);

  it("does not allow two concurrent takers to double-fill one maker order", async () => {
    const maker = await createTradingUser(prisma, {
      id: "single-maker",
      positionQuantity: decimal("1"),
    });
    const firstTaker = await createTradingUser(prisma, { id: "first-taker" });
    const secondTaker = await createTradingUser(prisma, { id: "second-taker" });
    const userIds = [maker.id, firstTaker.id, secondTaker.id];
    const before = await snapshotTradingAssets(prisma, userIds);

    const makerOrder = await placeOrder(
      tradingPrincipal(maker.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "SELL",
        orderType: "LIMIT",
        quantity: decimal("1"),
        limitPrice: decimal("10"),
      },
      "single-maker-order",
    );

    await Promise.all([
      placeOrder(
        tradingPrincipal(firstTaker.id),
        {
          creatorId: TRADING_CREATOR_ID,
          side: "BUY",
          orderType: "LIMIT",
          quantity: decimal("1"),
          limitPrice: decimal("10"),
        },
        "first-taker-order",
      ),
      placeOrder(
        tradingPrincipal(secondTaker.id),
        {
          creatorId: TRADING_CREATOR_ID,
          side: "BUY",
          orderType: "LIMIT",
          quantity: decimal("1"),
          limitPrice: decimal("10"),
        },
        "second-taker-order",
      ),
    ]);

    const [persistedMaker, executions, buyOrders] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: makerOrder.order.id } }),
      prisma.tradeExecution.findMany({ where: { creatorId: TRADING_CREATOR_ID } }),
      prisma.order.findMany({
        where: { creatorId: TRADING_CREATOR_ID, type: "BUY" },
        orderBy: { userId: "asc" },
      }),
    ]);
    const after = await snapshotTradingAssets(prisma, userIds);

    expect(persistedMaker.status).toBe("FILLED");
    expect(decimalEquals(persistedMaker.filled, "1")).toBe(true);
    expect(executions).toHaveLength(1);
    expect(decimalEquals(executions[0]!.quantity, "1")).toBe(true);
    expect(buyOrders.filter((order) => decimalEquals(order.filled, "1"))).toHaveLength(1);
    expect(buyOrders.filter((order) => decimalEquals(order.filled, "0"))).toHaveLength(1);
    expect(decimalEquals(after.totalQuote, before.totalQuote.toFixed())).toBe(true);
    expect(decimalEquals(after.totalQuantity, before.totalQuantity.toFixed())).toBe(true);
    expect(decimalEquals(after.reservedQuote, after.activeOrderReservedQuote.toFixed())).toBe(true);
    expect(decimalEquals(after.reservedQuantity, after.activeOrderReservedQuantity.toFixed())).toBe(
      true,
    );
  }, REAL_POSTGRES_TIMEOUT_MS);
});
