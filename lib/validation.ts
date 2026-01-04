import { z } from "zod";

// Trade validation
export const tradeSchema = z.object({
  creatorId: z.string().cuid(),
  quantity: z.number().positive().max(10000, "Maximum quantity is 10,000"),
  orderType: z.enum(["MARKET", "LIMIT"]).default("MARKET"),
  limitPrice: z.number().positive().optional(),
});

export type TradeInput = z.infer<typeof tradeSchema>;

// Creator filter validation
export const creatorFilterSchema = z.object({
  category: z.string().optional(),
  minSubs: z.number().nonnegative().optional(),
  maxSubs: z.number().positive().optional(),
  sort: z.enum(["score", "subs", "growth", "price"]).optional(),
  page: z.number().positive().default(1),
  limit: z.number().positive().max(100).default(20),
});

export type CreatorFilter = z.infer<typeof creatorFilterSchema>;

// Creator stats query validation
export const statsQuerySchema = z.object({
  days: z.number().positive().max(365).default(30),
});

export type StatsQuery = z.infer<typeof statsQuerySchema>;
