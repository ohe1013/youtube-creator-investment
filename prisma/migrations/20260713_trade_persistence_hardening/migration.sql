-- Store creator share supplies with the same exact quantity precision as orders.
ALTER TABLE "Creator"
  ALTER COLUMN "circulatingSupply" TYPE DECIMAL(20,8)
    USING ROUND("circulatingSupply"::numeric, 8),
  ALTER COLUMN "circulatingSupply" SET DEFAULT 200000,
  ALTER COLUMN "reserveSupply" TYPE DECIMAL(20,8)
    USING ROUND("reserveSupply"::numeric, 8),
  ALTER COLUMN "reserveSupply" SET DEFAULT 800000,
  ALTER COLUMN "totalSupply" TYPE DECIMAL(20,8)
    USING ROUND("totalSupply"::numeric, 8),
  ALTER COLUMN "totalSupply" SET DEFAULT 1000000;

-- Reconstruct authoritative reservations for orders created before reservation
-- persistence was introduced. Only active order remainders remain reserved.
UPDATE "Order"
SET
  "reservedQuote" = ROUND("price" * ("quantity" - "filled"), 4),
  "reservedQuantity" = 0
WHERE "status" IN ('OPEN', 'PARTIAL')
  AND "type" = 'BUY';

UPDATE "Order"
SET
  "reservedQuote" = 0,
  "reservedQuantity" = "quantity" - "filled"
WHERE "status" IN ('OPEN', 'PARTIAL')
  AND "type" = 'SELL';

UPDATE "User" AS users
SET "reservedBalance" = COALESCE((
  SELECT SUM(orders."reservedQuote")
  FROM "Order" AS orders
  WHERE orders."userId" = users.id
    AND orders."status" IN ('OPEN', 'PARTIAL')
    AND orders."type" = 'BUY'
), 0);

UPDATE "Position" AS positions
SET "reservedQuantity" = COALESCE((
  SELECT SUM(orders."reservedQuantity")
  FROM "Order" AS orders
  WHERE orders."userId" = positions."userId"
    AND orders."creatorId" = positions."creatorId"
    AND orders."status" IN ('OPEN', 'PARTIAL')
    AND orders."type" = 'SELL'
), 0);

-- Execution references form permanent audit links. Parent identifiers must not
-- cascade into already-recorded executions.
ALTER TABLE "TradeExecution"
  DROP CONSTRAINT "TradeExecution_makerOrderId_fkey",
  DROP CONSTRAINT "TradeExecution_takerOrderId_fkey",
  DROP CONSTRAINT "TradeExecution_buyerId_fkey",
  DROP CONSTRAINT "TradeExecution_sellerId_fkey",
  DROP CONSTRAINT "TradeExecution_creatorId_fkey";

ALTER TABLE "TradeExecution"
  ADD CONSTRAINT "TradeExecution_makerOrderId_fkey"
    FOREIGN KEY ("makerOrderId") REFERENCES "Order"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "TradeExecution_takerOrderId_fkey"
    FOREIGN KEY ("takerOrderId") REFERENCES "Order"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "TradeExecution_buyerId_fkey"
    FOREIGN KEY ("buyerId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "TradeExecution_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "TradeExecution_creatorId_fkey"
    FOREIGN KEY ("creatorId") REFERENCES "Creator"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Trade executions are append-only audit records. Reject mutations instead of
-- silently discarding them so callers cannot mistake a no-op for success.
CREATE FUNCTION "reject_trade_execution_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'TradeExecution rows are immutable';
END;
$function$;

CREATE TRIGGER "TradeExecution_reject_update_or_delete"
BEFORE UPDATE OR DELETE ON "TradeExecution"
FOR EACH ROW
EXECUTE FUNCTION "reject_trade_execution_mutation"();
