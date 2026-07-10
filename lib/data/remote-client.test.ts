import { describe, expect, it, vi } from "vitest";

import { appInTossDemoData } from "@/lib/appintoss-demo-data";
import {
  orderSchema,
  type PlaceOrderInput,
  type RequestOptions,
} from "@/lib/data/contracts";
import { DemoDataClient } from "@/lib/data/demo-client";
import { CreatorXClientError } from "@/lib/data/errors";
import { RemoteDataClient } from "@/lib/data/remote-client";
import type { AsyncKeyValueStore } from "@/lib/storage/client-storage";

const API_BASE_URL = new URL("https://api.example.com/base/ignored");
const CREATOR_ID = appInTossDemoData.creators[0].id;
const ORDER_INPUT: PlaceOrderInput = {
  creatorId: CREATOR_ID,
  side: "BUY",
  orderType: "LIMIT",
  price: 1_200,
  quantity: 2,
};

function createFetchMock() {
  return vi.fn<typeof fetch>();
}

function createMemoryStore(): AsyncKeyValueStore {
  const values = new Map<string, string>();
  return {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
  };
}

async function createWireFixtures() {
  const demo = new DemoDataClient({
    store: createMemoryStore(),
    namespace: "remote-client-fixtures",
    now: () => new Date("2026-07-10T00:00:00.000Z"),
    idFactory: () => "fixture-order-id",
  });

  return {
    categories: await demo.listCategories(),
    creators: await demo.listCreators({ page: 1, limit: 10 }),
    creator: await demo.getCreator(CREATOR_ID),
    stats: await demo.getCreatorStats(CREATOR_ID, { days: 30 }),
    videos: await demo.getCreatorVideos(CREATOR_ID),
    history: await demo.getCreatorHistory(CREATOR_ID, { days: 7 }),
    trades: await demo.getCreatorTrades(CREATOR_ID),
    orderBook: await demo.getOrderBook(CREATOR_ID),
    dashboard: await demo.getDashboard(),
    portfolio: await demo.getPortfolio(),
    order: orderSchema.parse(appInTossDemoData.orders[CREATOR_ID][0]),
  };
}

async function captureClientError(
  promise: Promise<unknown>,
): Promise<CreatorXClientError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CreatorXClientError);
    return error as CreatorXClientError;
  }
  throw new Error("Expected CreatorXClientError");
}

describe("RemoteDataClient", () => {
  it("constructs the encoded URL and query for every read method and unwraps current envelopes", async () => {
    const fixture = await createWireFixtures();
    const fetchFn = createFetchMock();
    const signal = new AbortController().signal;
    const options: RequestOptions = { signal };
    const encodedId = "creator%2Fa%20b";

    fetchFn
      .mockResolvedValueOnce(Response.json({ categories: fixture.categories }))
      .mockResolvedValueOnce(Response.json(fixture.creators))
      .mockResolvedValueOnce(Response.json({ creator: fixture.creator }))
      .mockResolvedValueOnce(Response.json({ stats: fixture.stats }))
      .mockResolvedValueOnce(Response.json({ videos: fixture.videos }))
      .mockResolvedValueOnce(Response.json({ history: fixture.history }))
      .mockResolvedValueOnce(Response.json({ trades: fixture.trades }))
      .mockResolvedValueOnce(Response.json(fixture.orderBook))
      .mockResolvedValueOnce(Response.json(fixture.dashboard))
      .mockResolvedValueOnce(Response.json(fixture.portfolio));

    const client = new RemoteDataClient({ baseUrl: API_BASE_URL, fetchFn });

    await expect(client.listCategories(options)).resolves.toEqual(
      fixture.categories,
    );
    await expect(
      client.listCreators(
        {
          category: "K-POP & Dance",
          minSubs: 1_000,
          maxSubs: 2_000,
          sort: "growth",
          page: 2,
          limit: 10,
        },
        options,
      ),
    ).resolves.toEqual(fixture.creators);
    await expect(client.getCreator("creator/a b", options)).resolves.toEqual(
      fixture.creator,
    );
    await expect(
      client.getCreatorStats("creator/a b", { days: 30 }, options),
    ).resolves.toEqual(fixture.stats);
    await expect(
      client.getCreatorVideos("creator/a b", options),
    ).resolves.toEqual(fixture.videos);
    await expect(
      client.getCreatorHistory("creator/a b", { days: 7 }, options),
    ).resolves.toEqual(fixture.history);
    await expect(
      client.getCreatorTrades("creator/a b", options),
    ).resolves.toEqual(fixture.trades);
    await expect(
      client.getOrderBook("creator/a b", options),
    ).resolves.toEqual(fixture.orderBook);
    await expect(client.getDashboard(options)).resolves.toEqual(
      fixture.dashboard,
    );
    await expect(client.getPortfolio(options)).resolves.toEqual(
      fixture.portfolio,
    );

    const expectedUrls = [
      "https://api.example.com/api/categories",
      "https://api.example.com/api/creators?category=K-POP+%26+Dance&minSubs=1000&maxSubs=2000&sort=growth&page=2&limit=10",
      `https://api.example.com/api/creators/${encodedId}`,
      `https://api.example.com/api/creators/${encodedId}?stats=true&days=30`,
      `https://api.example.com/api/creators/${encodedId}?videos=true`,
      `https://api.example.com/api/creators/${encodedId}?history=true&days=7`,
      `https://api.example.com/api/creators/${encodedId}?trades=true`,
      `https://api.example.com/api/creators/${encodedId}?orderbook=true`,
      "https://api.example.com/api/dashboard",
      "https://api.example.com/api/portfolio",
    ];

    expectedUrls.forEach((url, index) => {
      expect(fetchFn).toHaveBeenNthCalledWith(
        index + 1,
        url,
        expect.objectContaining({
          method: "GET",
          credentials: "include",
          signal,
        }),
      );
    });
  });

  it.each([502, 503, 504])(
    "retries transient GET status %i within the configured bound",
    async (status) => {
      const fetchFn = createFetchMock()
        .mockResolvedValueOnce(new Response("unavailable", { status }))
        .mockResolvedValueOnce(
          Response.json({ categories: ["전체", "K-POP"] }),
        );
      const client = new RemoteDataClient({
        baseUrl: API_BASE_URL,
        fetchFn,
        maxGetAttempts: 2,
      });

      await expect(client.listCategories()).resolves.toEqual([
        "전체",
        "K-POP",
      ]);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    },
  );

  it("retries a fetch-level GET rejection but normalizes exhausted attempts", async () => {
    const succeedingFetch = createFetchMock()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(Response.json({ categories: ["전체"] }));
    const successfulClient = new RemoteDataClient({
      baseUrl: API_BASE_URL,
      fetchFn: succeedingFetch,
      maxGetAttempts: 2,
    });

    await expect(successfulClient.listCategories()).resolves.toEqual(["전체"]);
    expect(succeedingFetch).toHaveBeenCalledTimes(2);

    const failingFetch = createFetchMock().mockRejectedValue(
      new TypeError("offline"),
    );
    const failingClient = new RemoteDataClient({
      baseUrl: API_BASE_URL,
      fetchFn: failingFetch,
      maxGetAttempts: 2,
    });

    await expect(failingClient.listCategories()).rejects.toMatchObject({
      code: "NETWORK_UNAVAILABLE",
      retryable: true,
    });
    expect(failingFetch).toHaveBeenCalledTimes(2);
  });

  it("normalizes exhausted transient GET responses as network unavailable", async () => {
    const fetchFn = createFetchMock().mockResolvedValue(
      new Response("unavailable", { status: 503 }),
    );
    const client = new RemoteDataClient({
      baseUrl: API_BASE_URL,
      fetchFn,
      maxGetAttempts: 2,
    });

    await expect(client.listCategories()).rejects.toMatchObject({
      code: "NETWORK_UNAVAILABLE",
      retryable: true,
      status: 503,
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it.each([
    [400, "REQUEST_REJECTED"],
    [401, "UNAUTHORIZED"],
    [404, "NOT_FOUND"],
  ] as const)(
    "does not retry HTTP %i and maps it to %s",
    async (status, code) => {
      const fetchFn = createFetchMock().mockResolvedValue(
        Response.json({ error: "request failed" }, { status }),
      );
      const client = new RemoteDataClient({
        baseUrl: API_BASE_URL,
        fetchFn,
        maxGetAttempts: 3,
      });

      await expect(client.listCategories()).rejects.toMatchObject({
        code,
        status,
      });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    },
  );

  it("never retries an abort or an existing CreatorXClientError", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const abortFetch = createFetchMock().mockRejectedValue(abortError);
    const abortClient = new RemoteDataClient({
      baseUrl: API_BASE_URL,
      fetchFn: abortFetch,
      maxGetAttempts: 3,
    });

    await expect(abortClient.listCategories()).rejects.toBe(abortError);
    expect(abortFetch).toHaveBeenCalledTimes(1);

    const clientError = new CreatorXClientError(
      "SESSION_UNAVAILABLE",
      "session unavailable",
      true,
    );
    const clientErrorFetch = createFetchMock().mockRejectedValue(clientError);
    const client = new RemoteDataClient({
      baseUrl: API_BASE_URL,
      fetchFn: clientErrorFetch,
      maxGetAttempts: 3,
    });

    await expect(client.listCategories()).rejects.toBe(clientError);
    expect(clientErrorFetch).toHaveBeenCalledTimes(1);
  });

  it("short-circuits a pre-aborted request before auth or fetch", async () => {
    const controller = new AbortController();
    controller.abort();
    const getAccessToken = vi.fn(async () => "must-not-load");
    const fetchFn = createFetchMock();
    const client = new RemoteDataClient({
      baseUrl: API_BASE_URL,
      fetchFn,
      getAccessToken,
    });

    const error = await client
      .listCategories({ signal: controller.signal })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("AbortError");
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("normalizes access-token loader rejection without exposing its message", async () => {
    const secret = "token-provider-secret:refresh-token";
    const getAccessToken = vi.fn().mockRejectedValue(new Error(secret));
    const fetchFn = createFetchMock();
    const client = new RemoteDataClient({
      baseUrl: API_BASE_URL,
      fetchFn,
      getAccessToken,
    });

    const error = await captureClientError(client.listCategories());

    expect(error).toMatchObject({
      code: "SESSION_UNAVAILABLE",
      retryable: true,
    });
    expect(`${error.message}:${error.userMessage}:${JSON.stringify(error)}`).not.toContain(
      secret,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([200, 400])(
    "preserves AbortError while reading an HTTP %i response body",
    async (status) => {
      const abortError = new DOMException("body-read-aborted", "AbortError");
      const response = new Response(null, { status });
      vi.spyOn(response, "json").mockRejectedValue(abortError);
      const fetchFn = createFetchMock().mockResolvedValue(response);
      const client = new RemoteDataClient({ baseUrl: API_BASE_URL, fetchFn });

      await expect(client.listCategories()).rejects.toBe(abortError);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["creator", "."],
    ["creator", ".."],
    ["cancel", "."],
    ["cancel", ".."],
  ] as const)(
    "rejects the %s dot-segment id %s before auth or fetch",
    async (operation, id) => {
      const getAccessToken = vi.fn(async () => "must-not-load");
      const fetchFn = createFetchMock();
      const client = new RemoteDataClient({
        baseUrl: API_BASE_URL,
        fetchFn,
        getAccessToken,
      });
      const request =
        operation === "creator"
          ? client.getCreator(` ${id} `)
          : client.cancelOrder(` ${id} `);

      await expect(request).rejects.toMatchObject({
        code: "REQUEST_REJECTED",
      });
      expect(getAccessToken).not.toHaveBeenCalled();
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );

  it("sends credentials, a non-null bearer, JSON, the signal, and the caller idempotency key", async () => {
    const fixture = await createWireFixtures();
    const fetchFn = createFetchMock().mockResolvedValue(
      Response.json({ order: fixture.order }),
    );
    const getAccessToken = vi.fn().mockResolvedValue("access-token");
    const signal = new AbortController().signal;
    const client = new RemoteDataClient({
      baseUrl: API_BASE_URL,
      fetchFn,
      getAccessToken,
    });

    await expect(
      client.placeOrder(ORDER_INPUT, {
        signal,
        idempotencyKey: "caller-key-123",
      }),
    ).resolves.toEqual(fixture.order);

    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.example.com/api/trade",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        signal,
        body: JSON.stringify(ORDER_INPUT),
      }),
    );
    const request = fetchFn.mock.calls[0][1];
    const headers = new Headers(request?.headers);
    expect(headers.get("Authorization")).toBe("Bearer access-token");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Idempotency-Key")).toBe("caller-key-123");
  });

  it("omits authorization for a null token and accepts a direct order response", async () => {
    const fixture = await createWireFixtures();
    const fetchFn = createFetchMock().mockResolvedValue(
      Response.json(fixture.order),
    );
    const client = new RemoteDataClient({
      baseUrl: API_BASE_URL,
      fetchFn,
      getAccessToken: async () => null,
    });

    await expect(client.placeOrder(ORDER_INPUT)).resolves.toEqual(
      fixture.order,
    );
    const headers = new Headers(fetchFn.mock.calls[0][1]?.headers);
    expect(headers.has("Authorization")).toBe(false);
    expect(headers.has("Idempotency-Key")).toBe(false);
  });

  it("forwards an explicitly supplied idempotency key without rewriting it", async () => {
    const fixture = await createWireFixtures();
    const fetchFn = createFetchMock().mockResolvedValue(
      Response.json(fixture.order),
    );
    const client = new RemoteDataClient({ baseUrl: API_BASE_URL, fetchFn });

    await client.placeOrder(ORDER_INPUT, { idempotencyKey: "" });

    const headers = new Headers(fetchFn.mock.calls[0][1]?.headers);
    expect(headers.has("Idempotency-Key")).toBe(true);
    expect(headers.get("Idempotency-Key")).toBe("");
  });

  it("never retries POST or DELETE", async () => {
    const postFetch = createFetchMock().mockResolvedValue(
      new Response("unavailable", { status: 503 }),
    );
    const postClient = new RemoteDataClient({
      baseUrl: API_BASE_URL,
      fetchFn: postFetch,
      maxGetAttempts: 3,
    });

    await expect(postClient.placeOrder(ORDER_INPUT)).rejects.toMatchObject({
      code: "REQUEST_REJECTED",
      status: 503,
    });
    expect(postFetch).toHaveBeenCalledTimes(1);

    const deleteFetch = createFetchMock().mockRejectedValue(
      new TypeError("offline"),
    );
    const deleteClient = new RemoteDataClient({
      baseUrl: API_BASE_URL,
      fetchFn: deleteFetch,
      maxGetAttempts: 3,
    });

    await expect(deleteClient.cancelOrder("order/a b")).rejects.toMatchObject({
      code: "NETWORK_UNAVAILABLE",
    });
    expect(deleteFetch).toHaveBeenCalledTimes(1);
    expect(deleteFetch.mock.calls[0][0]).toBe(
      "https://api.example.com/api/orders/order%2Fa%20b",
    );
  });

  it("accepts both 204 and JSON cancellation responses", async () => {
    const fetchFn = createFetchMock()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ success: true }));
    const client = new RemoteDataClient({ baseUrl: API_BASE_URL, fetchFn });

    await expect(client.cancelOrder("order-1")).resolves.toBeUndefined();
    await expect(client.cancelOrder("order-2")).resolves.toBeUndefined();
  });

  it.each([
    new Response("not-json", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
    Response.json({ categories: [42] }),
  ])("maps malformed success JSON or schema data to INVALID_RESPONSE", async (response) => {
    const fetchFn = createFetchMock().mockResolvedValue(response);
    const client = new RemoteDataClient({ baseUrl: API_BASE_URL, fetchFn });

    await expect(client.listCategories()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      retryable: false,
    });
  });

  it("preserves only recognized domain codes with client-owned safe messages", async () => {
    const flatSecret = "flat-secret:database-row";
    const nestedSecret = "nested-secret:order-owner";
    const unknownSecret = "unknown-secret:stack-trace";
    const flatUnknownSecret = "flat-unknown-secret:sql-detail";
    const fetchFn = createFetchMock()
      .mockResolvedValueOnce(
        Response.json(
          {
            error: flatSecret,
            code: "INSUFFICIENT_BALANCE",
            retryable: true,
          },
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "ORDER_NOT_FOUND",
              message: nestedSecret,
              requestId: "request-1",
            },
          },
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "INTERNAL_DATABASE_DETAIL",
              message: unknownSecret,
              requestId: "request-2",
            },
          },
          { status: 500 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          { error: flatUnknownSecret, retryable: true },
          { status: 418 },
        ),
      );
    const client = new RemoteDataClient({ baseUrl: API_BASE_URL, fetchFn });

    const balanceError = await captureClientError(
      client.placeOrder(ORDER_INPUT),
    );
    expect(balanceError).toMatchObject({
      code: "INSUFFICIENT_BALANCE",
      userMessage: "잔액이 부족합니다.",
      retryable: false,
    });
    const orderError = await captureClientError(
      client.cancelOrder("missing-order"),
    );
    expect(orderError).toMatchObject({
      code: "ORDER_NOT_FOUND",
      userMessage: "주문을 찾을 수 없습니다.",
      retryable: false,
    });
    const unknownError = await captureClientError(client.getPortfolio());
    expect(unknownError).toMatchObject({
      code: "REQUEST_REJECTED",
      userMessage: "요청을 처리할 수 없습니다.",
      retryable: false,
    });
    const flatUnknownError = await captureClientError(client.getDashboard());
    expect(flatUnknownError).toMatchObject({
      code: "REQUEST_REJECTED",
      userMessage: "요청을 처리할 수 없습니다.",
      retryable: false,
    });

    const exposed = [
      balanceError,
      orderError,
      unknownError,
      flatUnknownError,
    ]
      .flatMap((error) => [error.message, error.userMessage, JSON.stringify(error)])
      .join(":");
    expect(exposed).not.toContain(flatSecret);
    expect(exposed).not.toContain(nestedSecret);
    expect(exposed).not.toContain(unknownSecret);
    expect(exposed).not.toContain(flatUnknownSecret);
  });

  it.each([
    [401, "UNAUTHORIZED", "로그인이 필요합니다."],
    [404, "NOT_FOUND", "요청한 정보를 찾을 수 없습니다."],
  ] as const)(
    "uses a client-owned message for HTTP %i regardless of backend text",
    async (status, code, userMessage) => {
      const secret = `backend-status-secret-${status}`;
      const fetchFn = createFetchMock().mockResolvedValue(
        Response.json({ error: secret, retryable: true }, { status }),
      );
      const client = new RemoteDataClient({ baseUrl: API_BASE_URL, fetchFn });

      const error = await captureClientError(client.getPortfolio());

      expect(error).toMatchObject({ code, userMessage, retryable: false });
      expect(`${error.message}:${JSON.stringify(error)}`).not.toContain(secret);
    },
  );

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN])(
    "rejects invalid maxGetAttempts value %s",
    (maxGetAttempts) => {
      expect(
        () => new RemoteDataClient({ baseUrl: API_BASE_URL, maxGetAttempts }),
      ).toThrowError(
        expect.objectContaining<Partial<CreatorXClientError>>({
          code: "CONFIG_INVALID",
        }),
      );
    },
  );
});
