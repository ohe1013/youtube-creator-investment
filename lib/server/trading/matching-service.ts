import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { OrderStatus, Prisma, TradeType } from "@prisma/client";

import {
  QUANTITY_SCALE,
  QUOTE_SCALE,
  serializeTradingOrder,
  type CancelOrderResult,
  type PlaceOrderInput,
  type PlaceOrderResult,
  type TradingOrderType,
  type TradingSide,
} from "@/lib/contracts/trading";
import { decimalStringSchema, type DecimalString } from "@/lib/contracts/decimal";
import { prisma } from "@/lib/prisma";
import type { AuthPrincipal } from "@/lib/server/auth/types";
import { TradingServiceError } from "@/lib/server/trading/errors";
import { getPortfolioInTransaction } from "@/lib/server/trading/portfolio-service";
import {
  acquireCreatorAdvisoryLock,
  withSerializableRetry,
} from "@/lib/server/trading/serializable-transaction";

const ZERO = new Prisma.Decimal("0");
const ONE = new Prisma.Decimal("1");
const MAX_QUOTE = new Prisma.Decimal("9999999999999999.9999");
const MAX_QUANTITY = new Prisma.Decimal("999999999999.99999999");
const DEFAULT_MAX_SLIPPAGE_BPS = 500;
const MAX_SLIPPAGE_BPS = 1_000;
const IDEMPOTENCY_EXPIRY_MS = 24 * 60 * 60 * 1_000;
const ACTIVE_ORDER_STATUSES: OrderStatus[] = ["OPEN", "PARTIAL"];

type NormalizedDecimal = {
  value: Prisma.Decimal;
  canonical: DecimalString;
};

type NormalizedPlaceOrder = {
  creatorId: string;
  side: TradingSide;
  orderType: TradingOrderType;
  quantity: NormalizedDecimal;
  limitPrice: NormalizedDecimal | null;
  maxSlippageBps: number | null;
  requestHash: string;
};

type IdempotencyClaim<T> =
  | { kind: "new"; id: string }
  | { kind: "replay"; response: T };

function tradingError(status: number, code: string, message: string): TradingServiceError {
  return new TradingServiceError(status, code, message);
}

function decimalAtScale(value: unknown, scale: number, maximum: Prisma.Decimal, code: string) {
  if (typeof value !== "string" || !decimalStringSchema.safeParse(value).success) {
    throw tradingError(400, code, "Expected a plain positive decimal string.");
  }

  const decimal = new Prisma.Decimal(value);
  if (
    !decimal.isFinite() ||
    !decimal.greaterThan(ZERO) ||
    (decimal.decimalPlaces() ?? 0) > scale ||
    decimal.greaterThan(maximum)
  ) {
    throw tradingError(400, code, "Decimal value cannot be represented safely.");
  }

  return {
    value: decimal,
    canonical: decimalStringSchema.parse(decimal.toFixed()),
  } satisfies NormalizedDecimal;
}

function normalizedIdempotencyKey(idempotencyKey: string) {
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
    throw tradingError(400, "INVALID_IDEMPOTENCY_KEY", "An idempotency key is required.");
  }
  return idempotencyKey.trim();
}

function hashCanonicalRequest(value: object) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizePlaceOrder(input: PlaceOrderInput): NormalizedPlaceOrder {
  if (!input || typeof input.creatorId !== "string" || input.creatorId.length === 0) {
    throw tradingError(400, "INVALID_ORDER_INPUT", "A creator is required.");
  }
  if (input.side !== "BUY" && input.side !== "SELL") {
    throw tradingError(400, "INVALID_ORDER_INPUT", "Order side is invalid.");
  }
  if (input.orderType !== "LIMIT" && input.orderType !== "MARKET") {
    throw tradingError(400, "INVALID_ORDER_INPUT", "Order type is invalid.");
  }

  const quantity = decimalAtScale(input.quantity, QUANTITY_SCALE, MAX_QUANTITY, "INVALID_ORDER_INPUT");

  if (input.orderType === "LIMIT") {
    const limitPrice = decimalAtScale(input.limitPrice, QUOTE_SCALE, MAX_QUOTE, "INVALID_LIMIT_PRICE");
    return {
      creatorId: input.creatorId,
      side: input.side,
      orderType: input.orderType,
      quantity,
      limitPrice,
      maxSlippageBps: null,
      requestHash: hashCanonicalRequest({
        creatorId: input.creatorId,
        side: input.side,
        orderType: input.orderType,
        quantity: quantity.canonical,
        limitPrice: limitPrice.canonical,
      }),
    };
  }

  const maxSlippageBps = input.maxSlippageBps ?? DEFAULT_MAX_SLIPPAGE_BPS;
  if (
    typeof maxSlippageBps !== "number" ||
    !Number.isInteger(maxSlippageBps) ||
    maxSlippageBps < 0 ||
    maxSlippageBps > MAX_SLIPPAGE_BPS
  ) {
    throw tradingError(400, "INVALID_ORDER_INPUT", "Maximum slippage is invalid.");
  }

  return {
    creatorId: input.creatorId,
    side: input.side,
    orderType: input.orderType,
    quantity,
    limitPrice: null,
    maxSlippageBps,
    requestHash: hashCanonicalRequest({
      creatorId: input.creatorId,
      side: input.side,
      orderType: input.orderType,
      quantity: quantity.canonical,
      maxSlippageBps,
    }),
  };
}

/** All derived quote amounts are truncated toward zero to four decimal places. */
function quantizeQuote(value: Prisma.Decimal) {
  const quantized = value.toDecimalPlaces(QUOTE_SCALE, Prisma.Decimal.ROUND_DOWN);
  if (!quantized.isFinite() || quantized.isNegative() || quantized.greaterThan(MAX_QUOTE)) {
    throw tradingError(400, "DERIVED_QUOTE_OVERFLOW", "Derived quote value cannot be represented safely.");
  }
  return quantized;
}

function requirePositiveQuote(value: Prisma.Decimal) {
  if (!value.greaterThan(ZERO)) {
    throw tradingError(
      400,
      "DERIVED_QUOTE_UNREPRESENTABLE",
      "Derived quote value is too small to represent safely.",
    );
  }
  return value;
}

function reserveQuoteFor(price: Prisma.Decimal, quantity: Prisma.Decimal) {
  return requirePositiveQuote(quantizeQuote(price.times(quantity)));
}

function remainingQuantity(order: {
  quantity: Prisma.Decimal;
  filled: Prisma.Decimal;
}) {
  return order.quantity.minus(order.filled);
}

function nextOrderStatus(
  filled: Prisma.Decimal,
  quantity: Prisma.Decimal,
  dustRemainder: boolean,
): OrderStatus {
  if (filled.equals(quantity)) return "FILLED";
  return dustRemainder ? "CANCELLED" : "PARTIAL";
}

function marketPriceBound(
  currentPrice: Prisma.Decimal,
  side: TradingSide,
  maxSlippageBps: number,
) {
  if (!currentPrice.greaterThan(ZERO) || currentPrice.greaterThan(MAX_QUOTE)) {
    throw tradingError(400, "INVALID_MARKET_PRICE", "Server market price is invalid.");
  }

  const slippage = new Prisma.Decimal(String(maxSlippageBps)).dividedBy("10000");
  const multiplier = side === "BUY" ? ONE.plus(slippage) : ONE.minus(slippage);
  return requirePositiveQuote(quantizeQuote(currentPrice.times(multiplier)));
}

function asStoredResponse<T>(responseBody: Prisma.JsonValue | null): T {
  if (!responseBody || typeof responseBody !== "object" || Array.isArray(responseBody)) {
    throw tradingError(500, "IDEMPOTENCY_RESPONSE_INVALID", "Stored idempotency response is invalid.");
  }
  return responseBody as T;
}

function asJson(value: object): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function claimIdempotency<T>(
  tx: Prisma.TransactionClient,
  input: { userId: string; operation: "place-order" | "cancel-order"; key: string; requestHash: string },
): Promise<IdempotencyClaim<T>> {
  const now = new Date();
  const lookup = {
    userId_operation_key: {
      userId: input.userId,
      operation: input.operation,
      key: input.key,
    },
  };
  let existing = await tx.idempotencyRecord.findUnique({ where: lookup });

  if (existing && existing.expiresAt <= now) {
    await tx.idempotencyRecord.delete({ where: { id: existing.id } });
    existing = null;
  }

  if (existing) return resolveExistingClaim<T>(existing, input.requestHash);

  const recordId = randomUUID();
  const inserted = await tx.$executeRaw`
    INSERT INTO "IdempotencyRecord" (
      "id", "userId", "operation", "key", "requestHash", "state", "expiresAt"
    ) VALUES (
      ${recordId}, ${input.userId}, ${input.operation}, ${input.key}, ${input.requestHash},
      ${"IN_PROGRESS"}, ${new Date(now.getTime() + IDEMPOTENCY_EXPIRY_MS)}
    ) ON CONFLICT ("userId", "operation", "key") DO NOTHING
  `;

  if (inserted === 1) return { kind: "new", id: recordId };

  existing = await tx.idempotencyRecord.findUnique({ where: lookup });
  if (!existing) {
    throw tradingError(409, "IDEMPOTENCY_REQUEST_IN_PROGRESS", "Request is already in progress.");
  }
  return resolveExistingClaim<T>(existing, input.requestHash);
}

function resolveExistingClaim<T>(
  record: {
    requestHash: string;
    state: string;
    responseBody: Prisma.JsonValue | null;
  },
  requestHash: string,
): IdempotencyClaim<T> {
  if (record.requestHash !== requestHash) {
    throw tradingError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was reused for another request.");
  }
  if (record.state === "COMPLETED") {
    return { kind: "replay", response: asStoredResponse<T>(record.responseBody) };
  }
  throw tradingError(409, "IDEMPOTENCY_REQUEST_IN_PROGRESS", "Request is already in progress.");
}

async function completeIdempotency(
  tx: Prisma.TransactionClient,
  recordId: string,
  responseStatus: number,
  response: object,
) {
  await tx.idempotencyRecord.update({
    where: { id: recordId },
    data: {
      state: "COMPLETED",
      responseStatus,
      responseBody: asJson(response),
    },
  });
}

async function rejectSelfCross(
  tx: Prisma.TransactionClient,
  input: { userId: string; creatorId: string; side: TradingSide; price: Prisma.Decimal },
) {
  const oppositeType: TradeType = input.side === "BUY" ? "SELL" : "BUY";
  const ownCross = await tx.order.findFirst({
    where: {
      creatorId: input.creatorId,
      userId: input.userId,
      type: oppositeType,
      status: { in: ACTIVE_ORDER_STATUSES },
      price: input.side === "BUY" ? { lte: input.price } : { gte: input.price },
    },
    select: { id: true },
    orderBy: [{ price: input.side === "BUY" ? "asc" : "desc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  if (ownCross) {
    throw tradingError(409, "SELF_TRADE_PROHIBITED", "Orders cannot cross with the same user.");
  }
}

async function reserveAssets(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    creatorId: string;
    side: TradingSide;
    quote: Prisma.Decimal;
    quantity: Prisma.Decimal;
  },
) {
  if (input.side === "BUY") {
    const affected = await tx.$executeRaw`
      UPDATE "User"
      SET "reservedBalance" = "reservedBalance" + ${input.quote}
      WHERE "id" = ${input.userId}
        AND "balance" - "reservedBalance" >= ${input.quote}
    `;
    if (affected !== 1) {
      throw tradingError(409, "INSUFFICIENT_AVAILABLE_BALANCE", "Available balance is insufficient.");
    }
    return;
  }

  const affected = await tx.$executeRaw`
    UPDATE "Position"
    SET "reservedQuantity" = "reservedQuantity" + ${input.quantity}
    WHERE "userId" = ${input.userId}
      AND "creatorId" = ${input.creatorId}
      AND "quantity" - "reservedQuantity" >= ${input.quantity}
  `;
  if (affected !== 1) {
    throw tradingError(409, "INSUFFICIENT_AVAILABLE_POSITION", "Available position is insufficient.");
  }
}

async function updateBuyOrderForFill(
  tx: Prisma.TransactionClient,
  order: {
    id: string;
    userId: string;
    price: Prisma.Decimal;
    quantity: Prisma.Decimal;
    filled: Prisma.Decimal;
    reservedQuote: Prisma.Decimal;
  },
  quantity: Prisma.Decimal,
  quoteAmount: Prisma.Decimal,
) {
  const filled = order.filled.plus(quantity);
  const remaining = order.quantity.minus(filled);
  const remainingQuote = remaining.greaterThan(ZERO)
    ? quantizeQuote(order.price.times(remaining))
    : ZERO;
  const dustRemainder = remaining.greaterThan(ZERO) && !remainingQuote.greaterThan(ZERO);
  const reservedQuote = dustRemainder ? ZERO : remainingQuote;
  const release = order.reservedQuote.minus(reservedQuote);
  if (release.lessThan(quoteAmount) || release.isNegative()) {
    throw tradingError(500, "TRADING_RESERVE_INCONSISTENT", "Buy reserve is inconsistent.");
  }

  const status = nextOrderStatus(filled, order.quantity, dustRemainder);
  await tx.user.update({
    where: { id: order.userId },
    data: {
      balance: { decrement: quoteAmount },
      reservedBalance: { decrement: release },
    },
  });
  return tx.order.update({
    where: { id: order.id },
    data: {
      filled,
      reservedQuote,
      status,
      completedAt: status === "OPEN" || status === "PARTIAL" ? null : new Date(),
      cancelReason: dustRemainder ? "DUST_REMAINDER" : null,
    },
  });
}

async function updateSellOrderForFill(
  tx: Prisma.TransactionClient,
  order: {
    id: string;
    userId: string;
    creatorId: string;
    price: Prisma.Decimal;
    quantity: Prisma.Decimal;
    filled: Prisma.Decimal;
    reservedQuantity: Prisma.Decimal;
  },
  quantity: Prisma.Decimal,
  quoteAmount: Prisma.Decimal,
) {
  const filled = order.filled.plus(quantity);
  const remaining = order.quantity.minus(filled);
  const remainingQuote = remaining.greaterThan(ZERO)
    ? quantizeQuote(order.price.times(remaining))
    : ZERO;
  const dustRemainder = remaining.greaterThan(ZERO) && !remainingQuote.greaterThan(ZERO);
  const reservedQuantity = dustRemainder ? ZERO : remaining;
  const release = order.reservedQuantity.minus(reservedQuantity);
  if (release.lessThan(quantity) || release.isNegative()) {
    throw tradingError(500, "TRADING_RESERVE_INCONSISTENT", "Sell reserve is inconsistent.");
  }

  const status = nextOrderStatus(filled, order.quantity, dustRemainder);
  await tx.position.update({
    where: { userId_creatorId: { userId: order.userId, creatorId: order.creatorId } },
    data: {
      quantity: { decrement: quantity },
      reservedQuantity: { decrement: release },
    },
  });
  await tx.user.update({ where: { id: order.userId }, data: { balance: { increment: quoteAmount } } });
  return tx.order.update({
    where: { id: order.id },
    data: {
      filled,
      reservedQuantity,
      status,
      completedAt: status === "OPEN" || status === "PARTIAL" ? null : new Date(),
      cancelReason: dustRemainder ? "DUST_REMAINDER" : null,
    },
  });
}

async function creditBuyerPosition(
  tx: Prisma.TransactionClient,
  input: { userId: string; creatorId: string; quantity: Prisma.Decimal; quoteAmount: Prisma.Decimal },
) {
  const existing = await tx.position.findUnique({
    where: { userId_creatorId: { userId: input.userId, creatorId: input.creatorId } },
  });

  if (!existing) {
    await tx.position.create({
      data: {
        userId: input.userId,
        creatorId: input.creatorId,
        quantity: input.quantity,
        reservedQuantity: ZERO,
        avgPrice: quantizeQuote(input.quoteAmount.dividedBy(input.quantity)),
      },
    });
    return;
  }

  const quantity = existing.quantity.plus(input.quantity);
  const totalCost = existing.avgPrice.times(existing.quantity).plus(input.quoteAmount);
  await tx.position.update({
    where: { id: existing.id },
    data: {
      quantity,
      avgPrice: quantizeQuote(totalCost.dividedBy(quantity)),
    },
  });
}

async function executeFill(
  tx: Prisma.TransactionClient,
  taker: Prisma.OrderGetPayload<Record<string, never>>,
  maker: Prisma.OrderGetPayload<Record<string, never>>,
) {
  const quantity = Prisma.Decimal.min(remainingQuantity(taker), remainingQuantity(maker));
  if (!quantity.greaterThan(ZERO)) {
    throw tradingError(500, "TRADING_ORDER_INCONSISTENT", "Active order has no remaining quantity.");
  }
  const quoteAmount = requirePositiveQuote(quantizeQuote(maker.price.times(quantity)));
  const buyer = taker.type === "BUY" ? taker : maker;
  const seller = taker.type === "SELL" ? taker : maker;

  const updatedTaker =
    taker.type === "BUY"
      ? await updateBuyOrderForFill(tx, taker, quantity, quoteAmount)
      : await updateSellOrderForFill(tx, taker, quantity, quoteAmount);
  if (maker.type === "BUY") {
    await updateBuyOrderForFill(tx, maker, quantity, quoteAmount);
  } else {
    await updateSellOrderForFill(tx, maker, quantity, quoteAmount);
  }

  await creditBuyerPosition(tx, {
    userId: buyer.userId,
    creatorId: buyer.creatorId,
    quantity,
    quoteAmount,
  });
  await tx.tradeExecution.create({
    data: {
      makerOrderId: maker.id,
      takerOrderId: taker.id,
      buyerId: buyer.userId,
      sellerId: seller.userId,
      creatorId: taker.creatorId,
      price: maker.price,
      quantity,
      quoteAmount,
    },
  });
  await tx.creator.update({ where: { id: taker.creatorId }, data: { currentPrice: maker.price } });

  return updatedTaker;
}

async function findExecutableMaker(
  tx: Prisma.TransactionClient,
  taker: Prisma.OrderGetPayload<Record<string, never>>,
) {
  const candidates = await tx.order.findMany({
    where: {
      creatorId: taker.creatorId,
      userId: { not: taker.userId },
      type: taker.type === "BUY" ? "SELL" : "BUY",
      status: { in: ACTIVE_ORDER_STATUSES },
      price: taker.type === "BUY" ? { lte: taker.price } : { gte: taker.price },
    },
    orderBy: [
      { price: taker.type === "BUY" ? "asc" : "desc" },
      { createdAt: "asc" },
      { id: "asc" },
    ],
  });

  return (
    candidates.find((candidate) => {
      const quantity = Prisma.Decimal.min(remainingQuantity(taker), remainingQuantity(candidate));
      return quantity.greaterThan(ZERO) && quantizeQuote(candidate.price.times(quantity)).greaterThan(ZERO);
    }) ?? null
  );
}

async function matchOrder(tx: Prisma.TransactionClient, orderId: string) {
  let taker = await tx.order.findUniqueOrThrow({ where: { id: orderId } });

  while (ACTIVE_ORDER_STATUSES.includes(taker.status)) {
    const maker = await findExecutableMaker(tx, taker);
    if (!maker) break;
    taker = await executeFill(tx, taker, maker);
  }

  return taker;
}

async function cancelRemainingOrder(
  tx: Prisma.TransactionClient,
  order: Prisma.OrderGetPayload<Record<string, never>>,
  reason: string | null,
) {
  if (!ACTIVE_ORDER_STATUSES.includes(order.status)) {
    throw tradingError(409, "ORDER_NOT_CANCELLABLE", "Order is not active.");
  }

  if (order.type === "BUY") {
    await tx.user.update({
      where: { id: order.userId },
      data: { reservedBalance: { decrement: order.reservedQuote } },
    });
  } else {
    await tx.position.update({
      where: { userId_creatorId: { userId: order.userId, creatorId: order.creatorId } },
      data: { reservedQuantity: { decrement: order.reservedQuantity } },
    });
  }

  return tx.order.update({
    where: { id: order.id },
    data: {
      reservedQuote: ZERO,
      reservedQuantity: ZERO,
      status: "CANCELLED",
      completedAt: new Date(),
      cancelReason: reason,
    },
  });
}

async function effectiveOrderPrice(
  tx: Prisma.TransactionClient,
  input: NormalizedPlaceOrder,
) {
  const creator = await tx.creator.findUnique({
    where: { id: input.creatorId },
    select: { currentPrice: true },
  });
  if (!creator) {
    throw tradingError(404, "CREATOR_NOT_FOUND", "Creator was not found.");
  }
  if (input.orderType === "LIMIT") return input.limitPrice!.value;
  return marketPriceBound(creator.currentPrice, input.side, input.maxSlippageBps!);
}

export async function placeOrder(
  principal: AuthPrincipal,
  input: PlaceOrderInput,
  idempotencyKey: string,
): Promise<PlaceOrderResult> {
  const normalized = normalizePlaceOrder(input);
  const key = normalizedIdempotencyKey(idempotencyKey);

  return withSerializableRetry(async (tx) => {
    await acquireCreatorAdvisoryLock(tx, normalized.creatorId);
    const claim = await claimIdempotency<PlaceOrderResult>(tx, {
      userId: principal.userId,
      operation: "place-order",
      key,
      requestHash: normalized.requestHash,
    });
    if (claim.kind === "replay") return claim.response;

    const price = await effectiveOrderPrice(tx, normalized);
    const executableQuote = reserveQuoteFor(price, normalized.quantity.value);
    const reserveQuote = normalized.side === "BUY" ? executableQuote : ZERO;
    await rejectSelfCross(tx, {
      userId: principal.userId,
      creatorId: normalized.creatorId,
      side: normalized.side,
      price,
    });
    await reserveAssets(tx, {
      userId: principal.userId,
      creatorId: normalized.creatorId,
      side: normalized.side,
      quote: reserveQuote,
      quantity: normalized.quantity.value,
    });

    const created = await tx.order.create({
      data: {
        userId: principal.userId,
        creatorId: normalized.creatorId,
        type: normalized.side,
        orderType: normalized.orderType,
        price,
        quantity: normalized.quantity.value,
        filled: ZERO,
        reservedQuote: normalized.side === "BUY" ? reserveQuote : ZERO,
        reservedQuantity: normalized.side === "SELL" ? normalized.quantity.value : ZERO,
        status: "OPEN",
      },
    });

    let completed = await matchOrder(tx, created.id);
    if (normalized.orderType === "MARKET" && ACTIVE_ORDER_STATUSES.includes(completed.status)) {
      completed = await cancelRemainingOrder(tx, completed, "MARKET_REMAINDER");
    }

    const order = await tx.order.findUniqueOrThrow({ where: { id: completed.id } });
    const portfolio = await getPortfolioInTransaction(tx, principal);
    const response: PlaceOrderResult = {
      responseStatus: 201,
      order: serializeTradingOrder(order),
      portfolio,
    };
    await completeIdempotency(tx, claim.id, response.responseStatus, response);
    return response;
  });
}

export async function cancelOrder(
  principal: AuthPrincipal,
  orderId: string,
  idempotencyKey: string,
): Promise<CancelOrderResult> {
  const key = normalizedIdempotencyKey(idempotencyKey);
  if (typeof orderId !== "string" || orderId.length === 0) {
    throw tradingError(400, "INVALID_ORDER_ID", "Order id is required.");
  }

  const located = await prisma.order.findUnique({
    where: { id: orderId },
    select: { creatorId: true },
  });
  if (!located) {
    throw tradingError(404, "ORDER_NOT_FOUND", "Order was not found.");
  }
  const requestHash = hashCanonicalRequest({ orderId });

  return withSerializableRetry(async (tx) => {
    await acquireCreatorAdvisoryLock(tx, located.creatorId);
    const claim = await claimIdempotency<CancelOrderResult>(tx, {
      userId: principal.userId,
      operation: "cancel-order",
      key,
      requestHash,
    });
    if (claim.kind === "replay") return claim.response;

    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw tradingError(404, "ORDER_NOT_FOUND", "Order was not found.");
    }
    if (order.userId !== principal.userId) {
      throw tradingError(403, "ORDER_FORBIDDEN", "Order belongs to another user.");
    }
    const cancelled = await cancelRemainingOrder(tx, order, null);
    const reloadedOrder = await tx.order.findUniqueOrThrow({ where: { id: cancelled.id } });
    const portfolio = await getPortfolioInTransaction(tx, principal);
    const response: CancelOrderResult = {
      responseStatus: 200,
      order: serializeTradingOrder(reloadedOrder),
      portfolio,
    };
    await completeIdempotency(tx, claim.id, response.responseStatus, response);
    return response;
  });
}
