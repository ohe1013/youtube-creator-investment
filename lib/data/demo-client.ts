import { z } from "zod";

import { appInTossDemoData } from "@/lib/appintoss-demo-data";
import {
  creatorQuerySchema,
  creatorSchema,
  creatorStatSchema,
  creatorVideoSchema,
  dashboardSchema,
  historyPointSchema,
  identifierSchema,
  orderBookSchema,
  orderSchema,
  paginatedCreatorsSchema,
  placeOrderInputSchema,
  portfolioSchema,
  tradeSchema,
  type Creator,
  type CreatorQuery,
  type CreatorStat,
  type CreatorVideo,
  type CreatorXDataClient,
  type Dashboard,
  type HistoryPoint,
  type Order,
  type OrderBook,
  type PaginatedCreators,
  type PlaceOrderInput,
  type Portfolio,
  type RequestOptions,
  type Trade,
} from "@/lib/data/contracts";
import { decimalStringSchema, type DecimalString } from "@/lib/contracts/decimal";
import { CreatorXClientError } from "@/lib/data/errors";
import type { AsyncKeyValueStore } from "@/lib/storage/client-storage";

const INITIAL_BALANCE = 100_000;
const STATE_KEY_PREFIX = "creatorx:appintoss:state:";
const ALL_CATEGORY = "전체";

const daysQuerySchema = z.object({ days: z.number().int().positive() }).strict();
const localPositionSchema = z
  .object({
    id: identifierSchema,
    creatorId: identifierSchema,
    quantity: z.number().finite().nonnegative(),
    avgPrice: z.number().finite().nonnegative(),
  })
  .strict();
const localOrderRecordSchema = z
  .object({
    id: identifierSchema,
    creatorId: identifierSchema,
    type: z.enum(["BUY", "SELL"]),
    orderType: z.enum(["LIMIT", "MARKET"]).default("LIMIT"),
    price: z.number().finite().nonnegative(),
    quantity: z.number().finite().nonnegative(),
    filled: z.number().finite().nonnegative(),
    status: z.enum(["OPEN", "PARTIAL", "FILLED", "CANCELLED"]),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }).optional(),
    reservedAvgPrice: z.number().finite().nonnegative().optional(),
  })
  .strict();
const localOrderSchema = localOrderRecordSchema.refine(
    (order) =>
      (order.status === "OPEN" || order.status === "PARTIAL") &&
      order.filled <= order.quantity,
    { message: "Persisted open orders must be active with valid fill data" },
  );
const localTradeSchema = z
  .object({
    id: identifierSchema,
    creatorId: identifierSchema,
    userId: identifierSchema,
    price: z.number().finite().nonnegative(),
    quantity: z.number().finite().nonnegative(),
    type: z.enum(["BUY", "SELL"]),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
const localIdempotencyRecordSchema = z
  .object({
    key: z.string(),
    fingerprint: z.string().min(1),
    response: localOrderRecordSchema,
  })
  .strict();
const localStateSchema = z
  .object({
    balance: z.number().finite().nonnegative(),
    positions: z.array(localPositionSchema),
    openOrders: z.array(localOrderSchema),
    trades: z.array(localTradeSchema),
    // Optional only while migrating state written before idempotent demo orders.
    idempotencyRecords: z.array(localIdempotencyRecordSchema).optional(),
    // Optional only for the targeted migration of pre-tombstone demo state.
    usedIds: z.array(identifierSchema).optional(),
  })
  .strict()
  .superRefine((state, context) => {
    const positionIds = new Set<string>();
    const positionCreators = new Set<string>();
    for (const position of state.positions) {
      if (
        positionIds.has(position.id) ||
        positionCreators.has(position.creatorId)
      ) {
        context.addIssue({
          code: "custom",
          path: ["positions"],
          message: "Persisted positions must be unique",
        });
      }
      positionIds.add(position.id);
      positionCreators.add(position.creatorId);
    }

    const knownIds = new Set<string>();
    for (const order of state.openOrders) {
      if (knownIds.has(order.id)) {
        context.addIssue({
          code: "custom",
          path: ["openOrders"],
          message: "Persisted order and trade IDs must be unique",
        });
      }
      knownIds.add(order.id);
    }

    for (const trade of state.trades) {
      if (knownIds.has(trade.id)) {
        context.addIssue({
          code: "custom",
          path: ["trades"],
          message: "Persisted order and trade IDs must be unique",
        });
      }
      knownIds.add(trade.id);
    }

    const usedIds = new Set<string>();
    for (const id of state.usedIds ?? []) {
      if (usedIds.has(id)) {
        context.addIssue({
          code: "custom",
          path: ["usedIds"],
          message: "Persisted used IDs must be unique",
        });
      }
      usedIds.add(id);
    }

    const idempotencyKeys = new Set<string>();
    for (const record of state.idempotencyRecords ?? []) {
      if (idempotencyKeys.has(record.key)) {
        context.addIssue({
          code: "custom",
          path: ["idempotencyRecords"],
          message: "Persisted idempotency keys must be unique",
        });
      }
      idempotencyKeys.add(record.key);
    }
  });

type ParsedLocalState = z.infer<typeof localStateSchema>;
type LocalState = Omit<
  ParsedLocalState,
  "idempotencyRecords" | "usedIds"
> & {
  idempotencyRecords: Array<z.infer<typeof localIdempotencyRecordSchema>>;
  usedIds: string[];
};
type LocalPosition = z.infer<typeof localPositionSchema>;
type LocalOrder = z.infer<typeof localOrderSchema>;

const mutationQueues = new Map<string, Promise<void>>();
const storeScopeIds = new WeakMap<AsyncKeyValueStore, number>();
let nextStoreScopeId = 0;

function storeScope(store: AsyncKeyValueStore): string {
  let id = storeScopeIds.get(store);
  if (id === undefined) {
    id = ++nextStoreScopeId;
    storeScopeIds.set(store, id);
  }
  return `store:${id}`;
}

function enqueueMutation<T>(
  stateKey: string,
  mutation: () => Promise<T>,
): Promise<T> {
  const previous = mutationQueues.get(stateKey) ?? Promise.resolve();
  const result = previous.then(mutation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  mutationQueues.set(stateKey, tail);
  void tail.then(() => {
    if (mutationQueues.get(stateKey) === tail) mutationQueues.delete(stateKey);
  });
  return result;
}

export type DemoDataClientDependencies = {
  store: AsyncKeyValueStore;
  namespace: string;
  storageScope?: string;
  now?: () => Date;
  idFactory?: () => string;
};

function requestError(): CreatorXClientError {
  return new CreatorXClientError(
    "REQUEST_REJECTED",
    "요청 값이 올바르지 않습니다.",
    false,
    400,
  );
}

function parseRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw requestError();
  return result.data;
}

function parseResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw invalidStateError();
  return result.data;
}

/**
 * Offline demo state previously accepted numeric order inputs. Keep that
 * migration shim local to the demo implementation; the shared browser/API
 * contract remains the decimal-string schema.
 */
function parseDemoOrderInput(value: unknown) {
  const modern = placeOrderInputSchema.safeParse(value);
  if (modern.success) return modern.data;
  if (
    typeof value === "object" &&
    value !== null &&
    "price" in value &&
    "quantity" in value &&
    typeof value.price === "number" &&
    typeof value.quantity === "number" &&
    "orderType" in value
  ) {
    const legacy = value as {
      creatorId?: unknown;
      side?: unknown;
      orderType?: unknown;
      price: number;
      quantity: number;
    };
    return parseRequest(placeOrderInputSchema, {
      creatorId: legacy.creatorId,
      side: legacy.side,
      orderType: legacy.orderType,
      quantity: String(legacy.quantity),
      ...(legacy.orderType === "LIMIT"
        ? { limitPrice: String(legacy.price) }
        : {}),
    });
  }
  throw requestError();
}

function storageError(): CreatorXClientError {
  return new CreatorXClientError(
    "STORAGE_UNAVAILABLE",
    "저장소를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    true,
  );
}

function invalidStateError(): CreatorXClientError {
  return new CreatorXClientError(
    "INVALID_RESPONSE",
    "저장된 데이터를 읽을 수 없습니다. 다시 시도해 주세요.",
    true,
  );
}

function identifierCollisionError(): CreatorXClientError {
  return new CreatorXClientError(
    "INVALID_RESPONSE",
    "새 주문 식별자를 만들 수 없습니다. 다시 시도해 주세요.",
    true,
  );
}

function idempotencyKeyReusedError(): CreatorXClientError {
  return new CreatorXClientError(
    "IDEMPOTENCY_KEY_REUSED",
    "같은 요청 키를 다른 주문에 사용할 수 없습니다.",
    false,
    409,
  );
}

function orderFingerprint(input: PlaceOrderInput): string {
  return JSON.stringify([
    input.creatorId,
    input.side,
    input.orderType,
    input.quantity,
    input.orderType === "LIMIT" ? input.limitPrice : input.maxSlippageBps ?? null,
  ]);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareNewest(
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string },
): number {
  return (
    Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
    compareText(left.id, right.id)
  );
}

function canonicalizeState(state: ParsedLocalState): LocalState {
  for (const order of state.openOrders) {
    if (order.type !== "SELL" || order.reservedAvgPrice !== undefined) {
      continue;
    }
    const position = state.positions.find(
      ({ creatorId }) => creatorId === order.creatorId,
    );
    if (!position) throw invalidStateError();
    order.reservedAvgPrice = position.avgPrice;
  }

  const usedIds = new Set(state.usedIds ?? []);
  for (const order of state.openOrders) usedIds.add(order.id);
  for (const trade of state.trades) usedIds.add(trade.id);
  for (const record of state.idempotencyRecords ?? []) {
    usedIds.add(record.response.id);
  }
  return {
    ...state,
    idempotencyRecords: [...(state.idempotencyRecords ?? [])].sort((left, right) =>
      compareText(left.key, right.key),
    ),
    usedIds: [...usedIds].sort(compareText),
  };
}

function decimal(value: number): DecimalString {
  if (!Number.isFinite(value)) throw invalidStateError();
  return decimalStringSchema.parse(String(value));
}

function toPublicCreator(creator: (typeof appInTossDemoData.creators)[number]): Creator {
  return parseResponse(creatorSchema, {
    ...creator,
    initialPrice: decimal(creator.initialPrice),
    currentPrice: decimal(creator.currentPrice),
    totalSupply: decimal(creator.totalSupply),
    circulatingSupply: decimal(creator.circulatingSupply),
    reserveSupply: decimal(creator.reserveSupply),
    liquidity: decimal(creator.liquidity),
  });
}

function toPublicOrder(order: LocalOrder): Order {
  const remaining = Math.max(0, order.quantity - order.filled);
  return parseResponse(orderSchema, {
    id: order.id,
    creatorId: order.creatorId,
    side: order.type,
    orderType: order.orderType,
    price: decimal(order.price),
    quantity: decimal(order.quantity),
    filled: decimal(order.filled),
    reservedQuote: decimal(order.type === "BUY" ? remaining * order.price : 0),
    reservedQuantity: decimal(order.type === "SELL" ? remaining : 0),
    status: order.status,
    completedAt: order.status === "FILLED" ? order.createdAt : null,
    cancelReason: null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt ?? order.createdAt,
  });
}

function toPublicTrade(trade: {
  id: string;
  creatorId: string;
  userId?: string;
  orderId?: string | null;
  price: number;
  quantity: number;
  type: "BUY" | "SELL";
  createdAt: string;
}): Trade {
  return parseResponse(tradeSchema, {
    ...trade,
    price: decimal(trade.price),
    quantity: decimal(trade.quantity),
  });
}

export class DemoDataClient implements CreatorXDataClient {
  private readonly mutationKey: string;
  private readonly stateKey: string;
  private readonly namespace: string;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(private readonly dependencies: DemoDataClientDependencies) {
    const namespace = parseRequest(identifierSchema, dependencies.namespace);
    this.namespace = namespace;
    this.stateKey = `${STATE_KEY_PREFIX}${namespace}`;
    const scope =
      dependencies.storageScope === undefined
        ? storeScope(dependencies.store)
        : `stable:${parseRequest(identifierSchema, dependencies.storageScope)}`;
    this.mutationKey = `${scope}:${this.stateKey}`;
    this.now = dependencies.now ?? (() => new Date());
    this.idFactory =
      dependencies.idFactory ?? (() => globalThis.crypto.randomUUID());
  }

  async listCategories(options?: RequestOptions): Promise<string[]> {
    this.checkSignal(options);
    const categories = appInTossDemoData.creators
      .map(({ category }) => category)
      .filter((category): category is string => category !== null);

    return [ALL_CATEGORY, ...new Set(categories)].sort((left, right) => {
      if (left === right) return 0;
      if (left === ALL_CATEGORY) return -1;
      if (right === ALL_CATEGORY) return 1;
      return compareText(left, right);
    });
  }

  async listCreators(
    query: CreatorQuery,
    options?: RequestOptions,
  ): Promise<PaginatedCreators> {
    this.checkSignal(options);
    const parsed = parseRequest(creatorQuerySchema, query);
    const page = parsed.page ?? 1;
    const limit = parsed.limit ?? 20;
    const sort = parsed.sort ?? "score";
    let creators = appInTossDemoData.creators
      .filter((creator) => creator.isActive && creator.visibility === "PUBLIC")
      .map((creator) => toPublicCreator(creator));

    if (parsed.category && parsed.category !== ALL_CATEGORY) {
      creators = creators.filter(
        (creator) => creator.category === parsed.category,
      );
    }
    if (parsed.minSubs !== undefined) {
      creators = creators.filter(
        (creator) => creator.currentSubs >= parsed.minSubs!,
      );
    }
    if (parsed.maxSubs !== undefined) {
      creators = creators.filter(
        (creator) => creator.currentSubs <= parsed.maxSubs!,
      );
    }

    creators.sort((left, right) => {
      let difference: number;
      switch (sort) {
        case "subs":
          difference = right.currentSubs - left.currentSubs;
          break;
        case "price":
          difference =
            Number(right.currentPrice) - Number(left.currentPrice);
          break;
        case "growth":
        case "score":
          difference = right.currentScore - left.currentScore;
          break;
      }
      return difference || compareText(left.id, right.id);
    });

    const total = creators.length;
    const start = (page - 1) * limit;
    return parseResponse(paginatedCreatorsSchema, {
      creators: creators.slice(start, start + limit),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  }

  async getCreator(id: string, options?: RequestOptions): Promise<Creator> {
    this.checkSignal(options);
    return toPublicCreator(this.requireCreator(id));
  }

  async getCreatorStats(
    id: string,
    query: { days: number },
    options?: RequestOptions,
  ): Promise<CreatorStat[]> {
    this.checkSignal(options);
    const creator = this.requireCreator(id);
    parseRequest(daysQuerySchema, query);
    return parseResponse(
      creatorStatSchema.array(),
      appInTossDemoData.stats[creator.id],
    );
  }

  async getCreatorVideos(
    id: string,
    options?: RequestOptions,
  ): Promise<CreatorVideo[]> {
    this.checkSignal(options);
    const creator = this.requireCreator(id);
    return parseResponse(
      creatorVideoSchema.array(),
      appInTossDemoData.videos[creator.id],
    );
  }

  async getCreatorHistory(
    id: string,
    query: { days: number },
    options?: RequestOptions,
  ): Promise<HistoryPoint[]> {
    this.checkSignal(options);
    const creator = this.requireCreator(id);
    parseRequest(daysQuerySchema, query);
    const state = await this.readState();
    const trades = this.localTradesForCreator(creator.id, state).reverse();
    const history = trades.map((trade) => ({
      date: trade.createdAt,
      price: decimal(trade.price),
      volume: decimal(trade.quantity * trade.price),
    }));

    return parseResponse(
      historyPointSchema.array(),
      history.length > 0
        ? history
        : [
            {
              date: appInTossDemoData.generatedAt,
              price: decimal(creator.currentPrice),
              volume: decimal(0),
            },
          ],
    );
  }

  async getCreatorTrades(
    id: string,
    options?: RequestOptions,
  ): Promise<Trade[]> {
    this.checkSignal(options);
    const creator = this.requireCreator(id);
    return parseResponse(
      tradeSchema.array(),
      this.localTradesForCreator(creator.id, await this.readState()).map(
        toPublicTrade,
      ),
    );
  }

  async getOrderBook(
    id: string,
    options?: RequestOptions,
  ): Promise<OrderBook> {
    this.checkSignal(options);
    const creator = this.requireCreator(id);
    return parseResponse(
      orderBookSchema,
      this.toPublicOrderBook(this.buildOrderBook(creator.id, await this.readState())),
    );
  }

  async getDashboard(options?: RequestOptions): Promise<Dashboard> {
    this.checkSignal(options);
    const state = await this.readState();
    const creators = [...appInTossDemoData.creators];
    creators.sort(
      (left, right) =>
        right.currentScore - left.currentScore ||
        compareText(left.id, right.id),
    );
    const totalMarketCap = creators.reduce(
      (sum, creator) =>
        sum + creator.currentPrice * creator.circulatingSupply,
      0,
    );
    const totalVolume24h = Object.values(appInTossDemoData.trades)
      .flat()
      .reduce((sum, trade) => sum + trade.price * trade.quantity, 0);
    const positions = this.enrichPositions(state.positions);
    const portfolioValue = positions.reduce(
      (sum, position) =>
        sum + position.quantity * position.creator.currentPrice,
      0,
    );

    return parseResponse(dashboardSchema, {
      stats: {
        totalMarketCap: decimal(totalMarketCap),
        totalVolume24h: decimal(totalVolume24h),
        totalCreators: creators.length,
        activeTraders: 124,
      },
      rankings: creators.slice(0, 10).map((creator) => ({
        id: creator.id,
        name: creator.name,
        thumbnailUrl: creator.thumbnailUrl,
        category: creator.category,
        currentPrice: decimal(creator.currentPrice),
        currentScore: creator.currentScore,
        circulatingSupply: decimal(creator.circulatingSupply),
        marketCap: decimal(creator.currentPrice * creator.circulatingSupply),
      })),
      newListings: [...creators]
        .sort(
          (left, right) =>
            Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
            compareText(left.id, right.id),
        )
        .slice(0, 5)
        .map((creator) => ({
          id: creator.id,
          name: creator.name,
          thumbnailUrl: creator.thumbnailUrl,
          currentPrice: decimal(creator.currentPrice),
          createdAt: creator.createdAt,
        })),
      user: {
        balance: decimal(state.balance),
        portfolioValue: decimal(portfolioValue),
        totalAssets: decimal(state.balance + portfolioValue),
        topHolding: positions[0]?.creator.name ?? null,
      },
    });
  }

  async getPortfolio(options?: RequestOptions): Promise<Portfolio> {
    this.checkSignal(options);
    const state = await this.readState();
    const reservedBalance = state.openOrders
      .filter((order) => order.type === "BUY")
      .reduce(
        (sum, order) => sum + (order.quantity - order.filled) * order.price,
        0,
      );
    return parseResponse(portfolioSchema, {
      balance: decimal(state.balance + reservedBalance),
      reservedBalance: decimal(reservedBalance),
      availableBalance: decimal(state.balance),
      positions: state.positions
        .filter((position) => position.quantity > 0)
        .map((position) => ({
          id: position.id,
          creatorId: position.creatorId,
          quantity: decimal(position.quantity),
          reservedQuantity: decimal(
            state.openOrders
              .filter(
                (order) =>
                  order.creatorId === position.creatorId && order.type === "SELL",
              )
              .reduce((sum, order) => sum + order.quantity - order.filled, 0),
          ),
          avgPrice: decimal(position.avgPrice),
          createdAt: appInTossDemoData.generatedAt,
          updatedAt: appInTossDemoData.generatedAt,
        })),
      openOrders: [...state.openOrders]
        .sort(compareNewest)
        .map(toPublicOrder),
      executions: [...state.trades].sort(compareNewest).map((trade) => ({
        id: trade.id,
        creatorId: trade.creatorId,
        side: trade.type,
        price: decimal(trade.price),
        quantity: decimal(trade.quantity),
        quoteAmount: decimal(trade.price * trade.quantity),
        executedAt: trade.createdAt,
      })),
    });
  }

  async placeOrder(
    input: unknown,
    options?: RequestOptions & { idempotencyKey?: string },
  ): Promise<Order> {
    this.checkSignal(options);
    const parsed = parseDemoOrderInput(input);
    const idempotencyKey =
      options?.idempotencyKey === undefined
        ? null
        : parseRequest(z.string(), options.idempotencyKey);
    const fingerprint = orderFingerprint(parsed);
    const quantity = Number(parsed.quantity);
    const creator = this.requireCreator(parsed.creatorId);
    const price =
      parsed.orderType === "LIMIT"
        ? Number(parsed.limitPrice)
        : creator.currentPrice;
    const total = price * quantity;
    if (!Number.isFinite(total)) throw requestError();

    return enqueueMutation(
      this.mutationKey,
      async () => {
        this.checkSignal(options);
        const state = await this.readState();
        if (idempotencyKey !== null) {
          const existing = state.idempotencyRecords.find(
            ({ key }) => key === idempotencyKey,
          );
          if (existing) {
            if (existing.fingerprint !== fingerprint) {
              throw idempotencyKeyReusedError();
            }
            return toPublicOrder(existing.response);
          }
        }
        const shouldFill =
          parsed.orderType === "MARKET" ||
          (parsed.side === "BUY" && price >= creator.currentPrice) ||
          (parsed.side === "SELL" && price <= creator.currentPrice);
        const position = state.positions.find(
          ({ creatorId }) => creatorId === creator.id,
        );

        if (parsed.side === "BUY" && state.balance < total) {
          throw new CreatorXClientError(
            "INSUFFICIENT_BALANCE",
            "보유 포인트가 부족합니다.",
            false,
            409,
          );
        }
        if (
          parsed.side === "SELL" &&
          (!position || position.quantity < quantity)
        ) {
          throw new CreatorXClientError(
            "INSUFFICIENT_SHARES",
            "보유 수량이 부족합니다.",
            false,
            409,
          );
        }

        const createdAt = this.getTimestamp();
        const orderId = this.getId("order");
        if (state.usedIds.includes(orderId)) {
          throw identifierCollisionError();
        }
        const tradeId = shouldFill ? this.getId("trade") : null;
        if (
          tradeId &&
          (tradeId === orderId || state.usedIds.includes(tradeId))
        ) {
          throw identifierCollisionError();
        }
        const order: LocalOrder = {
          id: orderId,
          creatorId: creator.id,
          type: parsed.side,
          orderType: parsed.orderType,
          price,
          quantity,
          filled: shouldFill ? quantity : 0,
          status: shouldFill ? "FILLED" : "OPEN",
          createdAt,
          reservedAvgPrice:
            parsed.side === "SELL" && !shouldFill
              ? position?.avgPrice
              : undefined,
        };

        state.usedIds.push(orderId);
        if (tradeId) state.usedIds.push(tradeId);
        state.usedIds.sort(compareText);

        if (parsed.side === "BUY") {
          state.balance -= total;
        } else {
          if (!position) throw invalidStateError();
          position.quantity -= quantity;
        }

        if (shouldFill) {
          if (!tradeId) throw invalidStateError();
          if (parsed.side === "BUY") {
            this.addPosition(state, creator, quantity, price);
          } else {
            state.balance += total;
          }
          state.trades.unshift({
            id: tradeId,
            creatorId: creator.id,
            userId: this.namespace,
            price,
            quantity,
            type: parsed.side,
            createdAt,
          });
        } else {
          state.openOrders.unshift(order);
        }

        const response = toPublicOrder(order);
        if (idempotencyKey !== null) {
          state.idempotencyRecords.push({
            key: idempotencyKey,
            fingerprint,
            response: order,
          });
          state.idempotencyRecords.sort((left, right) =>
            compareText(left.key, right.key),
          );
        }
        await this.writeState(state);
        return response;
      },
    );
  }

  async cancelOrder(
    id: string,
    options?: RequestOptions & { idempotencyKey?: string },
  ): Promise<void> {
    this.checkSignal(options);
    const orderId = parseRequest(identifierSchema, id);
    await enqueueMutation(
      this.mutationKey,
      async () => {
        this.checkSignal(options);
        const state = await this.readState();
        const orderIndex = state.openOrders.findIndex(
          ({ id: candidate }) => candidate === orderId,
        );
        const order = state.openOrders[orderIndex];
        if (!order) {
          throw new CreatorXClientError(
            "ORDER_NOT_FOUND",
            "취소할 주문을 찾을 수 없습니다.",
            false,
            404,
          );
        }

        const remaining = order.quantity - order.filled;
        if (order.type === "BUY") {
          const refund = remaining * order.price;
          if (!Number.isFinite(refund + state.balance)) {
            throw invalidStateError();
          }
          state.balance += refund;
        } else {
          const position = state.positions.find(
            ({ creatorId }) => creatorId === order.creatorId,
          );
          const refundAvgPrice = order.reservedAvgPrice ?? position?.avgPrice;
          if (refundAvgPrice === undefined) throw invalidStateError();
          this.addPosition(
            state,
            this.requireCreator(order.creatorId),
            remaining,
            refundAvgPrice,
          );
        }
        state.openOrders.splice(orderIndex, 1);
        await this.writeState(state);
      },
    );
  }

  private checkSignal(options?: RequestOptions): void {
    options?.signal?.throwIfAborted();
  }

  private requireCreator(id: string): (typeof appInTossDemoData.creators)[number] {
    const creatorId = parseRequest(identifierSchema, id);
    const creator = appInTossDemoData.creators.find(
      ({ id: candidate }) => candidate === creatorId,
    );
    if (!creator) {
      throw new CreatorXClientError(
        "NOT_FOUND",
        "크리에이터를 찾을 수 없습니다.",
        false,
        404,
      );
    }
    return creator;
  }

  private enrichPositions(positions: LocalPosition[]) {
    return positions.flatMap((position) => {
      if (position.quantity <= 0) return [];
      const creator = this.requireCreator(position.creatorId);
      return [
        {
          ...position,
          creator: {
            id: creator.id,
            name: creator.name,
            currentPrice: creator.currentPrice,
            thumbnailUrl: creator.thumbnailUrl,
          },
        },
      ];
    });
  }

  private addPosition(
    state: LocalState,
    creator: (typeof appInTossDemoData.creators)[number],
    quantity: number,
    price: number,
  ): void {
    const position = state.positions.find(
      ({ creatorId }) => creatorId === creator.id,
    );
    if (!position) {
      state.positions.push({
        id: `appintoss-position-${creator.id}`,
        creatorId: creator.id,
        quantity,
        avgPrice: price,
      });
      return;
    }

    const currentValue = position.avgPrice * position.quantity;
    const addedValue = price * quantity;
    position.quantity += quantity;
    position.avgPrice = (currentValue + addedValue) / position.quantity;
  }

  private localTradesForCreator(id: string, state: LocalState) {
    return [
      ...state.trades.filter(({ creatorId }) => creatorId === id),
      ...(appInTossDemoData.trades[id] ?? []).map((trade) => ({
        ...trade,
        type: parseRequest(z.enum(["BUY", "SELL"]), trade.type),
      })),
    ].sort(compareNewest);
  }

  private buildOrderBook(id: string, state: LocalState) {
    const orders = [
      ...(appInTossDemoData.orders[id] ?? []),
      ...state.openOrders.filter(
        (order) =>
          order.creatorId === id &&
          (order.status === "OPEN" || order.status === "PARTIAL"),
      ),
    ];
    const asks = new Map<number, number>();
    const bids = new Map<number, number>();

    for (const order of orders) {
      const remaining = order.quantity - order.filled;
      if (remaining <= 0) continue;
      const target = order.type === "SELL" ? asks : bids;
      target.set(order.price, (target.get(order.price) ?? 0) + remaining);
    }

    return {
      asks: [...asks.entries()]
        .map(([price, quantity]) => ({ price, quantity }))
        .sort((left, right) => left.price - right.price),
      bids: [...bids.entries()]
        .map(([price, quantity]) => ({ price, quantity }))
        .sort((left, right) => right.price - left.price),
    };
  }

  private toPublicOrderBook(orderBook: {
    asks: Array<{ price: number; quantity: number }>;
    bids: Array<{ price: number; quantity: number }>;
  }): OrderBook {
    return parseResponse(orderBookSchema, {
      asks: orderBook.asks.map((level) => ({
        price: decimal(level.price),
        quantity: decimal(level.quantity),
      })),
      bids: orderBook.bids.map((level) => ({
        price: decimal(level.price),
        quantity: decimal(level.quantity),
      })),
    });
  }

  private async readState(): Promise<LocalState> {
    let raw: string | null;
    try {
      raw = await this.dependencies.store.getItem(this.stateKey);
    } catch {
      throw storageError();
    }
    if (raw === null) {
      return canonicalizeState(
        parseResponse(localStateSchema, {
          balance: INITIAL_BALANCE,
          positions: [],
          openOrders: [],
          trades: [],
          idempotencyRecords: [],
          usedIds: [],
        }),
      );
    }

    try {
      return canonicalizeState(
        parseResponse(localStateSchema, JSON.parse(raw)),
      );
    } catch {
      throw invalidStateError();
    }
  }

  private async writeState(state: LocalState): Promise<void> {
    const serialized = JSON.stringify(parseResponse(localStateSchema, state));
    try {
      await this.dependencies.store.setItem(this.stateKey, serialized);
    } catch {
      throw storageError();
    }
  }

  private getTimestamp(): string {
    const now = this.now();
    if (!Number.isFinite(now.getTime())) throw invalidStateError();
    return now.toISOString();
  }

  private getId(kind: "order" | "trade"): string {
    const value = parseRequest(identifierSchema, this.idFactory());
    return `appintoss-${kind}-${value}`;
  }
}
