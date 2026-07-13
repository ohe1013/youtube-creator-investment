import { Prisma, PrismaClient } from "@prisma/client";

import { decimalStringSchema, type DecimalString } from "@/lib/contracts/decimal";
import type { AuthPrincipal } from "@/lib/server/auth/types";
import { assertTestDatabaseUrls } from "../../scripts/test-database-safety.mjs";

export const TRADING_CREATOR_ID = "trading-test-creator";

export function decimal(value: string): DecimalString {
  return decimalStringSchema.parse(value);
}

export function tradingPrincipal(userId: string): AuthPrincipal {
  return { userId, provider: "guest", role: "USER" };
}

export async function resetTradingFixtureTables(prisma: PrismaClient) {
  assertTestDatabaseUrls(process.env);

  const configuredUrl = process.env.DATABASE_URL;
  if (!configuredUrl) {
    throw new Error("DATABASE_URL must be configured for trading integration tests");
  }

  const configuredDatabase = new URL(configuredUrl).pathname.replace(/^\//, "");
  if (!configuredDatabase.endsWith("_test")) {
    throw new Error("Trading fixture cleanup requires a _test database");
  }

  const databases = await prisma.$queryRaw<Array<{ database: string }>>`
    SELECT current_database() AS database
  `;
  const actualDatabase = databases[0]?.database;
  if (!actualDatabase?.endsWith("_test") || actualDatabase !== configuredDatabase) {
    throw new Error("Trading fixture cleanup refused a database other than the configured _test database");
  }

  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "TradeExecution", "IdempotencyRecord", "Order", "Position", "LegacyTrade" RESTART IDENTITY CASCADE',
  );
  await prisma.user.deleteMany({ where: { email: { endsWith: "@trading.test" } } });
  await prisma.creator.deleteMany({ where: { id: { startsWith: "trading-" } } });
}

export async function createTradingCreator(
  prisma: PrismaClient,
  input: { id?: string; currentPrice?: DecimalString } = {},
) {
  const id = input.id ?? TRADING_CREATOR_ID;
  const currentPrice = input.currentPrice ?? decimal("10");

  return prisma.creator.create({
    data: {
      id,
      youtubeChannelId: `${id}-channel`,
      name: id,
      currentPrice,
      initialPrice: currentPrice,
      circulatingSupply: decimal("1000"),
      reserveSupply: decimal("0"),
      totalSupply: decimal("1000"),
    },
  });
}

export async function createTradingUser(
  prisma: PrismaClient,
  input: {
    id: string;
    balance?: DecimalString;
    creatorId?: string;
    positionQuantity?: DecimalString;
    positionAveragePrice?: DecimalString;
  },
) {
  const balance = input.balance ?? decimal("100");
  const creatorId = input.creatorId ?? TRADING_CREATOR_ID;

  const user = await prisma.user.create({
    data: {
      id: input.id,
      email: `${input.id}@trading.test`,
      name: input.id,
      initialBudget: balance,
      balance,
      reservedBalance: decimal("0"),
    },
  });

  if (input.positionQuantity) {
    await prisma.position.create({
      data: {
        userId: user.id,
        creatorId,
        quantity: input.positionQuantity,
        reservedQuantity: decimal("0"),
        avgPrice: input.positionAveragePrice ?? decimal("10"),
      },
    });
  }

  return user;
}

function sumDecimals(values: Iterable<Prisma.Decimal>) {
  let total = new Prisma.Decimal("0");
  for (const value of values) total = total.plus(value);
  return total;
}

export type TradingAssetSnapshot = {
  totalQuote: Prisma.Decimal;
  availableQuote: Prisma.Decimal;
  reservedQuote: Prisma.Decimal;
  totalQuantity: Prisma.Decimal;
  availableQuantity: Prisma.Decimal;
  reservedQuantity: Prisma.Decimal;
  activeOrderReservedQuote: Prisma.Decimal;
  activeOrderReservedQuantity: Prisma.Decimal;
};

export async function snapshotTradingAssets(
  prisma: PrismaClient,
  userIds: string[],
  creatorId = TRADING_CREATOR_ID,
): Promise<TradingAssetSnapshot> {
  const [users, positions, activeOrders] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { balance: true, reservedBalance: true },
    }),
    prisma.position.findMany({
      where: { userId: { in: userIds }, creatorId },
      select: { quantity: true, reservedQuantity: true },
    }),
    prisma.order.findMany({
      where: {
        userId: { in: userIds },
        creatorId,
        status: { in: ["OPEN", "PARTIAL"] },
      },
      select: { reservedQuote: true, reservedQuantity: true },
    }),
  ]);

  const totalQuote = sumDecimals(users.map(({ balance }) => balance));
  const reservedQuote = sumDecimals(users.map(({ reservedBalance }) => reservedBalance));
  const totalQuantity = sumDecimals(positions.map(({ quantity }) => quantity));
  const reservedQuantity = sumDecimals(
    positions.map(({ reservedQuantity: value }) => value),
  );

  return {
    totalQuote,
    availableQuote: totalQuote.minus(reservedQuote),
    reservedQuote,
    totalQuantity,
    availableQuantity: totalQuantity.minus(reservedQuantity),
    reservedQuantity,
    activeOrderReservedQuote: sumDecimals(activeOrders.map(({ reservedQuote: value }) => value)),
    activeOrderReservedQuantity: sumDecimals(
      activeOrders.map(({ reservedQuantity: value }) => value),
    ),
  };
}

export function decimalEquals(actual: Prisma.Decimal, expected: string) {
  return actual.equals(new Prisma.Decimal(expected));
}
