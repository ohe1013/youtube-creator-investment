import { z } from "zod";

const finiteNonnegativeNumber = z.number().finite().nonnegative();
const finitePositiveNumber = z.number().finite().positive();
const isoDateTime = z.string().datetime({ offset: true });

const creatorCountSchema = z.object({
  videos: z.number().int().nonnegative(),
});

export const creatorSummarySchema = z.object({
  id: z.string().min(1),
  youtubeChannelId: z.string().min(1),
  name: z.string().min(1),
  thumbnailUrl: z.string().min(1).nullable(),
  category: z.string().min(1).nullable(),
  country: z.string().min(1).nullable(),
  currentSubs: finiteNonnegativeNumber,
  currentViews: finiteNonnegativeNumber,
  currentVideos: finiteNonnegativeNumber,
  currentScore: finiteNonnegativeNumber,
  initialPrice: finiteNonnegativeNumber,
  currentPrice: finiteNonnegativeNumber,
  totalSupply: finiteNonnegativeNumber,
  circulatingSupply: finiteNonnegativeNumber,
  reserveSupply: finiteNonnegativeNumber,
  liquidity: finiteNonnegativeNumber,
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
  id: z.string().min(1).optional(),
  creatorId: z.string().min(1).optional(),
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
  id: z.string().min(1),
  creatorId: z.string().min(1).optional(),
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
  price: finiteNonnegativeNumber,
  volume: finiteNonnegativeNumber,
});

export type HistoryPoint = z.infer<typeof historyPointSchema>;

const creatorIdentitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

export const tradeSchema = z.object({
  id: z.string().min(1),
  creatorId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  orderId: z.string().min(1).nullable().optional(),
  price: finitePositiveNumber,
  quantity: finitePositiveNumber,
  type: z.enum(["BUY", "SELL"]),
  createdAt: isoDateTime,
  creator: creatorIdentitySchema.optional(),
});

export type Trade = z.infer<typeof tradeSchema>;

export const orderSchema = z.object({
  id: z.string().min(1),
  creatorId: z.string().min(1),
  userId: z.string().min(1).optional(),
  type: z.enum(["BUY", "SELL"]),
  orderType: z.enum(["LIMIT", "MARKET"]),
  price: finitePositiveNumber,
  quantity: finitePositiveNumber,
  filled: finiteNonnegativeNumber,
  status: z.enum(["OPEN", "PARTIAL", "FILLED", "CANCELLED"]),
  createdAt: isoDateTime,
  updatedAt: isoDateTime.optional(),
  creator: creatorIdentitySchema.optional(),
});

export type Order = z.infer<typeof orderSchema>;

const openOrderSchema = orderSchema.extend({
  status: z.enum(["OPEN", "PARTIAL"]),
});

export const priceLevelSchema = z.object({
  price: finitePositiveNumber,
  quantity: finitePositiveNumber,
});

export const orderBookSchema = z.object({
  asks: z.array(priceLevelSchema),
  bids: z.array(priceLevelSchema),
});

export type OrderBook = z.infer<typeof orderBookSchema>;

const portfolioCreatorSchema = creatorIdentitySchema.extend({
  currentPrice: finiteNonnegativeNumber,
  thumbnailUrl: z.string().min(1).nullable(),
});

export const positionSchema = z.object({
  id: z.string().min(1),
  creatorId: z.string().min(1),
  quantity: finitePositiveNumber,
  avgPrice: finiteNonnegativeNumber,
  creator: portfolioCreatorSchema,
});

export const portfolioSchema = z.object({
  balance: finiteNonnegativeNumber,
  positions: z.array(positionSchema),
  openOrders: z.array(openOrderSchema),
  trades: z.array(tradeSchema),
});

export type Portfolio = z.infer<typeof portfolioSchema>;

const dashboardRankingSchema = creatorSummarySchema
  .pick({
    id: true,
    name: true,
    thumbnailUrl: true,
    category: true,
    currentPrice: true,
    currentScore: true,
    circulatingSupply: true,
  })
  .extend({ marketCap: finiteNonnegativeNumber });

const dashboardListingSchema = creatorSummarySchema.pick({
  id: true,
  name: true,
  thumbnailUrl: true,
  currentPrice: true,
  createdAt: true,
});

export const dashboardSchema = z.object({
  stats: z.object({
    totalMarketCap: finiteNonnegativeNumber,
    totalVolume24h: finiteNonnegativeNumber,
    totalCreators: z.number().int().nonnegative(),
    activeTraders: z.number().int().nonnegative(),
  }),
  rankings: z.array(dashboardRankingSchema),
  newListings: z.array(dashboardListingSchema),
  user: z
    .object({
      balance: finiteNonnegativeNumber,
      portfolioValue: finiteNonnegativeNumber,
      totalAssets: finiteNonnegativeNumber,
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

export const placeOrderInputSchema = z
  .object({
    creatorId: z.string().min(1),
    side: z.enum(["BUY", "SELL"]),
    orderType: z.enum(["LIMIT", "MARKET"]),
    price: finitePositiveNumber,
    quantity: finitePositiveNumber,
  })
  .strict();

export type PlaceOrderInput = z.infer<typeof placeOrderInputSchema>;

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
  cancelOrder(id: string, options?: RequestOptions): Promise<void>;
}
