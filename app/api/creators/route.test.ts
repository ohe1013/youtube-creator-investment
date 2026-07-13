import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

import { GET } from "@/app/api/creators/route";
import { creatorSummarySchema } from "@/lib/data/contracts";

const prismaMocks = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    creator: {
      count: prismaMocks.count,
      findMany: prismaMocks.findMany,
    },
  },
}));

const dbCreator = {
  id: "creator-1",
  youtubeChannelId: "youtube-1",
  name: "Creator One",
  thumbnailUrl: "https://example.com/creator.png",
  category: "Gaming",
  country: "KR",
  currentSubs: 1000,
  currentViews: 2000,
  currentVideos: 30,
  currentScore: 88,
  initialPrice: 100,
  currentPrice: 125,
  totalSupply: new Prisma.Decimal("1000000.00000000"),
  circulatingSupply: new Prisma.Decimal("200000.00000000"),
  reserveSupply: new Prisma.Decimal("800000.00000000"),
  liquidity: 10_000,
  isActive: true,
  visibility: "PUBLIC",
  avgLikes: 10,
  avgComments: 2,
  engagementRate: 1.2,
  viewsPerSubs: 2,
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  lastSyncedAt: new Date("2026-07-10T00:00:00.000Z"),
  _count: { videos: 30 },
};

beforeEach(() => {
  prismaMocks.findMany.mockReset().mockResolvedValue([dbCreator]);
  prismaMocks.count.mockReset().mockResolvedValue(1);
});

it("returns exact CreatorSummary JSON including ISO timestamps and video count", async () => {
  const response = await GET(
    new NextRequest("https://creatorx.example/api/creators?sort=subs&limit=50"),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(creatorSummarySchema.parse(body.creators[0])).toEqual({
    ...dbCreator,
    totalSupply: 1_000_000,
    circulatingSupply: 200_000,
    reserveSupply: 800_000,
    createdAt: "2026-07-01T00:00:00.000Z",
    lastSyncedAt: "2026-07-10T00:00:00.000Z",
  });
  expect(prismaMocks.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      select: expect.objectContaining({
        initialPrice: true,
        totalSupply: true,
        reserveSupply: true,
        _count: { select: { videos: true } },
      }),
    }),
  );
});
