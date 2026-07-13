import { beforeEach, expect, it, vi } from "vitest";

import { GET } from "@/app/api/portfolio/route";

const mocks = vi.hoisted(() => ({
  requirePrincipal: vi.fn(),
  enforcePrincipalRateLimit: vi.fn(),
  getPortfolio: vi.fn(),
}));

vi.mock("@/lib/server/auth/request-auth", () => ({
  requirePrincipal: mocks.requirePrincipal,
}));
vi.mock("@/lib/server/http/creatorx-route", () => ({
  enforcePrincipalRateLimit: mocks.enforcePrincipalRateLimit,
  rateLimitHeaders: () => ({ "RateLimit-Limit": "60" }),
}));
vi.mock("@/lib/server/trading/portfolio-service", () => ({
  getPortfolio: mocks.getPortfolio,
}));

beforeEach(() => {
  mocks.requirePrincipal.mockReset().mockResolvedValue({ userId: "user-1" });
  mocks.enforcePrincipalRateLimit
    .mockReset()
    .mockResolvedValue({ limit: 60, remaining: 59, resetAt: Date.now() + 60_000 });
  mocks.getPortfolio.mockReset().mockResolvedValue({
    balance: "1000.0000",
    reservedBalance: "187.5000",
    availableBalance: "812.5000",
    positions: [
      {
        id: "position-1",
        creatorId: "creator-1",
        quantity: "3.00000000",
        reservedQuantity: "1.00000000",
        avgPrice: "100.0000",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
    ],
    openOrders: [],
    executions: [],
  });
});

it("returns the Task 6 portfolio DTO with reservation fields intact", async () => {
  const response = await GET(new Request("https://creatorx.example/api/portfolio"));

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    reservedBalance: "187.5000",
    positions: [{ reservedQuantity: "1.00000000" }],
  });
  expect(mocks.getPortfolio).toHaveBeenCalledWith({ userId: "user-1" });
});
