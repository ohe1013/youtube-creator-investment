import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { decimalStringSchema, type DecimalString } from "@/lib/contracts/decimal";

export const QUOTE_SCALE = 4;
export const QUANTITY_SCALE = 8;

export type TradingSide = "BUY" | "SELL";
export type TradingOrderType = "LIMIT" | "MARKET";
export type TradingOrderStatus = "OPEN" | "PARTIAL" | "FILLED" | "CANCELLED";

export interface PlaceOrderInput {
  creatorId: string;
  side: TradingSide;
  orderType: TradingOrderType;
  quantity: DecimalString;
  limitPrice?: DecimalString;
  maxSlippageBps?: number;
}

const tradingIdentifierSchema = z.string().trim().min(1).max(128);
const positiveDecimalStringSchema = decimalStringSchema.refine(
  (value) => !value.startsWith("-") && !/^0(?:\.0+)?$/.test(value),
  "Expected a positive decimal string",
);

export const placeOrderRequestSchema = z.discriminatedUnion("orderType", [
  z
    .object({
      creatorId: tradingIdentifierSchema,
      side: z.enum(["BUY", "SELL"]),
      orderType: z.literal("LIMIT"),
      quantity: positiveDecimalStringSchema,
      limitPrice: positiveDecimalStringSchema,
    })
    .strict(),
  z
    .object({
      creatorId: tradingIdentifierSchema,
      side: z.enum(["BUY", "SELL"]),
      orderType: z.literal("MARKET"),
      quantity: positiveDecimalStringSchema,
      maxSlippageBps: z.number().int().min(0).max(1_000).optional(),
    })
    .strict(),
]);

export interface TradingOrder {
  id: string;
  userId: string;
  creatorId: string;
  side: TradingSide;
  orderType: TradingOrderType;
  price: DecimalString;
  quantity: DecimalString;
  filled: DecimalString;
  reservedQuote: DecimalString;
  reservedQuantity: DecimalString;
  status: TradingOrderStatus;
  completedAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TradingPosition {
  id: string;
  creatorId: string;
  quantity: DecimalString;
  reservedQuantity: DecimalString;
  avgPrice: DecimalString;
  createdAt: string;
  updatedAt: string;
}

export interface TradingExecution {
  id: string;
  creatorId: string;
  side: TradingSide;
  price: DecimalString;
  quantity: DecimalString;
  quoteAmount: DecimalString;
  executedAt: string;
}

export interface TradingPortfolio {
  balance: DecimalString;
  reservedBalance: DecimalString;
  availableBalance: DecimalString;
  positions: TradingPosition[];
  openOrders: TradingOrder[];
  executions: TradingExecution[];
}

export interface PlaceOrderResult {
  responseStatus: 201;
  order: TradingOrder;
  portfolio: TradingPortfolio;
}

export interface CancelOrderResult {
  responseStatus: 200;
  order: TradingOrder;
  portfolio: TradingPortfolio;
}

type DecimalValue = Prisma.Decimal;

export function serializeQuote(value: DecimalValue): DecimalString {
  return decimalStringSchema.parse(value.toFixed(QUOTE_SCALE));
}

export function serializeQuantity(value: DecimalValue): DecimalString {
  return decimalStringSchema.parse(value.toFixed(QUANTITY_SCALE));
}

export function serializeTradingOrder(order: {
  id: string;
  userId: string;
  creatorId: string;
  type: TradingSide;
  orderType: TradingOrderType;
  price: DecimalValue;
  quantity: DecimalValue;
  filled: DecimalValue;
  reservedQuote: DecimalValue;
  reservedQuantity: DecimalValue;
  status: TradingOrderStatus;
  completedAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}): TradingOrder {
  return {
    id: order.id,
    userId: order.userId,
    creatorId: order.creatorId,
    side: order.type,
    orderType: order.orderType,
    price: serializeQuote(order.price),
    quantity: serializeQuantity(order.quantity),
    filled: serializeQuantity(order.filled),
    reservedQuote: serializeQuote(order.reservedQuote),
    reservedQuantity: serializeQuantity(order.reservedQuantity),
    status: order.status,
    completedAt: order.completedAt?.toISOString() ?? null,
    cancelReason: order.cancelReason,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

export function serializeTradingPosition(position: {
  id: string;
  creatorId: string;
  quantity: DecimalValue;
  reservedQuantity: DecimalValue;
  avgPrice: DecimalValue;
  createdAt: Date;
  updatedAt: Date;
}): TradingPosition {
  return {
    id: position.id,
    creatorId: position.creatorId,
    quantity: serializeQuantity(position.quantity),
    reservedQuantity: serializeQuantity(position.reservedQuantity),
    avgPrice: serializeQuote(position.avgPrice),
    createdAt: position.createdAt.toISOString(),
    updatedAt: position.updatedAt.toISOString(),
  };
}

export function serializeTradingExecution(execution: {
  id: string;
  creatorId: string;
  price: DecimalValue;
  quantity: DecimalValue;
  quoteAmount: DecimalValue;
  executedAt: Date;
}, side: TradingSide): TradingExecution {
  return {
    id: execution.id,
    creatorId: execution.creatorId,
    side,
    price: serializeQuote(execution.price),
    quantity: serializeQuantity(execution.quantity),
    quoteAmount: serializeQuote(execution.quoteAmount),
    executedAt: execution.executedAt.toISOString(),
  };
}
