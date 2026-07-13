import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DecimalString } from "@/lib/contracts/decimal";
import { prisma as tradingPrisma } from "@/lib/prisma";
import { cancelOrder, placeOrder } from "@/lib/server/trading/matching-service";
import { getPortfolio } from "@/lib/server/trading/portfolio-service";
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

describe.sequential("transactional trading conservation and matching", () => {
  beforeEach(async () => {
    await resetTradingFixtureTables(prisma);
    await createTradingCreator(prisma);
  });

  afterEach(async () => {
    await resetTradingFixtureTables(prisma);
  });

  it("conserves available and reserved assets through a partial fill and cancellation", async () => {
    const seller = await createTradingUser(prisma, {
      id: "partial-seller",
      positionQuantity: decimal("2"),
    });
    const buyer = await createTradingUser(prisma, { id: "partial-buyer" });
    const userIds = [seller.id, buyer.id];
    const before = await snapshotTradingAssets(prisma, userIds);

    await placeOrder(
      tradingPrincipal(seller.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "SELL",
        orderType: "LIMIT",
        quantity: decimal("2"),
        limitPrice: decimal("10"),
      },
      "partial-maker",
    );
    const placed = await placeOrder(
      tradingPrincipal(buyer.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "BUY",
        orderType: "LIMIT",
        quantity: decimal("5"),
        limitPrice: decimal("10"),
      },
      "partial-taker",
    );

    expect(placed.responseStatus).toBe(201);
    expect(placed.order.status).toBe("PARTIAL");
    expect(placed.order.filled).toBe("2.00000000");
    expect(placed.order.reservedQuote).toBe("30.0000");

    const cancelled = await cancelOrder(
      tradingPrincipal(buyer.id),
      placed.order.id,
      "partial-cancel",
    );
    const [cancelledOrder, executions, portfolio] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } }),
      prisma.tradeExecution.findMany({ where: { creatorId: TRADING_CREATOR_ID } }),
      getPortfolio(tradingPrincipal(buyer.id)),
    ]);
    const after = await snapshotTradingAssets(prisma, userIds);

    expect(cancelled.responseStatus).toBe(200);
    expect(cancelledOrder.status).toBe("CANCELLED");
    expect(decimalEquals(cancelledOrder.filled, "2")).toBe(true);
    expect(decimalEquals(cancelledOrder.reservedQuote, "0")).toBe(true);
    expect(executions).toHaveLength(1);
    expect(decimalEquals(executions[0]!.quoteAmount, "20")).toBe(true);
    expect(portfolio.balance).toBe("80.0000");
    expect(portfolio.reservedBalance).toBe("0.0000");
    expect(portfolio.positions).toEqual([
      expect.objectContaining({ creatorId: TRADING_CREATOR_ID, quantity: "2.00000000" }),
    ]);
    expect(portfolio.executions[0]).toMatchObject({
      creatorId: TRADING_CREATOR_ID,
      side: "BUY",
      price: "10.0000",
      quantity: "2.00000000",
      quoteAmount: "20.0000",
    });
    for (const internalField of [
      "buyerId",
      "sellerId",
      "makerOrderId",
      "takerOrderId",
    ]) {
      expect(portfolio.executions[0]).not.toHaveProperty(internalField);
    }
    expect(decimalEquals(after.totalQuote, before.totalQuote.toFixed())).toBe(true);
    expect(decimalEquals(after.totalQuantity, before.totalQuantity.toFixed())).toBe(true);
    expect(decimalEquals(after.reservedQuote, "0")).toBe(true);
    expect(decimalEquals(after.reservedQuantity, "0")).toBe(true);
    expect(decimalEquals(after.activeOrderReservedQuote, "0")).toBe(true);
    expect(decimalEquals(after.activeOrderReservedQuantity, "0")).toBe(true);
  }, REAL_POSTGRES_TIMEOUT_MS);

  it("uses server price for market orders and cancels an unfilled remainder without retaining reserve", async () => {
    const seller = await createTradingUser(prisma, {
      id: "market-seller",
      positionQuantity: decimal("2"),
    });
    const buyer = await createTradingUser(prisma, { id: "market-buyer" });
    const userIds = [seller.id, buyer.id];
    const before = await snapshotTradingAssets(prisma, userIds);

    await placeOrder(
      tradingPrincipal(seller.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "SELL",
        orderType: "LIMIT",
        quantity: decimal("2"),
        limitPrice: decimal("10"),
      },
      "market-maker",
    );
    const market = await placeOrder(
      tradingPrincipal(buyer.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "BUY",
        orderType: "MARKET",
        quantity: decimal("5"),
        limitPrice: decimal("9999"),
        maxSlippageBps: 0,
      },
      "market-taker",
    );
    const [buyerAfter, marketOrder] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: buyer.id } }),
      prisma.order.findUniqueOrThrow({ where: { id: market.order.id } }),
    ]);
    const after = await snapshotTradingAssets(prisma, userIds);

    expect(market.order.status).toBe("CANCELLED");
    expect(market.order.price).toBe("10.0000");
    expect(market.order.filled).toBe("2.00000000");
    expect(market.order.reservedQuote).toBe("0.0000");
    expect(marketOrder.cancelReason).toBe("MARKET_REMAINDER");
    expect(decimalEquals(buyerAfter.balance, "80")).toBe(true);
    expect(decimalEquals(buyerAfter.reservedBalance, "0")).toBe(true);
    expect(decimalEquals(after.totalQuote, before.totalQuote.toFixed())).toBe(true);
    expect(decimalEquals(after.totalQuantity, before.totalQuantity.toFixed())).toBe(true);
    expect(decimalEquals(after.reservedQuote, "0")).toBe(true);
    expect(decimalEquals(after.reservedQuantity, "0")).toBe(true);
  }, REAL_POSTGRES_TIMEOUT_MS);

  it("uses the default slippage and truncates a derived market ceiling to quote scale", async () => {
    const buyer = await createTradingUser(prisma, { id: "default-market-buyer" });
    await prisma.creator.update({
      where: { id: TRADING_CREATOR_ID },
      data: { currentPrice: decimal("10.0001") },
    });

    const market = await placeOrder(
      tradingPrincipal(buyer.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "BUY",
        orderType: "MARKET",
        quantity: decimal("1"),
      },
      "default-market-order",
    );
    const buyerAfter = await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } });

    expect(market.order.price).toBe("10.5001");
    expect(market.order.status).toBe("CANCELLED");
    expect(market.order.reservedQuote).toBe("0.0000");
    expect(decimalEquals(buyerAfter.balance, "100")).toBe(true);
    expect(decimalEquals(buyerAfter.reservedBalance, "0")).toBe(true);
  }, REAL_POSTGRES_TIMEOUT_MS);

  it("applies deterministic price, time, then id priority", async () => {
    const cheapSeller = await createTradingUser(prisma, {
      id: "cheap-seller",
      positionQuantity: decimal("1"),
    });
    const earlySeller = await createTradingUser(prisma, {
      id: "early-seller",
      positionQuantity: decimal("1"),
    });
    const lateSeller = await createTradingUser(prisma, {
      id: "late-seller",
      positionQuantity: decimal("1"),
    });
    const buyer = await createTradingUser(prisma, { id: "priority-buyer" });

    const cheap = await placeOrder(
      tradingPrincipal(cheapSeller.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "SELL",
        orderType: "LIMIT",
        quantity: decimal("1"),
        limitPrice: decimal("9"),
      },
      "priority-cheap",
    );
    const early = await placeOrder(
      tradingPrincipal(earlySeller.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "SELL",
        orderType: "LIMIT",
        quantity: decimal("1"),
        limitPrice: decimal("10"),
      },
      "priority-early",
    );
    const late = await placeOrder(
      tradingPrincipal(lateSeller.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "SELL",
        orderType: "LIMIT",
        quantity: decimal("1"),
        limitPrice: decimal("10"),
      },
      "priority-late",
    );
    await Promise.all([
      prisma.order.update({
        where: { id: cheap.order.id },
        data: { createdAt: new Date("2026-01-01T00:00:03.000Z") },
      }),
      prisma.order.update({
        where: { id: early.order.id },
        data: {
          id: "priority-id-first",
          createdAt: new Date("2026-01-01T00:00:01.000Z"),
        },
      }),
      prisma.order.update({
        where: { id: late.order.id },
        data: {
          id: "priority-id-second",
          createdAt: new Date("2026-01-01T00:00:01.000Z"),
        },
      }),
    ]);

    await placeOrder(
      tradingPrincipal(buyer.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "BUY",
        orderType: "LIMIT",
        quantity: decimal("2"),
        limitPrice: decimal("10"),
      },
      "priority-taker",
    );
    const [cheapAfter, earlyAfter, lateAfter] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: cheap.order.id } }),
      prisma.order.findUniqueOrThrow({ where: { id: "priority-id-first" } }),
      prisma.order.findUniqueOrThrow({ where: { id: "priority-id-second" } }),
    ]);

    expect(cheapAfter.status).toBe("FILLED");
    expect(earlyAfter.status).toBe("FILLED");
    expect(lateAfter.status).toBe("OPEN");
    expect(decimalEquals(lateAfter.reservedQuantity, "1")).toBe(true);
  }, REAL_POSTGRES_TIMEOUT_MS);

  it("rejects non-representable decimal input and invalid market parameters before mutation", async () => {
    const buyer = await createTradingUser(prisma, { id: "invalid-input-buyer" });
    const principal = tradingPrincipal(buyer.id);
    const base = {
      creatorId: TRADING_CREATOR_ID,
      side: "BUY" as const,
      orderType: "LIMIT" as const,
      quantity: decimal("1"),
      limitPrice: decimal("10"),
    };

    await expect(
      placeOrder(principal, { ...base, quantity: "0" as DecimalString }, "invalid-zero"),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_ORDER_INPUT" });
    await expect(
      placeOrder(
        principal,
        { ...base, quantity: "0.000000001" as DecimalString },
        "invalid-scale",
      ),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_ORDER_INPUT" });
    await expect(
      placeOrder(
        principal,
        { ...base, quantity: "1e-8" as DecimalString },
        "invalid-non-plain",
      ),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_ORDER_INPUT" });
    await expect(
      placeOrder(
        principal,
        { ...base, limitPrice: "10.00001" as DecimalString },
        "invalid-price-scale",
      ),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_LIMIT_PRICE" });
    await expect(
      placeOrder(
        principal,
        { ...base, limitPrice: undefined },
        "missing-limit-price",
      ),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_LIMIT_PRICE" });
    await expect(
      placeOrder(
        principal,
        { ...base, limitPrice: "9999999999999999.9999" as DecimalString, quantity: decimal("2") },
        "invalid-derived-overflow",
      ),
    ).rejects.toMatchObject({ status: 400, code: "DERIVED_QUOTE_OVERFLOW" });
    await expect(
      placeOrder(
        principal,
        {
          creatorId: TRADING_CREATOR_ID,
          side: "BUY",
          orderType: "MARKET",
          quantity: decimal("1"),
          maxSlippageBps: 1_001,
        },
        "invalid-slippage",
      ),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_ORDER_INPUT" });

    await prisma.creator.update({
      where: { id: TRADING_CREATOR_ID },
      data: { currentPrice: decimal("0") },
    });
    await expect(
      placeOrder(
        principal,
        {
          creatorId: TRADING_CREATOR_ID,
          side: "BUY",
          orderType: "MARKET",
          quantity: decimal("1"),
        },
        "invalid-market-price",
      ),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_MARKET_PRICE" });
    await expect(prisma.order.count()).resolves.toBe(0);
  }, REAL_POSTGRES_TIMEOUT_MS);

  it("rejects a dust sell before it can become an unfillable resting order", async () => {
    const seller = await createTradingUser(prisma, {
      id: "dust-seller",
      positionQuantity: decimal("0.00000001"),
    });

    await expect(
      placeOrder(
        tradingPrincipal(seller.id),
        {
          creatorId: TRADING_CREATOR_ID,
          side: "SELL",
          orderType: "LIMIT",
          quantity: decimal("0.00000001"),
          limitPrice: decimal("1"),
        },
        "dust-sell",
      ),
    ).rejects.toMatchObject({ status: 400, code: "DERIVED_QUOTE_UNREPRESENTABLE" });

    const position = await prisma.position.findUniqueOrThrow({
      where: { userId_creatorId: { userId: seller.id, creatorId: TRADING_CREATOR_ID } },
    });
    await expect(prisma.order.count()).resolves.toBe(0);
    expect(decimalEquals(position.reservedQuantity, "0")).toBe(true);
  }, REAL_POSTGRES_TIMEOUT_MS);

  it("skips an unrepresentable partial fill and continues to an executable maker", async () => {
    const cheapSeller = await createTradingUser(prisma, {
      id: "small-quote-cheap-seller",
      positionQuantity: decimal("0.00010000"),
    });
    const executableSeller = await createTradingUser(prisma, {
      id: "small-quote-executable-seller",
      positionQuantity: decimal("0.00000100"),
    });
    const buyer = await createTradingUser(prisma, { id: "small-quote-buyer" });

    const cheap = await placeOrder(
      tradingPrincipal(cheapSeller.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "SELL",
        orderType: "LIMIT",
        quantity: decimal("0.00010000"),
        limitPrice: decimal("1"),
      },
      "small-quote-cheap-maker",
    );
    const executable = await placeOrder(
      tradingPrincipal(executableSeller.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "SELL",
        orderType: "LIMIT",
        quantity: decimal("0.00000100"),
        limitPrice: decimal("100"),
      },
      "small-quote-executable-maker",
    );

    const buy = await placeOrder(
      tradingPrincipal(buyer.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "BUY",
        orderType: "LIMIT",
        quantity: decimal("0.00000100"),
        limitPrice: decimal("100"),
      },
      "small-quote-taker",
    );
    const [cheapAfter, executableAfter] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: cheap.order.id } }),
      prisma.order.findUniqueOrThrow({ where: { id: executable.order.id } }),
    ]);

    expect(buy.order.status).toBe("FILLED");
    expect(cheapAfter.status).toBe("OPEN");
    expect(executableAfter.status).toBe("FILLED");
  }, REAL_POSTGRES_TIMEOUT_MS);

  it("keeps a SELL remainder active for a later higher bid that can execute it", async () => {
    const firstBuyer = await createTradingUser(prisma, { id: "sell-continuation-first-buyer" });
    const secondBuyer = await createTradingUser(prisma, { id: "sell-continuation-second-buyer" });
    const seller = await createTradingUser(prisma, {
      id: "sell-continuation-seller",
      positionQuantity: decimal("0.00010000"),
    });

    await placeOrder(
      tradingPrincipal(firstBuyer.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "BUY",
        orderType: "LIMIT",
        quantity: decimal("0.00000100"),
        limitPrice: decimal("100"),
      },
      "sell-continuation-first-maker",
    );
    await placeOrder(
      tradingPrincipal(secondBuyer.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "BUY",
        orderType: "LIMIT",
        quantity: decimal("0.00009900"),
        limitPrice: decimal("100"),
      },
      "sell-continuation-second-maker",
    );

    const sell = await placeOrder(
      tradingPrincipal(seller.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "SELL",
        orderType: "LIMIT",
        quantity: decimal("0.00010000"),
        limitPrice: decimal("1"),
      },
      "sell-continuation-taker",
    );
    const executions = await prisma.tradeExecution.findMany({
      where: { takerOrderId: sell.order.id },
      orderBy: { executedAt: "asc" },
    });
    const executionQuote = executions.reduce(
      (total, execution) => total.plus(execution.quoteAmount),
      new Prisma.Decimal("0"),
    );

    expect(sell.order.status).toBe("FILLED");
    expect(sell.order.filled).toBe("0.00010000");
    expect(sell.order.reservedQuantity).toBe("0.00000000");
    expect(executions).toHaveLength(2);
    expect(decimalEquals(executionQuote, "0.0100")).toBe(true);
  }, REAL_POSTGRES_TIMEOUT_MS);

  it("cancels and releases a buy dust remainder after an otherwise executable partial fill", async () => {
    const seller = await createTradingUser(prisma, {
      id: "buy-dust-remainder-seller",
      positionQuantity: decimal("0.00000100"),
    });
    const buyer = await createTradingUser(prisma, { id: "buy-dust-remainder-buyer" });

    await placeOrder(
      tradingPrincipal(seller.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "SELL",
        orderType: "LIMIT",
        quantity: decimal("0.00000100"),
        limitPrice: decimal("100"),
      },
      "buy-dust-remainder-maker",
    );
    const buy = await placeOrder(
      tradingPrincipal(buyer.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "BUY",
        orderType: "LIMIT",
        quantity: decimal("0.00000150"),
        limitPrice: decimal("100"),
      },
      "buy-dust-remainder-taker",
    );
    const buyerAfter = await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } });

    expect(buy.order.status).toBe("CANCELLED");
    expect(buy.order.cancelReason).toBe("DUST_REMAINDER");
    expect(buy.order.filled).toBe("0.00000100");
    expect(buy.order.reservedQuote).toBe("0.0000");
    expect(decimalEquals(buyerAfter.balance, "99.9999")).toBe(true);
    expect(decimalEquals(buyerAfter.reservedBalance, "0")).toBe(true);
  }, REAL_POSTGRES_TIMEOUT_MS);

  it("keeps a sell dust remainder reserved until an explicit cancellation", async () => {
    const seller = await createTradingUser(prisma, {
      id: "sell-dust-remainder-seller",
      positionQuantity: decimal("0.00000150"),
    });
    const buyer = await createTradingUser(prisma, { id: "sell-dust-remainder-buyer" });

    const sell = await placeOrder(
      tradingPrincipal(seller.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "SELL",
        orderType: "LIMIT",
        quantity: decimal("0.00000150"),
        limitPrice: decimal("100"),
      },
      "sell-dust-remainder-maker",
    );
    const partial = await placeOrder(
      tradingPrincipal(buyer.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "BUY",
        orderType: "LIMIT",
        quantity: decimal("0.00000100"),
        limitPrice: decimal("100"),
      },
      "sell-dust-remainder-taker",
    );
    const [sellAfterFill, positionAfterFill] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: sell.order.id } }),
      prisma.position.findUniqueOrThrow({
        where: { userId_creatorId: { userId: seller.id, creatorId: TRADING_CREATOR_ID } },
      }),
    ]);

    expect(partial.order.status).toBe("FILLED");
    expect(sellAfterFill.status).toBe("PARTIAL");
    expect(sellAfterFill.cancelReason).toBeNull();
    expect(decimalEquals(sellAfterFill.filled, "0.00000100")).toBe(true);
    expect(decimalEquals(sellAfterFill.reservedQuantity, "0.00000050")).toBe(true);
    expect(decimalEquals(positionAfterFill.quantity, "0.00000050")).toBe(true);
    expect(decimalEquals(positionAfterFill.reservedQuantity, "0.00000050")).toBe(true);

    await cancelOrder(tradingPrincipal(seller.id), sell.order.id, "sell-dust-remainder-cancel");
    const [sellAfterCancel, positionAfterCancel] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: sell.order.id } }),
      prisma.position.findUniqueOrThrow({
        where: { userId_creatorId: { userId: seller.id, creatorId: TRADING_CREATOR_ID } },
      }),
    ]);

    expect(sellAfterCancel.status).toBe("CANCELLED");
    expect(decimalEquals(sellAfterCancel.reservedQuantity, "0")).toBe(true);
    expect(decimalEquals(positionAfterCancel.quantity, "0.00000050")).toBe(true);
    expect(decimalEquals(positionAfterCancel.reservedQuantity, "0")).toBe(true);
  }, REAL_POSTGRES_TIMEOUT_MS);

  it("rejects a seller balance credit overflow without mutating a pending fill", async () => {
    const seller = await createTradingUser(prisma, {
      id: "balance-overflow-seller",
      balance: decimal("9999999999999999.9999"),
      positionQuantity: decimal("1"),
    });
    const buyer = await createTradingUser(prisma, { id: "balance-overflow-buyer" });
    const maker = await placeOrder(
      tradingPrincipal(seller.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "SELL",
        orderType: "LIMIT",
        quantity: decimal("1"),
        limitPrice: decimal("10"),
      },
      "balance-overflow-maker",
    );

    await expect(
      placeOrder(
        tradingPrincipal(buyer.id),
        {
          creatorId: TRADING_CREATOR_ID,
          side: "BUY",
          orderType: "LIMIT",
          quantity: decimal("1"),
          limitPrice: decimal("10"),
        },
        "balance-overflow-taker",
      ),
    ).rejects.toMatchObject({ status: 409, code: "TRADING_STATE_OVERFLOW" });

    const [sellerAfter, buyerAfter, makerAfter, orders, executions] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: seller.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: buyer.id } }),
      prisma.order.findUniqueOrThrow({ where: { id: maker.order.id } }),
      prisma.order.findMany({ where: { creatorId: TRADING_CREATOR_ID } }),
      prisma.tradeExecution.findMany({ where: { creatorId: TRADING_CREATOR_ID } }),
    ]);

    expect(decimalEquals(sellerAfter.balance, "9999999999999999.9999")).toBe(true);
    expect(decimalEquals(buyerAfter.balance, "100")).toBe(true);
    expect(decimalEquals(buyerAfter.reservedBalance, "0")).toBe(true);
    expect(makerAfter.status).toBe("OPEN");
    expect(decimalEquals(makerAfter.filled, "0")).toBe(true);
    expect(decimalEquals(makerAfter.reservedQuantity, "1")).toBe(true);
    expect(orders).toHaveLength(1);
    expect(executions).toHaveLength(0);
  }, REAL_POSTGRES_TIMEOUT_MS);

  it("rejects a buyer position overflow without mutating a pending fill", async () => {
    const buyer = await createTradingUser(prisma, {
      id: "position-overflow-buyer",
      positionQuantity: decimal("999999999999.99999999"),
    });
    const seller = await createTradingUser(prisma, {
      id: "position-overflow-seller",
      positionQuantity: decimal("1"),
    });
    const maker = await placeOrder(
      tradingPrincipal(seller.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "SELL",
        orderType: "LIMIT",
        quantity: decimal("1"),
        limitPrice: decimal("10"),
      },
      "position-overflow-maker",
    );

    await expect(
      placeOrder(
        tradingPrincipal(buyer.id),
        {
          creatorId: TRADING_CREATOR_ID,
          side: "BUY",
          orderType: "LIMIT",
          quantity: decimal("1"),
          limitPrice: decimal("10"),
        },
        "position-overflow-taker",
      ),
    ).rejects.toMatchObject({ status: 409, code: "TRADING_STATE_OVERFLOW" });

    const [buyerAfter, buyerPositionAfter, sellerPositionAfter, makerAfter, orders, executions] =
      await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: buyer.id } }),
        prisma.position.findUniqueOrThrow({
          where: { userId_creatorId: { userId: buyer.id, creatorId: TRADING_CREATOR_ID } },
        }),
        prisma.position.findUniqueOrThrow({
          where: { userId_creatorId: { userId: seller.id, creatorId: TRADING_CREATOR_ID } },
        }),
        prisma.order.findUniqueOrThrow({ where: { id: maker.order.id } }),
        prisma.order.findMany({ where: { creatorId: TRADING_CREATOR_ID } }),
        prisma.tradeExecution.findMany({ where: { creatorId: TRADING_CREATOR_ID } }),
      ]);

    expect(decimalEquals(buyerAfter.balance, "100")).toBe(true);
    expect(decimalEquals(buyerAfter.reservedBalance, "0")).toBe(true);
    expect(decimalEquals(buyerPositionAfter.quantity, "999999999999.99999999")).toBe(true);
    expect(decimalEquals(buyerPositionAfter.reservedQuantity, "0")).toBe(true);
    expect(decimalEquals(sellerPositionAfter.quantity, "1")).toBe(true);
    expect(decimalEquals(sellerPositionAfter.reservedQuantity, "1")).toBe(true);
    expect(makerAfter.status).toBe("OPEN");
    expect(decimalEquals(makerAfter.filled, "0")).toBe(true);
    expect(orders).toHaveLength(1);
    expect(executions).toHaveLength(0);
  }, REAL_POSTGRES_TIMEOUT_MS);

  it("reads a standalone portfolio in one repeatable-read transaction", async () => {
    const user = await createTradingUser(prisma, { id: "repeatable-read-user" });
    const transactionSpy = vi.spyOn(tradingPrisma, "$transaction");

    try {
      const portfolio = await getPortfolio(tradingPrincipal(user.id));

      expect(portfolio.balance).toBe("100.0000");
      expect(transactionSpy).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      });
    } finally {
      transactionSpy.mockRestore();
    }
  }, REAL_POSTGRES_TIMEOUT_MS);
});
