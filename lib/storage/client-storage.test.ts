import { describe, expect, it, vi } from "vitest";

import {
  creatorQuerySchema,
  creatorStatSchema,
  creatorSchema,
  creatorSummarySchema,
  creatorVideoSchema,
  orderSchema,
  portfolioSchema,
  tradeSchema,
} from "@/lib/data/contracts";
import { appInTossDemoData } from "@/lib/appintoss-demo-data";
import { createClientStorage } from "@/lib/storage/client-storage";

describe("CreatorX data contracts", () => {
  it("keeps creator summaries distinct from full creator details", () => {
    const summary = {
      id: "creator-summary",
      youtubeChannelId: "UC_summary",
      name: "Summary Creator",
      thumbnailUrl: null,
      category: "Education",
      country: "KR",
      currentSubs: 10_000,
      currentViews: 250_000,
      currentVideos: 42,
      currentScore: 81.5,
      initialPrice: 100,
      currentPrice: 120,
      totalSupply: 1_000_000,
      circulatingSupply: 200_000,
      reserveSupply: 800_000,
      liquidity: 10_000,
      isActive: true,
      visibility: "PUBLIC",
      avgLikes: 1_200,
      avgComments: 80,
      engagementRate: 4.2,
      viewsPerSubs: 25,
      createdAt: "2026-07-01T00:00:00.000Z",
      lastSyncedAt: "2026-07-10T00:00:00.000Z",
      _count: { videos: 42 },
    };

    expect(creatorSummarySchema.safeParse(summary).success).toBe(true);
    expect(creatorSchema.safeParse(summary).success).toBe(false);
  });

  it("validates every bundled creator as a full creator detail", () => {
    expect(() => creatorSchema.array().parse(appInTossDemoData.creators)).not.toThrow();
  });

  it("validates bundled stats, videos, trades, and orders", () => {
    expect(() =>
      creatorStatSchema.array().parse(Object.values(appInTossDemoData.stats).flat()),
    ).not.toThrow();
    expect(() =>
      creatorVideoSchema.array().parse(Object.values(appInTossDemoData.videos).flat()),
    ).not.toThrow();
    expect(() =>
      tradeSchema.array().parse(Object.values(appInTossDemoData.trades).flat()),
    ).not.toThrow();
    expect(() =>
      orderSchema.array().parse(Object.values(appInTossDemoData.orders).flat()),
    ).not.toThrow();
  });

  it("rejects a zero maximum subscriber filter", () => {
    expect(creatorQuerySchema.safeParse({ maxSubs: 0 }).success).toBe(false);
    expect(creatorQuerySchema.safeParse({ maxSubs: 1 }).success).toBe(true);
  });

  it("rejects creator page sizes above the route maximum", () => {
    expect(creatorQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(creatorQuerySchema.safeParse({ limit: 100 }).success).toBe(true);
  });

  it("allows only active order states in a portfolio's open orders", () => {
    const order = {
      id: "order-1",
      creatorId: "creator-1",
      type: "BUY",
      orderType: "LIMIT",
      price: 100,
      quantity: 2,
      filled: 0,
      createdAt: "2026-07-10T00:00:00.000Z",
    };
    const portfolio = {
      balance: 1_000,
      positions: [],
      trades: [],
    };

    for (const status of ["OPEN", "PARTIAL"] as const) {
      expect(
        portfolioSchema.safeParse({
          ...portfolio,
          openOrders: [{ ...order, status }],
        }).success,
      ).toBe(true);
    }

    for (const status of ["FILLED", "CANCELLED"] as const) {
      expect(
        portfolioSchema.safeParse({
          ...portfolio,
          openOrders: [{ ...order, status }],
        }).success,
      ).toBe(false);
    }
  });
});

describe("createClientStorage", () => {
  it("keeps native storage authoritative when getItem returns null", async () => {
    const browser = {
      getItem: vi.fn(() => "browser-value"),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    const native = {
      getItem: vi.fn(async () => null),
      setItem: vi.fn(async () => undefined),
      removeItem: vi.fn(async () => undefined),
    };

    const store = await createClientStorage({
      releaseChannel: "sandbox",
      browser,
      loadNative: async () => native,
    });

    expect(await store.getItem("missing")).toBeNull();
    await store.setItem("key", "value");
    await store.removeItem("key");

    expect(native.setItem).toHaveBeenCalledWith("key", "value");
    expect(native.removeItem).toHaveBeenCalledWith("key");
    expect(browser.getItem).not.toHaveBeenCalled();
    expect(browser.setItem).not.toHaveBeenCalled();
    expect(browser.removeItem).not.toHaveBeenCalled();
  });

  it("selects browser storage only after a nonproduction bridge load failure", async () => {
    const browser = {
      getItem: vi.fn(() => "browser-value"),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    const store = await createClientStorage({
      releaseChannel: "development",
      browser,
      loadNative: async () => {
        throw new Error("bridge missing");
      },
    });

    expect(await store.getItem("key")).toBe("browser-value");
    await store.setItem("key", "next");
    await store.removeItem("key");

    expect(browser.setItem).toHaveBeenCalledWith("key", "next");
    expect(browser.removeItem).toHaveBeenCalledWith("key");
  });

  it("rejects with STORAGE_UNAVAILABLE instead of falling back in production", async () => {
    const browser = {
      getItem: vi.fn(() => "browser-value"),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    await expect(
      createClientStorage({
        releaseChannel: "production",
        browser,
        loadNative: async () => {
          throw new Error("bridge missing");
        },
      }),
    ).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
      retryable: true,
    });

    expect(browser.getItem).not.toHaveBeenCalled();
    expect(browser.setItem).not.toHaveBeenCalled();
    expect(browser.removeItem).not.toHaveBeenCalled();
  });
});
