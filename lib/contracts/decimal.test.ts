import { expect, it } from "vitest";
import {
  decimalStringSchema,
  serializeDecimal,
} from "@/lib/contracts/decimal";

it("keeps exact decimal text", () => {
  expect(decimalStringSchema.parse("100000.0000")).toBe("100000.0000");
  expect(serializeDecimal("0.10000000")).toBe("0.10000000");
});

it("rejects non-decimal and unsafe numeric representations", () => {
  expect(decimalStringSchema.safeParse("1e-8").success).toBe(false);
  expect(decimalStringSchema.safeParse("NaN").success).toBe(false);
  expect(decimalStringSchema.safeParse("Infinity").success).toBe(false);
  // @ts-expect-error Runtime callers may still be untyped JavaScript.
  expect(() => serializeDecimal(0.1)).toThrow();
});
