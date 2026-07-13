import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { DELETE as cancelOrderRoute } from "@/app/api/orders/[id]/route";
import { GET as portfolioRoute } from "@/app/api/portfolio/route";
import { POST as placeOrderRoute } from "@/app/api/trade/route";
import { GET as categoriesRoute } from "@/app/api/categories/route";
import { GET as creatorDetailRoute } from "@/app/api/creators/[id]/route";
import { GET as creatorListRoute } from "@/app/api/creators/route";
import { GET as dashboardRoute } from "@/app/api/dashboard/route";
import {
  createGuestSession,
  verifyCreatorXAccessToken,
} from "@/lib/server/auth/guest-session";
import { CREATORX_TOSS_ORIGINS } from "@/lib/server/http/cors";

const prisma = new PrismaClient();
const createdUserIds: string[] = [];
const createdCreatorIds: string[] = [];

async function authenticatedRequest(
  url: string,
  init: RequestInit = {},
): Promise<Request> {
  const tokens = await createGuestSession(`api-contract-${randomUUID()}`);
  const principal = await verifyCreatorXAccessToken(tokens.accessToken);
  createdUserIds.push(principal.userId);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${tokens.accessToken}`);
  return new Request(url, { ...init, headers });
}

async function placeLimitOrder() {
  const request = await authenticatedRequest("https://api.example.test/api/trade", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `place-${randomUUID()}`,
    },
    body: JSON.stringify({
      creatorId: "creatorx-integration-creator",
      side: "BUY",
      orderType: "LIMIT",
      quantity: "1.00000000",
      limitPrice: "100.0000",
    }),
  });
  return await placeOrderRoute(request);
}

afterEach(async () => {
  await prisma.tradeExecution.deleteMany({
    where: {
      OR: [
        { buyerId: { in: createdUserIds } },
        { sellerId: { in: createdUserIds } },
      ],
    },
  });
  await prisma.order.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.position.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.idempotencyRecord.deleteMany({
    where: { userId: { in: createdUserIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.splice(0);
  await prisma.creator.deleteMany({ where: { id: { in: createdCreatorIds } } });
  createdCreatorIds.splice(0);
});

afterAll(() => prisma.$disconnect());

describe.sequential("authoritative CreatorX HTTP contracts", () => {
  it("uses the stable unauthenticated envelope instead of a route-specific raw error", async () => {
    const response = await placeOrderRoute(
      new Request("https://api.example.test/api/trade", { method: "POST" }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: {
        code: "UNAUTHORIZED",
        message: expect.any(String),
        requestId: expect.any(String),
      },
    });
  });

  it("requires an idempotency key and accepts only decimal-string Task 6 orders", async () => {
    const missingKey = await authenticatedRequest("https://api.example.test/api/trade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        creatorId: "creatorx-integration-creator",
        side: "BUY",
        orderType: "LIMIT",
        quantity: "1.00000000",
        limitPrice: "100.0000",
      }),
    });
    const missingKeyResponse = await placeOrderRoute(missingKey);
    expect(missingKeyResponse.status).toBe(400);
    expect(await missingKeyResponse.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_KEY_REQUIRED" },
    });

    const response = await placeLimitOrder();
    expect(response.status).toBe(201);
    expect(response.headers.get("ratelimit-limit")).toBe("10");
    expect(response.headers.get("ratelimit-remaining")).toBe("9");
    expect(response.headers.get("ratelimit-reset")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const body = await response.json();
    expect(body).toMatchObject({
      responseStatus: 201,
      order: {
        orderType: "LIMIT",
        price: "100.0000",
        quantity: "1.00000000",
      },
      portfolio: {
        balance: expect.any(String),
        reservedBalance: expect.any(String),
        availableBalance: expect.any(String),
      },
    });
  });

  it("rejects a client supplied MARKET price with the stable validation envelope", async () => {
    const request = await authenticatedRequest("https://api.example.test/api/trade", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `market-${randomUUID()}`,
      },
      body: JSON.stringify({
        creatorId: "creatorx-integration-creator",
        side: "BUY",
        orderType: "MARKET",
        quantity: "1.00000000",
        price: "100.0000",
      }),
    });

    const response = await placeOrderRoute(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_ORDER_INPUT" },
    });
  });

  it("rejects cross-user cancellation through the service authorization boundary", async () => {
    const placedResponse = await placeLimitOrder();
    expect(placedResponse.status).toBe(201);
    const placed = await placedResponse.json();
    const otherUserRequest = await authenticatedRequest(
      `https://api.example.test/api/orders/${placed.order.id}`,
      {
        method: "DELETE",
        headers: { "idempotency-key": `cancel-${randomUUID()}` },
      },
    );

    const response = await cancelOrderRoute(otherUserRequest, {
      params: Promise.resolve({ id: placed.order.id }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "ORDER_FORBIDDEN", requestId: expect.any(String) },
    });
  });

  it("returns the lossless portfolio DTO with exact CORS headers", async () => {
    const request = await authenticatedRequest("https://api.example.test/api/portfolio", {
      headers: { origin: CREATORX_TOSS_ORIGINS[0] },
    });

    const response = await portfolioRoute(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      CREATORX_TOSS_ORIGINS[0],
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("ratelimit-limit")).toBe("60");
    const body = await response.json();
    expect(body).toMatchObject({
      balance: expect.any(String),
      reservedBalance: expect.any(String),
      availableBalance: expect.any(String),
      positions: expect.any(Array),
      openOrders: expect.any(Array),
      executions: expect.any(Array),
    });
  });

  it("serves each remote public home read through the CORS and decimal boundary", async () => {
    const headers = { origin: CREATORX_TOSS_ORIGINS[0] };
    const categoriesResponse = await categoriesRoute(
      new Request("https://api.example.test/api/categories", { headers }),
    );
    const creatorsResponse = await creatorListRoute(
      new Request("https://api.example.test/api/creators?limit=10", { headers }),
    );
    const dashboardResponse = await dashboardRoute(
      new Request("https://api.example.test/api/dashboard", { headers }),
    );

    for (const response of [
      categoriesResponse,
      creatorsResponse,
      dashboardResponse,
    ]) {
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe(
        CREATORX_TOSS_ORIGINS[0],
      );
    }

    const creators = await creatorsResponse.json();
    const dashboard = await dashboardResponse.json();
    expect(creators.creators[0]).toMatchObject({
      currentPrice: expect.any(String),
      liquidity: expect.any(String),
    });
    expect(dashboard).toMatchObject({
      stats: {
        totalMarketCap: expect.any(String),
        totalVolume24h: expect.any(String),
      },
    });
    expect(dashboard.rankings[0]).toMatchObject({
      currentPrice: expect.any(String),
      circulatingSupply: expect.any(String),
      marketCap: expect.any(String),
    });
  });

  it("uses the CreatorX bearer principal for a remote dashboard user snapshot", async () => {
    const request = await authenticatedRequest(
      "https://api.example.test/api/dashboard",
      { headers: { origin: CREATORX_TOSS_ORIGINS[0] } },
    );

    const response = await dashboardRoute(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user: {
        balance: expect.any(String),
        portfolioValue: expect.any(String),
        totalAssets: expect.any(String),
      },
    });
  });

  it("does not expose hidden or inactive creator detail branches by identifier", async () => {
    const hiddenId = `hidden-${randomUUID()}`;
    const inactiveId = `inactive-${randomUUID()}`;
    createdCreatorIds.push(hiddenId, inactiveId);
    await prisma.creator.createMany({
      data: [
        {
          id: hiddenId,
          youtubeChannelId: `hidden-channel-${randomUUID()}`,
          name: "Hidden Creator",
          visibility: "HIDDEN",
        },
        {
          id: inactiveId,
          youtubeChannelId: `inactive-channel-${randomUUID()}`,
          name: "Inactive Creator",
          isActive: false,
        },
      ],
    });

    for (const id of [hiddenId, inactiveId]) {
      const response = await creatorDetailRoute(
        new Request(`https://api.example.test/api/creators/${id}?videos=true`),
        { params: Promise.resolve({ id }) },
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        error: { code: "CREATOR_NOT_FOUND", requestId: expect.any(String) },
      });
    }
  });
});
