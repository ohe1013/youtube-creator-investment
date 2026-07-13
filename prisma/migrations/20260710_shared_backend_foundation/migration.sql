-- CreateEnum
CREATE TYPE "IdentityProvider" AS ENUM ('GUEST', 'TOSS');

-- Preserve the legacy per-user trade history under an explicit legacy name.
ALTER TABLE "Trade" RENAME TO "LegacyTrade";
ALTER TABLE "LegacyTrade" RENAME CONSTRAINT "Trade_pkey" TO "LegacyTrade_pkey";
ALTER TABLE "LegacyTrade" RENAME CONSTRAINT "Trade_userId_fkey" TO "LegacyTrade_userId_fkey";
ALTER TABLE "LegacyTrade" RENAME CONSTRAINT "Trade_creatorId_fkey" TO "LegacyTrade_creatorId_fkey";
ALTER TABLE "LegacyTrade" RENAME CONSTRAINT "Trade_orderId_fkey" TO "LegacyTrade_orderId_fkey";
ALTER INDEX "Trade_userId_createdAt_idx" RENAME TO "LegacyTrade_userId_createdAt_idx";
ALTER INDEX "Trade_creatorId_idx" RENAME TO "LegacyTrade_creatorId_idx";

-- Convert existing money and price fields without passing through floating point again.
ALTER TABLE "Creator"
  ALTER COLUMN "currentPrice" TYPE DECIMAL(20,4) USING ROUND("currentPrice"::numeric, 4),
  ALTER COLUMN "currentPrice" SET DEFAULT 100,
  ALTER COLUMN "initialPrice" TYPE DECIMAL(20,4) USING ROUND("initialPrice"::numeric, 4),
  ALTER COLUMN "initialPrice" SET DEFAULT 100,
  ALTER COLUMN "liquidity" TYPE DECIMAL(20,4) USING ROUND("liquidity"::numeric, 4),
  ALTER COLUMN "liquidity" SET DEFAULT 10000;

ALTER TABLE "User"
  ALTER COLUMN "initialBudget" TYPE DECIMAL(20,4) USING ROUND("initialBudget"::numeric, 4),
  ALTER COLUMN "initialBudget" SET DEFAULT 100000,
  ALTER COLUMN "balance" TYPE DECIMAL(20,4) USING ROUND("balance"::numeric, 4),
  ALTER COLUMN "balance" SET DEFAULT 100000,
  ADD COLUMN "reservedBalance" DECIMAL(20,4) NOT NULL DEFAULT 0;

ALTER TABLE "Position"
  ALTER COLUMN "quantity" TYPE DECIMAL(20,8) USING ROUND("quantity"::numeric, 8),
  ALTER COLUMN "avgPrice" TYPE DECIMAL(20,4) USING ROUND("avgPrice"::numeric, 4),
  ADD COLUMN "reservedQuantity" DECIMAL(20,8) NOT NULL DEFAULT 0;

ALTER TABLE "Order"
  ALTER COLUMN "price" TYPE DECIMAL(20,4) USING ROUND("price"::numeric, 4),
  ALTER COLUMN "quantity" TYPE DECIMAL(20,8) USING ROUND("quantity"::numeric, 8),
  ALTER COLUMN "filled" TYPE DECIMAL(20,8) USING ROUND("filled"::numeric, 8),
  ALTER COLUMN "filled" SET DEFAULT 0,
  ADD COLUMN "reservedQuote" DECIMAL(20,4) NOT NULL DEFAULT 0,
  ADD COLUMN "reservedQuantity" DECIMAL(20,8) NOT NULL DEFAULT 0,
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "cancelReason" TEXT;

ALTER TABLE "LegacyTrade"
  ALTER COLUMN "quantity" TYPE DECIMAL(20,8) USING ROUND("quantity"::numeric, 8),
  ALTER COLUMN "price" TYPE DECIMAL(20,4) USING ROUND("price"::numeric, 4);

-- Add database-level accounting invariants.
ALTER TABLE "Creator"
  ADD CONSTRAINT "Creator_prices_nonnegative"
  CHECK ("currentPrice" >= 0 AND "initialPrice" >= 0 AND "liquidity" >= 0);

ALTER TABLE "User"
  ADD CONSTRAINT "User_initialBudget_nonnegative" CHECK ("initialBudget" >= 0),
  ADD CONSTRAINT "User_balance_nonnegative" CHECK ("balance" >= 0),
  ADD CONSTRAINT "User_reservedBalance_nonnegative" CHECK ("reservedBalance" >= 0);

ALTER TABLE "Position"
  ADD CONSTRAINT "Position_quantity_nonnegative" CHECK ("quantity" >= 0),
  ADD CONSTRAINT "Position_reservedQuantity_nonnegative" CHECK ("reservedQuantity" >= 0),
  ADD CONSTRAINT "Position_avgPrice_nonnegative" CHECK ("avgPrice" >= 0);

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_price_quantity_nonnegative" CHECK ("price" >= 0 AND "quantity" >= 0 AND "filled" >= 0),
  ADD CONSTRAINT "Order_reserves_nonnegative" CHECK ("reservedQuote" >= 0 AND "reservedQuantity" >= 0),
  ADD CONSTRAINT "Order_filled_within_quantity" CHECK ("filled" <= "quantity");

ALTER TABLE "LegacyTrade"
  ADD CONSTRAINT "LegacyTrade_values_nonnegative" CHECK ("price" >= 0 AND "quantity" >= 0);

-- CreateTable
CREATE TABLE "AuthIdentity" (
  "id" TEXT NOT NULL,
  "provider" "IdentityProvider" NOT NULL,
  "subject" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "identityId" TEXT NOT NULL,
  "refreshFamilyId" TEXT NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "replacedById" TEXT,
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AppSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IdempotencyRecord" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "responseStatus" INTEGER,
  "responseBody" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TradeExecution" (
  "id" TEXT NOT NULL,
  "makerOrderId" TEXT NOT NULL,
  "takerOrderId" TEXT NOT NULL,
  "buyerId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "price" DECIMAL(20,4) NOT NULL,
  "quantity" DECIMAL(20,8) NOT NULL,
  "quoteAmount" DECIMAL(20,4) NOT NULL,
  "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TradeExecution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TradeExecution_values_nonnegative" CHECK ("price" >= 0 AND "quantity" >= 0 AND "quoteAmount" >= 0)
);

CREATE TABLE "RateLimitBucket" (
  "keyHash" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("keyHash"),
  CONSTRAINT "RateLimitBucket_count_nonnegative" CHECK ("count" >= 0)
);

-- CreateIndex
CREATE INDEX "LegacyTrade_orderId_idx" ON "LegacyTrade"("orderId");
CREATE UNIQUE INDEX "AuthIdentity_provider_subject_key" ON "AuthIdentity"("provider", "subject");
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");
CREATE UNIQUE INDEX "AppSession_refreshTokenHash_key" ON "AppSession"("refreshTokenHash");
CREATE UNIQUE INDEX "AppSession_replacedById_key" ON "AppSession"("replacedById");
CREATE INDEX "AppSession_userId_idx" ON "AppSession"("userId");
CREATE INDEX "AppSession_identityId_idx" ON "AppSession"("identityId");
CREATE INDEX "AppSession_refreshFamilyId_idx" ON "AppSession"("refreshFamilyId");
CREATE INDEX "AppSession_expiresAt_idx" ON "AppSession"("expiresAt");
CREATE UNIQUE INDEX "IdempotencyRecord_userId_operation_key_key" ON "IdempotencyRecord"("userId", "operation", "key");
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");
CREATE INDEX "TradeExecution_makerOrderId_idx" ON "TradeExecution"("makerOrderId");
CREATE INDEX "TradeExecution_takerOrderId_idx" ON "TradeExecution"("takerOrderId");
CREATE INDEX "TradeExecution_buyerId_executedAt_idx" ON "TradeExecution"("buyerId", "executedAt");
CREATE INDEX "TradeExecution_sellerId_executedAt_idx" ON "TradeExecution"("sellerId", "executedAt");
CREATE INDEX "TradeExecution_creatorId_executedAt_idx" ON "TradeExecution"("creatorId", "executedAt");
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");

-- AddForeignKey
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppSession" ADD CONSTRAINT "AppSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppSession" ADD CONSTRAINT "AppSession_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "AuthIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppSession" ADD CONSTRAINT "AppSession_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "AppSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeExecution" ADD CONSTRAINT "TradeExecution_makerOrderId_fkey" FOREIGN KEY ("makerOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TradeExecution" ADD CONSTRAINT "TradeExecution_takerOrderId_fkey" FOREIGN KEY ("takerOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TradeExecution" ADD CONSTRAINT "TradeExecution_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TradeExecution" ADD CONSTRAINT "TradeExecution_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TradeExecution" ADD CONSTRAINT "TradeExecution_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
