import { Prisma } from "@prisma/client";
import { beforeEach, expect, it, vi } from "vitest";

import { GET } from "@/app/api/portfolio/route";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  findUser: vi.fn(),
  findPositions: vi.fn(),
  findOrders: vi.fn(),
  findTrades: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({ authOptions: {} }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUser },
    position: { findMany: mocks.findPositions },
    order: { findMany: mocks.findOrders },
    legacyTrade: { findMany: mocks.findTrades },
  },
}));

beforeEach(() => {
  mocks.getServerSession.mockReset().mockResolvedValue({
    user: { id: "user-1" },
  });
  mocks.findUser.mockReset().mockResolvedValue({
    balance: new Prisma.Decimal("1000.0000"),
  });
  mocks.findPositions.mockReset().mockResolvedValue([
    {
      id: "position-1",
      userId: "user-1",
      creatorId: "creator-1",
      quantity: new Prisma.Decimal("3.00000000"),
      reservedQuantity: new Prisma.Decimal("1.00000000"),
      avgPrice: new Prisma.Decimal("100.0000"),
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-02T00:00:00.000Z"),
      creator: {
        id: "creator-1",
        name: "Creator One",
        currentPrice: new Prisma.Decimal("125.0000"),
        thumbnailUrl: null,
      },
    },
  ]);
  mocks.findOrders.mockReset().mockResolvedValue([
    {
      id: "order-1",
      userId: "user-1",
      creatorId: "creator-1",
      type: "BUY",
      orderType: "LIMIT",
      price: new Prisma.Decimal("125.0000"),
      quantity: new Prisma.Decimal("2.00000000"),
      filled: new Prisma.Decimal("0.50000000"),
      reservedQuote: new Prisma.Decimal("187.5000"),
      reservedQuantity: new Prisma.Decimal("0.00000000"),
      status: "PARTIAL",
      completedAt: null,
      cancelReason: null,
      createdAt: new Date("2026-07-03T00:00:00.000Z"),
      updatedAt: new Date("2026-07-04T00:00:00.000Z"),
      creator: { id: "creator-1", name: "Creator One" },
    },
  ]);
  mocks.findTrades.mockReset().mockResolvedValue([]);
});

it("keeps internal reservation and completion fields out of the legacy portfolio response", async () => {
  const response = await GET();
  expect(response.status).toBe(200);

  const body = await response.json();
  expect(body.positions[0]).not.toHaveProperty("reservedQuantity");
  expect(body.openOrders[0]).not.toHaveProperty("reservedQuote");
  expect(body.openOrders[0]).not.toHaveProperty("reservedQuantity");
  expect(body.openOrders[0]).not.toHaveProperty("completedAt");
  expect(body.openOrders[0]).not.toHaveProperty("cancelReason");
});
