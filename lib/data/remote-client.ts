import { z } from "zod";

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
import {
  CreatorXClientError,
  type CreatorXErrorCode,
} from "@/lib/data/errors";

const daysQuerySchema = z.object({ days: z.number().int().positive() }).strict();
const categoriesEnvelopeSchema = z
  .object({ categories: z.array(z.string().min(1)) })
  .transform(({ categories }) => categories);
const creatorEnvelopeSchema = z
  .object({ creator: creatorSchema })
  .transform(({ creator }) => creator);
const statsEnvelopeSchema = z
  .object({ stats: z.array(creatorStatSchema) })
  .transform(({ stats }) => stats);
const videosEnvelopeSchema = z
  .object({ videos: z.array(creatorVideoSchema) })
  .transform(({ videos }) => videos);
const historyEnvelopeSchema = z
  .object({ history: z.array(historyPointSchema) })
  .transform(({ history }) => history);
const tradesEnvelopeSchema = z
  .object({ trades: z.array(tradeSchema) })
  .transform(({ trades }) => trades);
const orderResponseSchema = z
  .union([orderSchema, z.object({ order: orderSchema })])
  .transform((value) => ("order" in value ? value.order : value));

const flatErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  retryable: z.boolean().optional(),
});
const nestedErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

const domainErrorCodes = new Set<CreatorXErrorCode>([
  "INSUFFICIENT_BALANCE",
  "INSUFFICIENT_SHARES",
  "ORDER_NOT_FOUND",
]);
const transientGetStatuses = new Set([502, 503, 504]);

export type RemoteDataClientOptions = {
  baseUrl: URL;
  fetchFn?: typeof fetch;
  getAccessToken?: () => Promise<string | null>;
  refreshAccessToken?: (failedAccessToken: string) => Promise<string | null>;
  maxGetAttempts?: number;
};

type RequestParameters = {
  method: "GET" | "POST" | "DELETE";
  signal?: AbortSignal;
  headers?: HeadersInit;
  body?: BodyInit;
  allowNoContent?: boolean;
};

function requestRejectedError(): CreatorXClientError {
  return new CreatorXClientError(
    "REQUEST_REJECTED",
    "요청 값이 올바르지 않습니다.",
    false,
    400,
  );
}

function invalidResponseError(): CreatorXClientError {
  return new CreatorXClientError(
    "INVALID_RESPONSE",
    "서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    false,
  );
}

function networkUnavailableError(status?: number): CreatorXClientError {
  return new CreatorXClientError(
    "NETWORK_UNAVAILABLE",
    "네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
    true,
    status,
  );
}

function sessionUnavailableError(): CreatorXClientError {
  return new CreatorXClientError(
    "SESSION_UNAVAILABLE",
    "로그인 정보를 확인할 수 없습니다. 다시 시도해 주세요.",
    true,
  );
}

function configurationError(): CreatorXClientError {
  return new CreatorXClientError(
    "CONFIG_INVALID",
    "A root HTTPS CreatorX API origin is required.",
    false,
  );
}

function assertRootHttpsOrigin(value: URL): URL {
  const url = new URL(value.toString());
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw configurationError();
  }
  return url;
}

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function parseRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw requestRejectedError();
  return parsed.data;
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (isAbortError(signal.reason)) throw signal.reason;
  throw abortError();
}

function preserveAbort(
  error: unknown,
  signal: AbortSignal | undefined,
): void {
  throwIfAborted(signal);
  if (isAbortError(error)) throw error;
}

function asRecognizedDomainCode(
  value: string | undefined,
): CreatorXErrorCode | null {
  if (!value || !domainErrorCodes.has(value as CreatorXErrorCode)) return null;
  return value as CreatorXErrorCode;
}

function domainError(
  code: CreatorXErrorCode,
  status: number,
): CreatorXClientError {
  switch (code) {
    case "INSUFFICIENT_BALANCE":
      return new CreatorXClientError(
        code,
        "잔액이 부족합니다.",
        false,
        status,
      );
    case "INSUFFICIENT_SHARES":
      return new CreatorXClientError(
        code,
        "보유 수량이 부족합니다.",
        false,
        status,
      );
    case "ORDER_NOT_FOUND":
      return new CreatorXClientError(
        code,
        "주문을 찾을 수 없습니다.",
        false,
        status,
      );
    default:
      return new CreatorXClientError(
        "REQUEST_REJECTED",
        "요청을 처리할 수 없습니다.",
        false,
        status,
      );
  }
}

async function toHttpError(
  response: Response,
  signal: AbortSignal | undefined,
): Promise<CreatorXClientError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch (error) {
    preserveAbort(error, signal);
    // Non-JSON error responses still have a stable HTTP-derived client error.
  }
  throwIfAborted(signal);

  const flat = flatErrorSchema.safeParse(body);
  const nested = nestedErrorSchema.safeParse(body);

  if (response.status === 401) {
    return new CreatorXClientError(
      "UNAUTHORIZED",
      "로그인이 필요합니다.",
      false,
      response.status,
    );
  }
  if (response.status === 404) {
    return new CreatorXClientError(
      "NOT_FOUND",
      "요청한 정보를 찾을 수 없습니다.",
      false,
      response.status,
    );
  }

  const domainCode = asRecognizedDomainCode(
    flat.success ? flat.data.code : nested.success ? nested.data.error.code : undefined,
  );
  if (domainCode) return domainError(domainCode, response.status);

  return new CreatorXClientError(
    "REQUEST_REJECTED",
    "요청을 처리할 수 없습니다.",
    false,
    response.status,
  );
}

export class RemoteDataClient implements CreatorXDataClient {
  private readonly baseUrl: URL;
  private readonly fetchFn: typeof fetch;
  private readonly getAccessToken: (() => Promise<string | null>) | undefined;
  private readonly refreshAccessToken:
    | ((failedAccessToken: string) => Promise<string | null>)
    | undefined;
  private readonly maxGetAttempts: number;

  constructor(options: RemoteDataClientOptions) {
    const maxGetAttempts = options.maxGetAttempts ?? 2;
    if (
      !Number.isFinite(maxGetAttempts) ||
      !Number.isInteger(maxGetAttempts) ||
      maxGetAttempts <= 0
    ) {
      throw new CreatorXClientError(
        "CONFIG_INVALID",
        "GET 재시도 횟수는 1 이상의 정수여야 합니다.",
        false,
      );
    }

    this.baseUrl = assertRootHttpsOrigin(options.baseUrl);
    this.fetchFn = options.fetchFn ?? fetch;
    this.getAccessToken = options.getAccessToken;
    this.refreshAccessToken = options.refreshAccessToken;
    this.maxGetAttempts = maxGetAttempts;
  }

  async listCategories(options: RequestOptions = {}): Promise<string[]> {
    return await this.request(categoriesEnvelopeSchema, "/api/categories", {
      method: "GET",
      signal: options.signal,
    });
  }

  async listCreators(
    query: CreatorQuery,
    options: RequestOptions = {},
  ): Promise<PaginatedCreators> {
    const value = parseRequest(creatorQuerySchema, query);
    const search = new URLSearchParams();
    if (value.category !== undefined) search.set("category", value.category);
    if (value.minSubs !== undefined) search.set("minSubs", String(value.minSubs));
    if (value.maxSubs !== undefined) search.set("maxSubs", String(value.maxSubs));
    if (value.sort !== undefined) search.set("sort", value.sort);
    if (value.page !== undefined) search.set("page", String(value.page));
    if (value.limit !== undefined) search.set("limit", String(value.limit));

    return await this.request(
      paginatedCreatorsSchema,
      this.withSearch("/api/creators", search),
      { method: "GET", signal: options.signal },
    );
  }

  async getCreator(id: string, options: RequestOptions = {}): Promise<Creator> {
    return await this.request(creatorEnvelopeSchema, this.creatorPath(id), {
      method: "GET",
      signal: options.signal,
    });
  }

  async getCreatorStats(
    id: string,
    query: { days: number },
    options: RequestOptions = {},
  ): Promise<CreatorStat[]> {
    const value = parseRequest(daysQuerySchema, query);
    return await this.request(
      statsEnvelopeSchema,
      this.creatorPath(id, { stats: "true", days: String(value.days) }),
      { method: "GET", signal: options.signal },
    );
  }

  async getCreatorVideos(
    id: string,
    options: RequestOptions = {},
  ): Promise<CreatorVideo[]> {
    return await this.request(
      videosEnvelopeSchema,
      this.creatorPath(id, { videos: "true" }),
      { method: "GET", signal: options.signal },
    );
  }

  async getCreatorHistory(
    id: string,
    query: { days: number },
    options: RequestOptions = {},
  ): Promise<HistoryPoint[]> {
    const value = parseRequest(daysQuerySchema, query);
    return await this.request(
      historyEnvelopeSchema,
      this.creatorPath(id, { history: "true", days: String(value.days) }),
      { method: "GET", signal: options.signal },
    );
  }

  async getCreatorTrades(
    id: string,
    options: RequestOptions = {},
  ): Promise<Trade[]> {
    return await this.request(
      tradesEnvelopeSchema,
      this.creatorPath(id, { trades: "true" }),
      { method: "GET", signal: options.signal },
    );
  }

  async getOrderBook(
    id: string,
    options: RequestOptions = {},
  ): Promise<OrderBook> {
    return await this.request(
      orderBookSchema,
      this.creatorPath(id, { orderbook: "true" }),
      { method: "GET", signal: options.signal },
    );
  }

  async getDashboard(options: RequestOptions = {}): Promise<Dashboard> {
    return await this.request(dashboardSchema, "/api/dashboard", {
      method: "GET",
      signal: options.signal,
    });
  }

  async getPortfolio(options: RequestOptions = {}): Promise<Portfolio> {
    return await this.request(portfolioSchema, "/api/portfolio", {
      method: "GET",
      signal: options.signal,
    });
  }

  async placeOrder(
    input: PlaceOrderInput,
    options: RequestOptions & { idempotencyKey?: string } = {},
  ): Promise<Order> {
    const value = parseRequest(placeOrderInputSchema, input);
    return await this.request(orderResponseSchema, "/api/trade", {
      method: "POST",
      signal: options.signal,
      headers: options.idempotencyKey !== undefined
        ? { "Idempotency-Key": options.idempotencyKey }
        : undefined,
      body: JSON.stringify(value),
    });
  }

  async cancelOrder(
    id: string,
    options: RequestOptions & { idempotencyKey?: string } = {},
  ): Promise<void> {
    await this.request(z.unknown(), `/api/orders/${this.encodedId(id)}`, {
      method: "DELETE",
      signal: options.signal,
      headers: options.idempotencyKey === undefined
        ? undefined
        : { "Idempotency-Key": options.idempotencyKey },
      allowNoContent: true,
    });
  }

  private encodedId(id: string): string {
    return encodeURIComponent(parseRequest(identifierSchema, id));
  }

  private creatorPath(
    id: string,
    query?: Record<string, string>,
  ): string {
    const path = `/api/creators/${this.encodedId(id)}`;
    return query ? this.withSearch(path, new URLSearchParams(query)) : path;
  }

  private withSearch(path: string, search: URLSearchParams): string {
    const value = search.toString();
    return value ? `${path}?${value}` : path;
  }

  private async request<T>(
    schema: z.ZodType<T>,
    path: string,
    parameters: RequestParameters,
  ): Promise<T> {
    throwIfAborted(parameters.signal);
    let token: string | null = null;
    if (this.getAccessToken) {
      try {
        token = await this.getAccessToken();
      } catch (error) {
        preserveAbort(error, parameters.signal);
        throw sessionUnavailableError();
      }
    }
    throwIfAborted(parameters.signal);
    const baseHeaders = new Headers(parameters.headers);
    if (parameters.method === "POST") {
      baseHeaders.set("Content-Type", "application/json");
    }

    const url = new URL(path, this.baseUrl).toString();
    const maxTransportAttempts = parameters.method === "GET" ? this.maxGetAttempts : 1;
    let transportAttempt = 1;
    let refreshed = false;
    for (;;) {
      const headers = new Headers(baseHeaders);
      if (token !== null) headers.set("Authorization", `Bearer ${token}`);
      let response: Response;
      try {
        response = await this.fetchFn(url, {
          method: parameters.method,
          headers,
          body: parameters.body,
          credentials: "same-origin",
          signal: parameters.signal,
        });
      } catch (error) {
        preserveAbort(error, parameters.signal);
        if (error instanceof CreatorXClientError) throw error;
        if (
          parameters.method === "GET" &&
          transportAttempt < maxTransportAttempts
        ) {
          transportAttempt += 1;
          continue;
        }
        throw networkUnavailableError();
      }

      if (!response.ok) {
        if (
          response.status === 401 &&
          parameters.method === "GET" &&
          token !== null &&
          !refreshed &&
          this.refreshAccessToken
        ) {
          refreshed = true;
          try {
            const refreshedToken = await this.refreshAccessToken(token);
            throwIfAborted(parameters.signal);
            if (refreshedToken === null) throw sessionUnavailableError();
            token = refreshedToken;
            continue;
          } catch (error) {
            preserveAbort(error, parameters.signal);
            if (error instanceof CreatorXClientError) throw error;
            throw sessionUnavailableError();
          }
        }
        if (
          parameters.method === "GET" &&
          transientGetStatuses.has(response.status)
        ) {
          if (transportAttempt < maxTransportAttempts) {
            transportAttempt += 1;
            continue;
          }
          throw networkUnavailableError(response.status);
        }
        throw await toHttpError(response, parameters.signal);
      }

      if (parameters.allowNoContent && response.status === 204) {
        return undefined as T;
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        preserveAbort(error, parameters.signal);
        throw invalidResponseError();
      }
      throwIfAborted(parameters.signal);
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw invalidResponseError();
      return parsed.data;
    }
  }
}
