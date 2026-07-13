import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

const prisma = new PrismaClient();
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const foundationMigration =
  "prisma/migrations/20260710_shared_backend_foundation/migration.sql";
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
  return sql
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function executeMigration(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  sql: string,
) {
  for (const statement of splitSqlStatements(sql)) {
    await tx.$executeRawUnsafe(statement);
  }
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
