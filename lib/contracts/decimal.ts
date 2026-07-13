import type { Prisma } from "@prisma/client";
import { z } from "zod";

const DECIMAL_TEXT = /^-?\d+(?:\.\d+)?$/;

export const decimalStringSchema = z
  .string()
  .regex(DECIMAL_TEXT, "Expected a plain base-10 decimal string")
  .brand<"DecimalString">();

export type DecimalString = z.infer<typeof decimalStringSchema>;

type DecimalSerializable = string | Prisma.Decimal;

export function serializeDecimal(value: DecimalSerializable): DecimalString {
  if (typeof value === "number") {
    throw new TypeError("Decimal values must not be serialized from numbers");
  }

  const text = typeof value === "string" ? value : value.toFixed();
  return decimalStringSchema.parse(text);
}
