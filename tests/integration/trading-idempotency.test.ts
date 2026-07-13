import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { cancelOrder, placeOrder } from "@/lib/server/trading/matching-service";
import {
  createTradingCreator,
  createTradingUser,
  decimal,
  decimalEquals,
  resetTradingFixtureTables,
  TRADING_CREATOR_ID,
  tradingPrincipal,
} from "./trading-test-helpers";

const prisma = new PrismaClient();
const REAL_POSTGRES_TIMEOUT_MS = 20_000;

beforeAll(async () => prisma.$connect());
afterAll(async () => prisma.$disconnect());

describe.sequential("transactional trading idempotency and authorization", () => {
  beforeEach(async () => {
    await resetTradingFixtureTables(prisma);
    await createTradingCreator(prisma);
  });

  afterEach(async () => {
    await resetTradingFixtureTables(prisma);
  });

  it("replays an identical canonical place request without creating a second order", async () => {
    const buyer = await createTradingUser(prisma, { id: "replay-buyer" });
    const principal = tradingPrincipal(buyer.id);
    const first = await placeOrder(
      principal,
      {
        creatorId: TRADING_CREATOR_ID,
        side: "BUY",
        orderType: "LIMIT",
        quantity: decimal("1.0"),
        limitPrice: decimal("10.0000"),
      },
      "replay-place",
    );
    const replay = await placeOrder(
      principal,
      {
        creatorId: TRADING_CREATOR_ID,
        side: "BUY",
        orderType: "LIMIT",
        quantity: decimal("1.00000000"),
        limitPrice: decimal("10"),
      },
      "replay-place",
    );
    const record = await prisma.idempotencyRecord.findUniqueOrThrow({
      where: {
        userId_operation_key: {
          userId: buyer.id,
          operation: "place-order",
          key: "replay-place",
        },
      },
    });

    expect(first).toEqual(replay);
    expect(first.responseStatus).toBe(201);
    expect(await prisma.order.count()).toBe(1);
    expect(record.state).toBe("COMPLETED");
    expect(record.responseStatus).toBe(201);
    expect(record.responseBody).toEqual(first);
    expect(JSON.stringify(record.responseBody)).not.toContain("Decimal");
  }, REAL_POSTGRES_TIMEOUT_MS);

  it("rejects a reused idempotency key with a different canonical body", async () => {
    const buyer = await createTradingUser(prisma, { id: "reuse-buyer" });
    const principal = tradingPrincipal(buyer.id);
    const input = {
      creatorId: TRADING_CREATOR_ID,
      side: "BUY" as const,
      orderType: "LIMIT" as const,
      quantity: decimal("1"),
      limitPrice: decimal("10"),
    };

    await placeOrder(principal, input, "reuse-place");
    await expect(
      placeOrder(
        principal,
        { ...input, quantity: decimal("2") },
        "reuse-place",
      ),
    ).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
    await expect(prisma.order.count()).resolves.toBe(1);
  }, REAL_POSTGRES_TIMEOUT_MS);

  it("returns a deterministic retryable conflict for an in-progress place claim", async () => {
    const buyer = await createTradingUser(prisma, { id: "in-progress-buyer" });
    const principal = tradingPrincipal(buyer.id);
    const input = {
      creatorId: TRADING_CREATOR_ID,
      side: "BUY" as const,
      orderType: "LIMIT" as const,
      quantity: decimal("1"),
      limitPrice: decimal("10"),
    };

    await placeOrder(principal, input, "in-progress-place");
    await prisma.idempotencyRecord.update({
      where: {
        userId_operation_key: {
          userId: buyer.id,
          operation: "place-order",
          key: "in-progress-place",
        },
      },
      data: { state: "IN_PROGRESS", responseStatus: null, responseBody: undefined },
    });

    await expect(placeOrder(principal, input, "in-progress-place")).rejects.toMatchObject({
      status: 409,
      code: "IDEMPOTENCY_REQUEST_IN_PROGRESS",
    });
    await expect(prisma.order.count()).resolves.toBe(1);
  }, REAL_POSTGRES_TIMEOUT_MS);

  it("reclaims an expired idempotency key before applying a new place mutation", async () => {
    const buyer = await createTradingUser(prisma, { id: "expired-buyer" });
    const principal = tradingPrincipal(buyer.id);
    const first = await placeOrder(
      principal,
      {
        creatorId: TRADING_CREATOR_ID,
        side: "BUY",
        orderType: "LIMIT",
        quantity: decimal("1"),
        limitPrice: decimal("10"),
      },
      "expired-place",
    );
    await prisma.idempotencyRecord.update({
      where: {
        userId_operation_key: {
          userId: buyer.id,
          operation: "place-order",
          key: "expired-place",
        },
      },
      data: { expiresAt: new Date("2000-01-01T00:00:00.000Z") },
    });
    const reclaimed = await placeOrder(
      principal,
      {
        creatorId: TRADING_CREATOR_ID,
        side: "BUY",
        orderType: "LIMIT",
        quantity: decimal("2"),
        limitPrice: decimal("10"),
      },
      "expired-place",
    );

    expect(reclaimed.order.id).not.toBe(first.order.id);
    expect(await prisma.order.count()).toBe(2);
    await expect(prisma.idempotencyRecord.count()).resolves.toBe(1);
  }, REAL_POSTGRES_TIMEOUT_MS);

  it("rejects a self-cross before creating or reserving a taker order", async () => {
    const user = await createTradingUser(prisma, {
      id: "self-trader",
      positionQuantity: decimal("1"),
    });
    const principal = tradingPrincipal(user.id);
    await placeOrder(
      principal,
      {
        creatorId: TRADING_CREATOR_ID,
        side: "SELL",
        orderType: "LIMIT",
        quantity: decimal("1"),
        limitPrice: decimal("10"),
      },
      "self-maker",
    );

    await expect(
      placeOrder(
        principal,
        {
          creatorId: TRADING_CREATOR_ID,
          side: "BUY",
          orderType: "LIMIT",
          quantity: decimal("1"),
          limitPrice: decimal("10"),
        },
        "self-taker",
      ),
    ).rejects.toMatchObject({ status: 409, code: "SELF_TRADE_PROHIBITED" });

    const [orders, currentUser, position] = await Promise.all([
      prisma.order.findMany({ where: { userId: user.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      prisma.position.findUniqueOrThrow({
        where: { userId_creatorId: { userId: user.id, creatorId: TRADING_CREATOR_ID } },
      }),
    ]);
    expect(orders).toHaveLength(1);
    expect(decimalEquals(currentUser.reservedBalance, "0")).toBe(true);
    expect(decimalEquals(position.reservedQuantity, "1")).toBe(true);
  }, REAL_POSTGRES_TIMEOUT_MS);

  it("rejects cross-user cancellation and replays a completed owner cancellation", async () => {
    const owner = await createTradingUser(prisma, { id: "cancel-owner" });
    const other = await createTradingUser(prisma, { id: "cancel-other" });
    const placed = await placeOrder(
      tradingPrincipal(owner.id),
      {
        creatorId: TRADING_CREATOR_ID,
        side: "BUY",
        orderType: "LIMIT",
        quantity: decimal("1"),
        limitPrice: decimal("10"),
      },
      "cancel-owner-place",
    );

    await expect(
      cancelOrder(tradingPrincipal(other.id), placed.order.id, "cancel-other-key"),
    ).rejects.toMatchObject({ status: 403, code: "ORDER_FORBIDDEN" });

    const cancelled = await cancelOrder(
      tradingPrincipal(owner.id),
      placed.order.id,
      "cancel-owner-place",
    );
    const replay = await cancelOrder(
      tradingPrincipal(owner.id),
      placed.order.id,
      "cancel-owner-place",
    );
    const ownerAfter = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });

    expect(cancelled).toEqual(replay);
    expect(cancelled.responseStatus).toBe(200);
    expect(cancelled.order.status).toBe("CANCELLED");
    expect(decimalEquals(ownerAfter.reservedBalance, "0")).toBe(true);
  }, REAL_POSTGRES_TIMEOUT_MS);
});
