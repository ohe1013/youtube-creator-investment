import { z } from "zod";

import { appInTossDemoData } from "@/lib/appintoss-demo-data";
import {
  creatorQuerySchema,
  creatorSchema,
  creatorStatSchema,
  creatorSummarySchema,
  creatorVideoSchema,
  dashboardSchema,
  historyPointSchema,
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
import { CreatorXClientError } from "@/lib/data/errors";
import type { AsyncKeyValueStore } from "@/lib/storage/client-storage";

const INITIAL_BALANCE = 100_000;
const STATE_KEY_PREFIX = "creatorx:appintoss:state:";
const ALL_CATEGORY = "전체";

const idSchema = z.string().trim().min(1);
const daysQuerySchema = z.object({ days: z.number().int().positive() }).strict();
const localPositionSchema = z
  .object({
    id: z.string().min(1),
    creatorId: z.string().min(1),
    quantity: z.number().finite().nonnegative(),
    avgPrice: z.number().finite().nonnegative(),
  })
  .strict();
const localOrderSchema = orderSchema
  .omit({ creator: true })
  .extend({
    orderType: z.enum(["LIMIT", "MARKET"]).default("LIMIT"),
    reservedAvgPrice: z.number().finite().nonnegative().optional(),
  })
  .refine(
    (order) =>
      (order.status === "OPEN" || order.status === "PARTIAL") &&
      order.filled <= order.quantity,
    { message: "Persisted open orders must be active with valid fill data" },
  );
const localTradeSchema = tradeSchema.omit({ creator: true }).extend({
  creatorId: z.string().min(1),
  userId: z.string().min(1),
});
const localStateSchema = z
  .object({
    balance: z.number().finite().nonnegative(),
    positions: z.array(localPositionSchema),
    openOrders: z.array(localOrderSchema),
    trades: z.array(localTradeSchema),
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

    const orderIds = new Set<string>();
    for (const order of state.openOrders) {
      if (orderIds.has(order.id)) {
        context.addIssue({
          code: "custom",
          path: ["openOrders"],
          message: "Persisted open-order IDs must be unique",
        });
      }
      orderIds.add(order.id);
    }

    const tradeIds = new Set<string>();
    for (const trade of state.trades) {
      if (tradeIds.has(trade.id)) {
        context.addIssue({
          code: "custom",
          path: ["trades"],
          message: "Persisted trade IDs must be unique",
        });
      }
      tradeIds.add(trade.id);
    }
  });

type LocalState = z.infer<typeof localStateSchema>;
type LocalPosition = z.infer<typeof localPositionSchema>;
type LocalOrder = z.infer<typeof localOrderSchema>;

const mutationQueues = new WeakMap<
  AsyncKeyValueStore,
  Map<string, Promise<void>>
>();

function enqueueMutation<T>(
  store: AsyncKeyValueStore,
  stateKey: string,
  mutation: () => Promise<T>,
): Promise<T> {
  let storeQueues = mutationQueues.get(store);
  if (!storeQueues) {
    storeQueues = new Map();
    mutationQueues.set(store, storeQueues);
  }

  const previous = storeQueues.get(stateKey) ?? Promise.resolve();
  const result = previous.then(mutation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  storeQueues.set(stateKey, tail);
  void tail.then(() => {
    if (storeQueues.get(stateKey) !== tail) return;
    storeQueues.delete(stateKey);
    if (storeQueues.size === 0) mutationQueues.delete(store);
  });
  return result;
}

export type DemoDataClientDependencies = {
  store: AsyncKeyValueStore;
  namespace: string;
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

function cloneCreator(creator: Creator): Creator {
  return parseResponse(creatorSchema, creator);
}

export class DemoDataClient implements CreatorXDataClient {
  private readonly stateKey: string;
  private readonly namespace: string;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(private readonly dependencies: DemoDataClientDependencies) {
    const namespace = parseRequest(idSchema, dependencies.namespace);
    this.namespace = namespace;
    this.stateKey = `${STATE_KEY_PREFIX}${namespace}`;
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
    let creators = parseResponse(
      creatorSummarySchema.array(),
      appInTossDemoData.creators.filter(
        (creator) => creator.isActive && creator.visibility === "PUBLIC",
      ),
    );

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
          difference = right.currentPrice - left.currentPrice;
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
    return cloneCreator(this.requireCreator(id));
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
    const trades = this.tradesForCreator(creator.id, state).reverse();
    const history = trades.map((trade) => ({
      date: trade.createdAt,
      price: trade.price,
      volume: trade.quantity * trade.price,
    }));

    return parseResponse(
      historyPointSchema.array(),
      history.length > 0
        ? history
        : [
            {
              date: appInTossDemoData.generatedAt,
              price: creator.currentPrice,
              volume: 0,
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
      this.tradesForCreator(creator.id, await this.readState()),
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
      this.buildOrderBook(creator.id, await this.readState()),
    );
  }

  async getDashboard(options?: RequestOptions): Promise<Dashboard> {
    this.checkSignal(options);
    const state = await this.readState();
    const creators = parseResponse(
      creatorSummarySchema.array(),
      appInTossDemoData.creators,
    );
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
        totalMarketCap,
        totalVolume24h,
        totalCreators: creators.length,
        activeTraders: 124,
      },
      rankings: creators.slice(0, 10).map((creator) => ({
        id: creator.id,
        name: creator.name,
        thumbnailUrl: creator.thumbnailUrl,
        category: creator.category,
        currentPrice: creator.currentPrice,
        currentScore: creator.currentScore,
        circulatingSupply: creator.circulatingSupply,
        marketCap: creator.currentPrice * creator.circulatingSupply,
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
          currentPrice: creator.currentPrice,
          createdAt: creator.createdAt,
        })),
      user: {
        balance: state.balance,
        portfolioValue,
        totalAssets: state.balance + portfolioValue,
        topHolding: positions[0]?.creator.name ?? null,
      },
    });
  }

  async getPortfolio(options?: RequestOptions): Promise<Portfolio> {
    this.checkSignal(options);
    const state = await this.readState();
    return parseResponse(portfolioSchema, {
      balance: state.balance,
      positions: this.enrichPositions(state.positions),
      openOrders: [...state.openOrders]
        .sort(compareNewest)
        .map((order) => ({
          ...order,
          reservedAvgPrice: undefined,
          creator: this.creatorIdentity(order.creatorId),
        })),
      trades: [...state.trades].sort(compareNewest).map((trade) => ({
        ...trade,
        creator: this.creatorIdentity(trade.creatorId),
      })),
    });
  }

  async placeOrder(
    input: PlaceOrderInput,
    options?: RequestOptions & { idempotencyKey?: string },
  ): Promise<Order> {
    this.checkSignal(options);
    const parsed = parseRequest(placeOrderInputSchema, input);
    const creator = this.requireCreator(parsed.creatorId);
    const total = parsed.price * parsed.quantity;
    if (!Number.isFinite(total)) throw requestError();

    return enqueueMutation(
      this.dependencies.store,
      this.stateKey,
      async () => {
        this.checkSignal(options);
        const state = await this.readState();
        const shouldFill =
          parsed.orderType === "MARKET" ||
          (parsed.side === "BUY" && parsed.price >= creator.currentPrice) ||
          (parsed.side === "SELL" && parsed.price <= creator.currentPrice);
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
          (!position || position.quantity < parsed.quantity)
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
        if (state.openOrders.some(({ id }) => id === orderId)) {
          throw identifierCollisionError();
        }
        const tradeId = shouldFill ? this.getId("trade") : null;
        if (tradeId && state.trades.some(({ id }) => id === tradeId)) {
          throw identifierCollisionError();
        }
        const order: LocalOrder = {
          id: orderId,
          creatorId: creator.id,
          type: parsed.side,
          orderType: parsed.orderType,
          price: parsed.price,
          quantity: parsed.quantity,
          filled: shouldFill ? parsed.quantity : 0,
          status: shouldFill ? "FILLED" : "OPEN",
          createdAt,
          reservedAvgPrice:
            parsed.side === "SELL" && !shouldFill
              ? position?.avgPrice
              : undefined,
        };

        if (parsed.side === "BUY") {
          state.balance -= total;
        } else {
          if (!position) throw invalidStateError();
          position.quantity -= parsed.quantity;
        }

        if (shouldFill) {
          if (!tradeId) throw invalidStateError();
          if (parsed.side === "BUY") {
            this.addPosition(state, creator, parsed.quantity, parsed.price);
          } else {
            state.balance += total;
          }
          state.trades.unshift({
            id: tradeId,
            creatorId: creator.id,
            userId: this.namespace,
            price: parsed.price,
            quantity: parsed.quantity,
            type: parsed.side,
            createdAt,
          });
        } else {
          state.openOrders.unshift(order);
        }

        await this.writeState(state);
        return parseResponse(orderSchema, order);
      },
    );
  }

  async cancelOrder(id: string, options?: RequestOptions): Promise<void> {
    this.checkSignal(options);
    const orderId = parseRequest(idSchema, id);
    await enqueueMutation(
      this.dependencies.store,
      this.stateKey,
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

  private requireCreator(id: string): Creator {
    const creatorId = parseRequest(idSchema, id);
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
    return parseResponse(creatorSchema, creator);
  }

  private creatorIdentity(id: string): { id: string; name: string } {
    const creator = this.requireCreator(id);
    return { id: creator.id, name: creator.name };
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
    creator: Creator,
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

  private tradesForCreator(id: string, state: LocalState): Trade[] {
    return parseResponse(tradeSchema.array(), [
      ...state.trades.filter(({ creatorId }) => creatorId === id),
      ...(appInTossDemoData.trades[id] ?? []),
    ]).sort(compareNewest);
  }

  private buildOrderBook(id: string, state: LocalState): OrderBook {
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

  private async readState(): Promise<LocalState> {
    let raw: string | null;
    try {
      raw = await this.dependencies.store.getItem(this.stateKey);
    } catch {
      throw storageError();
    }
    if (raw === null) {
      return parseResponse(localStateSchema, {
        balance: INITIAL_BALANCE,
        positions: [],
        openOrders: [],
        trades: [],
      });
    }

    try {
      return parseResponse(localStateSchema, JSON.parse(raw));
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
    const value = parseRequest(idSchema, this.idFactory());
    return `appintoss-${kind}-${value}`;
  }
}
