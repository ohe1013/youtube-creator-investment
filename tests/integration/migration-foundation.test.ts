import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

const prisma = new PrismaClient();
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const foundationMigration =
  "prisma/migrations/20260710_shared_backend_foundation/migration.sql";
const hardeningMigration =
  "prisma/migrations/20260713_trade_persistence_hardening/migration.sql";
const supplyConstraintMigration =
  "prisma/migrations/20260713_creator_supply_constraints/migration.sql";
const legacyMigrations = [
  "prisma/migrations/20251218063440_init/migration.sql",
  "prisma/migrations/20251218115251_test2/migration.sql",
  "prisma/migrations/20251224054630_remove_nameko_and_fix_int_size/migration.sql",
  "prisma/migrations/20251224072420_add_videos_and_engagement/migration.sql",
  "prisma/migrations/20260102081614_add_order_table/migration.sql",
];

afterAll(() => prisma.$disconnect());

async function readMigration(relativePath: string) {
  return readFile(`${projectRoot}/${relativePath}`, "utf8");
}

function splitSqlStatements(sql: string) {
  const normalizedSql = sql.replace(/^\s*--.*$/gm, "");
  const statements: string[] = [];
  let statement = "";
  let dollarQuote: string | null = null;
  let quoted: "'" | '"' | null = null;

  for (let index = 0; index < normalizedSql.length; index += 1) {
    const character = normalizedSql[index];

    if (dollarQuote) {
      if (normalizedSql.startsWith(dollarQuote, index)) {
        statement += dollarQuote;
        index += dollarQuote.length - 1;
        dollarQuote = null;
      } else {
        statement += character;
      }
      continue;
    }

    if (quoted) {
      statement += character;
      if (character === quoted) {
        if (normalizedSql[index + 1] === quoted) {
          statement += normalizedSql[index + 1];
          index += 1;
        } else {
          quoted = null;
        }
      }
      continue;
    }

    const dollarQuoteMatch = normalizedSql
      .slice(index)
      .match(/^\$[A-Za-z0-9_]*\$/);
    if (dollarQuoteMatch) {
      dollarQuote = dollarQuoteMatch[0];
      statement += dollarQuote;
      index += dollarQuote.length - 1;
      continue;
    }

    if (character === "'" || character === '"') {
      quoted = character;
      statement += character;
      continue;
    }

    if (character === ";") {
      const trimmed = statement.trim();
      if (trimmed) statements.push(trimmed);
      statement = "";
      continue;
    }

    statement += character;
  }

  const trailing = statement.trim();
  if (trailing) statements.push(trailing);
  return statements;
}

async function executeMigration(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  sql: string,
) {
  for (const statement of splitSqlStatements(sql)) {
    await tx.$executeRawUnsafe(statement);
  }
}

async function captureRejectedMutation(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  savepoint: string,
  sql: string,
) {
  await tx.$executeRawUnsafe(`SAVEPOINT "${savepoint}"`);
  let rejection: unknown;

  try {
    await tx.$executeRawUnsafe(sql);
  } catch (error) {
    rejection = error;
  }

  await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT "${savepoint}"`);
  await tx.$executeRawUnsafe(`RELEASE SAVEPOINT "${savepoint}"`);
  return rejection;
}

describe.sequential("shared backend persistence migration", () => {
  it("renames the legacy trade table and preserves every existing row exactly", async () => {
    const migrationSql = await readMigration(foundationMigration);
    const legacySql = await Promise.all(legacyMigrations.map(readMigration));
    const schema = `migration_foundation_${randomUUID().replaceAll("-", "")}`;
    const rollback = new Error("ROLLBACK_MIGRATION_FOUNDATION_TEST");
    let assertionsCompleted = false;

    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
          await tx.$executeRawUnsafe(
            `SET LOCAL search_path TO "${schema}", public`,
          );

          for (const sql of legacySql) {
            await executeMigration(tx, sql);
          }

          await tx.$executeRawUnsafe(`
            INSERT INTO "User" ("id", "initialBudget", "balance", "updatedAt")
            VALUES ('legacy-user', 100000.125, 99999.5, CURRENT_TIMESTAMP)
          `);
          await tx.$executeRawUnsafe(`
            INSERT INTO "Creator" (
              "id", "youtubeChannelId", "name", "currentPrice", "initialPrice",
              "lastSyncedAt", "updatedAt"
            ) VALUES (
              'legacy-creator', 'legacy-channel', 'Legacy Creator', 123.125,
              120.5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
          `);
          await tx.$executeRawUnsafe(`
            INSERT INTO "Position" (
              "id", "userId", "creatorId", "quantity", "avgPrice", "updatedAt"
            ) VALUES (
              'legacy-position', 'legacy-user', 'legacy-creator', 3.125, 12.5,
              CURRENT_TIMESTAMP
            )
          `);
          await tx.$executeRawUnsafe(`
            INSERT INTO "Order" (
              "id", "userId", "creatorId", "type", "price", "quantity", "filled", "updatedAt"
            ) VALUES (
              'legacy-order', 'legacy-user', 'legacy-creator', 'BUY', 12.5,
              2.125, 0.125, CURRENT_TIMESTAMP
            )
          `);
          await tx.$executeRawUnsafe(`
            INSERT INTO "Trade" (
              "id", "userId", "creatorId", "orderId", "type", "quantity", "price"
            ) VALUES (
              'legacy-trade', 'legacy-user', 'legacy-creator', 'legacy-order',
              'BUY', 0.125, 12.5
            )
          `);

          await executeMigration(tx, migrationSql);

          const counts = await tx.$queryRawUnsafe<
            Array<{
              users: number;
              creators: number;
              positions: number;
              orders: number;
              legacyTrades: number;
              executions: number;
            }>
          >(`
            SELECT
              (SELECT COUNT(*)::int FROM "User") AS users,
              (SELECT COUNT(*)::int FROM "Creator") AS creators,
              (SELECT COUNT(*)::int FROM "Position") AS positions,
              (SELECT COUNT(*)::int FROM "Order") AS orders,
              (SELECT COUNT(*)::int FROM "LegacyTrade") AS "legacyTrades",
              (SELECT COUNT(*)::int FROM "TradeExecution") AS executions
          `);
          expect(counts).toEqual([
            {
              users: 1,
              creators: 1,
              positions: 1,
              orders: 1,
              legacyTrades: 1,
              executions: 0,
            },
          ]);

          const exactValues = await tx.$queryRawUnsafe<
            Array<{
              balance: string;
              reservedBalance: string;
              positionQuantity: string;
              reservedQuantity: string;
              orderPrice: string;
              orderQuantity: string;
              orderFilled: string;
              tradePrice: string;
              tradeQuantity: string;
            }>
          >(`
            SELECT
              u."balance"::text AS balance,
              u."reservedBalance"::text AS "reservedBalance",
              p."quantity"::text AS "positionQuantity",
              p."reservedQuantity"::text AS "reservedQuantity",
              o."price"::text AS "orderPrice",
              o."quantity"::text AS "orderQuantity",
              o."filled"::text AS "orderFilled",
              t."price"::text AS "tradePrice",
              t."quantity"::text AS "tradeQuantity"
            FROM "User" u
            JOIN "Position" p ON p."userId" = u.id
            JOIN "Order" o ON o."userId" = u.id
            JOIN "LegacyTrade" t ON t."userId" = u.id
            WHERE u.id = 'legacy-user'
          `);
          expect(exactValues).toEqual([
            {
              balance: "99999.5000",
              reservedBalance: "0.0000",
              positionQuantity: "3.12500000",
              reservedQuantity: "0.00000000",
              orderPrice: "12.5000",
              orderQuantity: "2.12500000",
              orderFilled: "0.12500000",
              tradePrice: "12.5000",
              tradeQuantity: "0.12500000",
            },
          ]);

          const tradeTables = await tx.$queryRawUnsafe<
            Array<{ legacyTable: string | null; oldTable: string | null }>
          >(`
            SELECT
              to_regclass('"LegacyTrade"')::text AS "legacyTable",
              to_regclass('"Trade"')::text AS "oldTable"
          `);
          expect(tradeTables).toEqual([
            { legacyTable: '"LegacyTrade"', oldTable: null },
          ]);

          assertionsCompleted = true;
          throw rollback;
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      if (error !== rollback) throw error;
    }

    expect(assertionsCompleted).toBe(true);
  });

  it("hardens supplies, backfills active reserves, and makes executions immutable", async () => {
    const [foundationSql, hardeningSql, supplyConstraintSql, ...legacySql] =
      await Promise.all([
        readMigration(foundationMigration),
        readMigration(hardeningMigration),
        readMigration(supplyConstraintMigration),
        ...legacyMigrations.map(readMigration),
      ]);
    const schema = `migration_hardening_${randomUUID().replaceAll("-", "")}`;
    const rollback = new Error("ROLLBACK_MIGRATION_HARDENING_TEST");
    let assertionsCompleted = false;

    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
          await tx.$executeRawUnsafe(
            `SET LOCAL search_path TO "${schema}", public`,
          );

          for (const sql of legacySql) {
            await executeMigration(tx, sql);
          }
          await executeMigration(tx, foundationSql);

          await tx.$executeRawUnsafe(`
            INSERT INTO "User" ("id", "initialBudget", "balance", "updatedAt")
            VALUES
              ('hardening-buyer', 1000, 1000, CURRENT_TIMESTAMP),
              ('hardening-seller', 500, 500, CURRENT_TIMESTAMP)
          `);
          await tx.$executeRawUnsafe(`
            INSERT INTO "Creator" (
              "id", "youtubeChannelId", "name", "currentPrice", "initialPrice",
              "circulatingSupply", "reserveSupply", "totalSupply",
              "lastSyncedAt", "updatedAt"
            ) VALUES (
              'hardening-creator', 'hardening-channel', 'Hardening Creator',
              12.3456, 10, 123456.123456789, 876543.876543219,
              1000000.000000009, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
          `);
          await tx.$executeRawUnsafe(`
            INSERT INTO "Position" (
              "id", "userId", "creatorId", "quantity", "reservedQuantity",
              "avgPrice", "updatedAt"
            ) VALUES (
              'hardening-position', 'hardening-seller', 'hardening-creator',
              10, 0, 10, CURRENT_TIMESTAMP
            )
          `);
          await tx.$executeRawUnsafe(`
            INSERT INTO "Order" (
              "id", "userId", "creatorId", "type", "price", "quantity",
              "filled", "status", "updatedAt"
            ) VALUES
              ('buy-open', 'hardening-buyer', 'hardening-creator', 'BUY', 12.3456, 10, 2.5, 'OPEN', CURRENT_TIMESTAMP),
              ('buy-partial', 'hardening-buyer', 'hardening-creator', 'BUY', 2.5, 4, 1, 'PARTIAL', CURRENT_TIMESTAMP),
              ('buy-cancelled', 'hardening-buyer', 'hardening-creator', 'BUY', 999, 2, 0, 'CANCELLED', CURRENT_TIMESTAMP),
              ('sell-open', 'hardening-seller', 'hardening-creator', 'SELL', 13, 5, 0.75, 'OPEN', CURRENT_TIMESTAMP),
              ('sell-partial', 'hardening-seller', 'hardening-creator', 'SELL', 14, 3, 1.125, 'PARTIAL', CURRENT_TIMESTAMP),
              ('sell-filled', 'hardening-seller', 'hardening-creator', 'SELL', 15, 1, 1, 'FILLED', CURRENT_TIMESTAMP)
          `);
          await tx.$executeRawUnsafe(`
            INSERT INTO "TradeExecution" (
              "id", "makerOrderId", "takerOrderId", "buyerId", "sellerId",
              "creatorId", "price", "quantity", "quoteAmount"
            ) VALUES (
              'immutable-execution', 'buy-open', 'sell-open',
              'hardening-buyer', 'hardening-seller', 'hardening-creator',
              12.3456, 1, 12.3456
            )
          `);

          await executeMigration(tx, supplyConstraintSql);
          await executeMigration(tx, hardeningSql);

          const supplyColumns = await tx.$queryRawUnsafe<
            Array<{
              columnName: string;
              precision: number;
              scale: number;
            }>
          >(`
            SELECT
              column_name AS "columnName",
              numeric_precision::int AS precision,
              numeric_scale::int AS scale
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'Creator'
              AND column_name IN (
                'circulatingSupply', 'reserveSupply', 'totalSupply'
              )
            ORDER BY column_name
          `);
          expect(supplyColumns).toEqual([
            { columnName: "circulatingSupply", precision: 20, scale: 8 },
            { columnName: "reserveSupply", precision: 20, scale: 8 },
            { columnName: "totalSupply", precision: 20, scale: 8 },
          ]);

          const supplyConstraints = await tx.$queryRawUnsafe<
            Array<{ name: string }>
          >(`
            SELECT conname AS name
            FROM pg_constraint
            WHERE connamespace = current_schema()::regnamespace
              AND conname = 'Creator_supplies_nonnegative'
          `);
          expect(supplyConstraints).toEqual([
            { name: "Creator_supplies_nonnegative" },
          ]);

          const negativeSupplyRejection = await captureRejectedMutation(
            tx,
            "negative_supply",
            `UPDATE "Creator" SET "totalSupply" = -1 WHERE id = 'hardening-creator'`,
          );
          expect(negativeSupplyRejection).toBeDefined();

          const supplies = await tx.$queryRawUnsafe<
            Array<{
              circulatingSupply: string;
              reserveSupply: string;
              totalSupply: string;
            }>
          >(`
            SELECT
              "circulatingSupply"::text AS "circulatingSupply",
              "reserveSupply"::text AS "reserveSupply",
              "totalSupply"::text AS "totalSupply"
            FROM "Creator"
            WHERE id = 'hardening-creator'
          `);
          expect(supplies).toEqual([
            {
              circulatingSupply: "123456.12345679",
              reserveSupply: "876543.87654322",
              totalSupply: "1000000.00000001",
            },
          ]);

          const orders = await tx.$queryRawUnsafe<
            Array<{
              id: string;
              reservedQuote: string;
              reservedQuantity: string;
            }>
          >(`
            SELECT
              id,
              "reservedQuote"::text AS "reservedQuote",
              "reservedQuantity"::text AS "reservedQuantity"
            FROM "Order"
            ORDER BY id
          `);
          expect(orders).toEqual([
            {
              id: "buy-cancelled",
              reservedQuote: "0.0000",
              reservedQuantity: "0.00000000",
            },
            {
              id: "buy-open",
              reservedQuote: "92.5920",
              reservedQuantity: "0.00000000",
            },
            {
              id: "buy-partial",
              reservedQuote: "7.5000",
              reservedQuantity: "0.00000000",
            },
            {
              id: "sell-filled",
              reservedQuote: "0.0000",
              reservedQuantity: "0.00000000",
            },
            {
              id: "sell-open",
              reservedQuote: "0.0000",
              reservedQuantity: "4.25000000",
            },
            {
              id: "sell-partial",
              reservedQuote: "0.0000",
              reservedQuantity: "1.87500000",
            },
          ]);

          const aggregateReserves = await tx.$queryRawUnsafe<
            Array<{
              reservedBalance: string;
              reservedQuantity: string;
            }>
          >(`
            SELECT
              buyer."reservedBalance"::text AS "reservedBalance",
              position."reservedQuantity"::text AS "reservedQuantity"
            FROM "User" buyer
            CROSS JOIN "Position" position
            WHERE buyer.id = 'hardening-buyer'
              AND position.id = 'hardening-position'
          `);
          expect(aggregateReserves).toEqual([
            {
              reservedBalance: "100.0920",
              reservedQuantity: "6.12500000",
            },
          ]);

          const updateRejection = await captureRejectedMutation(
            tx,
            "immutable_update",
            `UPDATE "TradeExecution" SET "quoteAmount" = 99 WHERE id = 'immutable-execution'`,
          );
          expect(updateRejection).toBeDefined();

          const deleteRejection = await captureRejectedMutation(
            tx,
            "immutable_delete",
            `DELETE FROM "TradeExecution" WHERE id = 'immutable-execution'`,
          );
          expect(deleteRejection).toBeDefined();

          const execution = await tx.$queryRawUnsafe<
            Array<{ count: number; quoteAmount: string }>
          >(`
            SELECT COUNT(*)::int AS count, MAX("quoteAmount")::text AS "quoteAmount"
            FROM "TradeExecution"
            WHERE id = 'immutable-execution'
          `);
          expect(execution).toEqual([{ count: 1, quoteAmount: "12.3456" }]);

          const executionForeignKeys = await tx.$queryRawUnsafe<
            Array<{ name: string; updateAction: string }>
          >(`
            SELECT
              conname AS name,
              CASE confupdtype WHEN 'r' THEN 'RESTRICT' ELSE confupdtype::text END AS "updateAction"
            FROM pg_constraint
            WHERE connamespace = current_schema()::regnamespace
              AND conname IN (
                'TradeExecution_makerOrderId_fkey',
                'TradeExecution_takerOrderId_fkey',
                'TradeExecution_buyerId_fkey',
                'TradeExecution_sellerId_fkey',
                'TradeExecution_creatorId_fkey'
              )
            ORDER BY conname
          `);
          expect(executionForeignKeys).toEqual([
            {
              name: "TradeExecution_buyerId_fkey",
              updateAction: "RESTRICT",
            },
            {
              name: "TradeExecution_creatorId_fkey",
              updateAction: "RESTRICT",
            },
            {
              name: "TradeExecution_makerOrderId_fkey",
              updateAction: "RESTRICT",
            },
            {
              name: "TradeExecution_sellerId_fkey",
              updateAction: "RESTRICT",
            },
            {
              name: "TradeExecution_takerOrderId_fkey",
              updateAction: "RESTRICT",
            },
          ]);

          assertionsCompleted = true;
          throw rollback;
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      if (error !== rollback) throw error;
    }

    expect(assertionsCompleted).toBe(true);
  });

  it("uses the required numeric precision, scale, and reserve constraints", async () => {
    const columns = await prisma.$queryRaw<
      Array<{
        tableName: string;
        columnName: string;
        precision: number;
        scale: number;
      }>
    >`
      SELECT
        table_name AS "tableName",
        column_name AS "columnName",
        numeric_precision::int AS precision,
        numeric_scale::int AS scale
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND (table_name, column_name) IN (
          ('User', 'balance'),
          ('User', 'reservedBalance'),
          ('Position', 'quantity'),
          ('Position', 'reservedQuantity'),
          ('Order', 'price'),
          ('Order', 'quantity'),
          ('Order', 'filled'),
          ('Order', 'reservedQuote'),
          ('Order', 'reservedQuantity'),
          ('LegacyTrade', 'price'),
          ('LegacyTrade', 'quantity'),
          ('TradeExecution', 'price'),
          ('TradeExecution', 'quantity'),
          ('TradeExecution', 'quoteAmount')
        )
      ORDER BY table_name, column_name
    `;

    expect(columns).toHaveLength(14);
    for (const column of columns) {
      expect(column.precision).toBe(20);
      expect(column.scale).toBe(
        column.columnName.toLowerCase().includes("quantity") ||
          column.columnName === "filled"
          ? 8
          : 4,
      );
    }

    const constraints = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT conname AS name
      FROM pg_constraint
      WHERE connamespace = current_schema()::regnamespace
        AND conname IN (
          'User_balance_nonnegative',
          'User_reservedBalance_nonnegative',
          'Position_quantity_nonnegative',
          'Position_reservedQuantity_nonnegative',
          'Order_reserves_nonnegative',
          'Order_filled_within_quantity'
        )
      ORDER BY conname
    `;
    expect(constraints.map(({ name }) => name)).toEqual([
      "Order_filled_within_quantity",
      "Order_reserves_nonnegative",
      "Position_quantity_nonnegative",
      "Position_reservedQuantity_nonnegative",
      "User_balance_nonnegative",
      "User_reservedBalance_nonnegative",
    ]);
  });

  it("enforces identity, refresh-token, and idempotency uniqueness", async () => {
    const suffix = randomUUID();
    const userId = `foundation-user-${suffix}`;
    const identityId = `foundation-identity-${suffix}`;

    try {
      await prisma.$executeRaw`
        INSERT INTO "User" ("id", "updatedAt")
        VALUES (${userId}, CURRENT_TIMESTAMP)
      `;
      await prisma.$executeRaw`
        INSERT INTO "AuthIdentity" ("id", "provider", "subject", "userId", "updatedAt")
        VALUES (${identityId}, 'GUEST', ${`subject-${suffix}`}, ${userId}, CURRENT_TIMESTAMP)
      `;
      await expect(
        prisma.$executeRaw`
          INSERT INTO "AuthIdentity" ("id", "provider", "subject", "userId", "updatedAt")
          VALUES (${`duplicate-${identityId}`}, 'GUEST', ${`subject-${suffix}`}, ${userId}, CURRENT_TIMESTAMP)
        `,
      ).rejects.toThrow();

      await prisma.$executeRaw`
        INSERT INTO "AppSession" (
          "id", "userId", "identityId", "refreshFamilyId", "refreshTokenHash", "expiresAt"
        ) VALUES (
          ${`session-a-${suffix}`}, ${userId}, ${identityId}, ${`family-${suffix}`},
          ${`refresh-${suffix}`}, CURRENT_TIMESTAMP + INTERVAL '1 hour'
        )
      `;
      await expect(
        prisma.$executeRaw`
          INSERT INTO "AppSession" (
            "id", "userId", "identityId", "refreshFamilyId", "refreshTokenHash", "expiresAt"
          ) VALUES (
            ${`session-b-${suffix}`}, ${userId}, ${identityId}, ${`family-b-${suffix}`},
            ${`refresh-${suffix}`}, CURRENT_TIMESTAMP + INTERVAL '1 hour'
          )
        `,
      ).rejects.toThrow();

      await prisma.$executeRaw`
        INSERT INTO "IdempotencyRecord" (
          "id", "userId", "operation", "key", "requestHash", "state", "expiresAt"
        ) VALUES (
          ${`idem-a-${suffix}`}, ${userId}, 'place-order', ${`key-${suffix}`},
          ${`hash-${suffix}`}, 'PENDING', CURRENT_TIMESTAMP + INTERVAL '1 hour'
        )
      `;
      await expect(
        prisma.$executeRaw`
          INSERT INTO "IdempotencyRecord" (
            "id", "userId", "operation", "key", "requestHash", "state", "expiresAt"
          ) VALUES (
            ${`idem-b-${suffix}`}, ${userId}, 'place-order', ${`key-${suffix}`},
            ${`hash-b-${suffix}`}, 'PENDING', CURRENT_TIMESTAMP + INTERVAL '1 hour'
          )
        `,
      ).rejects.toThrow();
      await prisma.$executeRaw`
        INSERT INTO "IdempotencyRecord" (
          "id", "userId", "operation", "key", "requestHash", "state", "expiresAt"
        ) VALUES (
          ${`idem-c-${suffix}`}, ${userId}, 'cancel-order', ${`key-${suffix}`},
          ${`hash-c-${suffix}`}, 'PENDING', CURRENT_TIMESTAMP + INTERVAL '1 hour'
        )
      `;
    } finally {
      await prisma.$executeRaw`DELETE FROM "User" WHERE "id" = ${userId}`;
    }
  });

  it("stores expiring rate-limit buckets and indexes their expiry", async () => {
    const keyHash = `foundation-rate-${randomUUID()}`;

    try {
      await prisma.$executeRaw`
        INSERT INTO "RateLimitBucket" ("keyHash", "count", "expiresAt", "updatedAt")
        VALUES (${keyHash}, 1, CURRENT_TIMESTAMP - INTERVAL '1 second', CURRENT_TIMESTAMP)
      `;
      const expired = await prisma.$queryRaw<Array<{ expired: boolean }>>`
        SELECT "expiresAt" <= CURRENT_TIMESTAMP AS expired
        FROM "RateLimitBucket"
        WHERE "keyHash" = ${keyHash}
      `;
      expect(expired).toEqual([{ expired: true }]);

      const expiryIndex = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1
          FROM pg_indexes
          WHERE schemaname = current_schema()
            AND tablename = 'RateLimitBucket'
            AND indexdef LIKE '%("expiresAt")%'
        ) AS exists
      `;
      expect(expiryIndex).toEqual([{ exists: true }]);
    } finally {
      await prisma.$executeRaw`
        DELETE FROM "RateLimitBucket" WHERE "keyHash" = ${keyHash}
      `;
    }
  });
});
