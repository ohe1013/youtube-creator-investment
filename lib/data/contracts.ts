import { z } from "zod";

import {
  placeOrderRequestSchema,
} from "@/lib/contracts/trading";
import { decimalStringSchema } from "@/lib/contracts/decimal";

const finiteNonnegativeNumber = z.number().finite().nonnegative();
const finitePositiveNumber = z.number().finite().positive();
const isoDateTime = z.string().datetime({ offset: true });

export const identifierSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim() === value && value.trim() !== "", {
    message: "Identifiers must be nonblank without boundary whitespace",
  })
  .refine((value) => value !== "." && value !== "..", {
    message: "Path dot segments are not valid identifiers",
  });

const creatorCountSchema = z.object({
  videos: z.number().int().nonnegative(),
});

export const creatorSummarySchema = z.object({
  id: identifierSchema,
  youtubeChannelId: identifierSchema,
  name: z.string().min(1),
  thumbnailUrl: z.string().min(1).nullable(),
  category: z.string().min(1).nullable(),
  country: z.string().min(1).nullable(),
  currentSubs: finiteNonnegativeNumber,
  currentViews: finiteNonnegativeNumber,
  currentVideos: finiteNonnegativeNumber,
  currentScore: finiteNonnegativeNumber,
  initialPrice: decimalStringSchema,
  currentPrice: decimalStringSchema,
  totalSupply: decimalStringSchema,
  circulatingSupply: decimalStringSchema,
  reserveSupply: decimalStringSchema,
  liquidity: decimalStringSchema,
  isActive: z.boolean(),
  visibility: z.enum(["PUBLIC", "HIDDEN"]),
  avgLikes: finiteNonnegativeNumber,
  avgComments: finiteNonnegativeNumber,
  engagementRate: finiteNonnegativeNumber,
  viewsPerSubs: finiteNonnegativeNumber,
  createdAt: isoDateTime,
  lastSyncedAt: isoDateTime,
  _count: creatorCountSchema,
});

export type CreatorSummary = z.infer<typeof creatorSummarySchema>;

export const creatorSchema = creatorSummarySchema.extend({
  updatedAt: isoDateTime,
});

export type Creator = z.infer<typeof creatorSchema>;

export const creatorStatSchema = z.object({
  id: identifierSchema.optional(),
  creatorId: identifierSchema.optional(),
  date: isoDateTime,
  period: z.enum(["HOURLY", "DAILY"]).optional(),
  subs: finiteNonnegativeNumber,
  views: finiteNonnegativeNumber,
  videos: finiteNonnegativeNumber,
  dailySubsChange: z.number().finite(),
  dailyViewsChange: z.number().finite(),
  avgLikes: finiteNonnegativeNumber,
  avgComments: finiteNonnegativeNumber,
});

export type CreatorStat = z.infer<typeof creatorStatSchema>;

export const creatorVideoSchema = z.object({
  id: identifierSchema,
  creatorId: identifierSchema.optional(),
  title: z.string().min(1),
  thumbnailUrl: z.string().min(1).nullable(),
  publishedAt: isoDateTime,
  duration: z.string().min(1),
  type: z.enum(["LONG", "SHORTS"]),
  viewCount: finiteNonnegativeNumber,
  likeCount: finiteNonnegativeNumber,
  commentCount: finiteNonnegativeNumber,
  createdAt: isoDateTime.optional(),
  updatedAt: isoDateTime.optional(),
});

export type CreatorVideo = z.infer<typeof creatorVideoSchema>;

export const historyPointSchema = z.object({
  date: isoDateTime,
  price: decimalStringSchema,
  volume: decimalStringSchema,
});

export type HistoryPoint = z.infer<typeof historyPointSchema>;

const creatorIdentitySchema = z.object({
  id: identifierSchema,
  name: z.string().min(1),
});

export const tradeSchema = z.object({
  id: identifierSchema,
  creatorId: identifierSchema.optional(),
  userId: identifierSchema.optional(),
  orderId: identifierSchema.nullable().optional(),
  price: decimalStringSchema,
  quantity: decimalStringSchema,
  type: z.enum(["BUY", "SELL"]),
  createdAt: isoDateTime,
  creator: creatorIdentitySchema.optional(),
});

export type Trade = z.infer<typeof tradeSchema>;

export const orderSchema = z.object({
  id: identifierSchema,
  creatorId: identifierSchema,
  userId: identifierSchema.optional(),
  side: z.enum(["BUY", "SELL"]),
  orderType: z.enum(["LIMIT", "MARKET"]),
  price: decimalStringSchema,
  quantity: decimalStringSchema,
  filled: decimalStringSchema,
  reservedQuote: decimalStringSchema.optional(),
  reservedQuantity: decimalStringSchema.optional(),
  status: z.enum(["OPEN", "PARTIAL", "FILLED", "CANCELLED"]),
  completedAt: isoDateTime.nullable().optional(),
  cancelReason: z.string().nullable().optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime.optional(),
  creator: creatorIdentitySchema.optional(),
});

export type Order = z.infer<typeof orderSchema>;

const openOrderSchema = orderSchema.extend({
  status: z.enum(["OPEN", "PARTIAL"]),
});

export const priceLevelSchema = z.object({
  price: decimalStringSchema,
  quantity: decimalStringSchema,
});

export const orderBookSchema = z.object({
  asks: z.array(priceLevelSchema),
  bids: z.array(priceLevelSchema),
});

export type OrderBook = z.infer<typeof orderBookSchema>;

export const positionSchema = z.object({
  id: identifierSchema,
  creatorId: identifierSchema,
  quantity: decimalStringSchema,
  reservedQuantity: decimalStringSchema,
  avgPrice: decimalStringSchema,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const portfolioSchema = z.object({
  balance: decimalStringSchema,
  reservedBalance: decimalStringSchema,
  availableBalance: decimalStringSchema,
  positions: z.array(positionSchema),
  openOrders: z.array(openOrderSchema),
  executions: z.array(
    z.object({
      id: identifierSchema,
      creatorId: identifierSchema,
      side: z.enum(["BUY", "SELL"]),
      price: decimalStringSchema,
      quantity: decimalStringSchema,
      quoteAmount: decimalStringSchema,
      executedAt: isoDateTime,
    }),
  ),
});

export type Portfolio = z.infer<typeof portfolioSchema>;

const dashboardRankingSchema = z.object({
  id: identifierSchema,
  name: z.string().min(1),
  thumbnailUrl: z.string().min(1).nullable(),
  category: z.string().min(1).nullable(),
  currentPrice: decimalStringSchema,
  currentScore: finiteNonnegativeNumber,
  circulatingSupply: decimalStringSchema,
  marketCap: decimalStringSchema,
});

const dashboardListingSchema = z.object({
  id: identifierSchema,
  name: z.string().min(1),
  thumbnailUrl: z.string().min(1).nullable(),
  currentPrice: decimalStringSchema,
  createdAt: isoDateTime,
});

export const dashboardSchema = z.object({
  stats: z.object({
    totalMarketCap: decimalStringSchema,
    totalVolume24h: decimalStringSchema,
    totalCreators: z.number().int().nonnegative(),
    activeTraders: z.number().int().nonnegative(),
  }),
  rankings: z.array(dashboardRankingSchema),
  newListings: z.array(dashboardListingSchema),
  user: z
    .object({
      balance: decimalStringSchema,
      portfolioValue: decimalStringSchema,
      totalAssets: decimalStringSchema,
      topHolding: z.string().min(1).nullable(),
    })
    .nullable(),
});

export type Dashboard = z.infer<typeof dashboardSchema>;

export const creatorQuerySchema = z.object({
  category: z.string().min(1).optional(),
  minSubs: finiteNonnegativeNumber.optional(),
  maxSubs: finitePositiveNumber.optional(),
  sort: z.enum(["score", "subs", "price", "growth"]).optional(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export type CreatorQuery = z.infer<typeof creatorQuerySchema>;

export const paginatedCreatorsSchema = z.object({
  creators: z.array(creatorSummarySchema),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});

export type PaginatedCreators = z.infer<typeof paginatedCreatorsSchema>;

export const placeOrderInputSchema = placeOrderRequestSchema;

/** Browser input is parsed before transport; wire decimals remain plain strings. */
export type PlaceOrderInput = z.input<typeof placeOrderRequestSchema>;

export type RequestOptions = { signal?: AbortSignal };

export interface CreatorXDataClient {
  listCategories(options?: RequestOptions): Promise<string[]>;
  listCreators(
    query: CreatorQuery,
    options?: RequestOptions,
  ): Promise<PaginatedCreators>;
  getCreator(id: string, options?: RequestOptions): Promise<Creator>;
  getCreatorStats(
    id: string,
    query: { days: number },
    options?: RequestOptions,
  ): Promise<CreatorStat[]>;
  getCreatorVideos(
    id: string,
    options?: RequestOptions,
  ): Promise<CreatorVideo[]>;
  getCreatorHistory(
    id: string,
    query: { days: number },
    options?: RequestOptions,
  ): Promise<HistoryPoint[]>;
  getCreatorTrades(id: string, options?: RequestOptions): Promise<Trade[]>;
  getOrderBook(id: string, options?: RequestOptions): Promise<OrderBook>;
  getDashboard(options?: RequestOptions): Promise<Dashboard>;
  getPortfolio(options?: RequestOptions): Promise<Portfolio>;
  placeOrder(
    input: PlaceOrderInput,
    options?: RequestOptions & { idempotencyKey?: string },
  ): Promise<Order>;
  cancelOrder(
    id: string,
    options?: RequestOptions & { idempotencyKey?: string },
  ): Promise<void>;
}
