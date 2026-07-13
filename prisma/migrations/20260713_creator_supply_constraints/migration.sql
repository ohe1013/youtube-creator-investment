-- Creator share supplies are quantities and cannot be negative.
ALTER TABLE "Creator"
  ADD CONSTRAINT "Creator_supplies_nonnegative"
  CHECK (
    "circulatingSupply" >= 0
    AND "reserveSupply" >= 0
    AND "totalSupply" >= 0
  );
