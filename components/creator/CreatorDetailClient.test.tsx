// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CreatorDetailClient } from "@/components/creator/CreatorDetailClient";
import type { Creator, CreatorXDataClient, Order } from "@/lib/data/contracts";

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  refresh: vi.fn(),
  randomUUID: vi.fn(),
}));

vi.mock("@/components/runtime/CreatorXDataProvider", () => ({
  useCreatorXDataClient: () => mocks.client,
}));

vi.mock("@/lib/session/CreatorXSessionProvider", () => ({
  useCreatorXSession: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/components/market/CreatorInfo", () => ({ CreatorInfo: () => null }));
vi.mock("@/components/market/OrderBook", () => ({ OrderBook: () => null }));
vi.mock("@/components/market/RecentTrades", () => ({ RecentTrades: () => null }));
vi.mock("@/components/market/MarketChart", () => ({ MarketChart: () => null }));

const creator: Creator = {
  id: "creator/special?",
  youtubeChannelId: "youtube-1",
  name: "Creator One",
  thumbnailUrl: null,
  category: "Gaming",
  country: "KR",
  currentSubs: 1000,
  currentViews: 2000,
  currentVideos: 30,
  currentScore: 88,
  initialPrice: 100,
  currentPrice: 125,
  totalSupply: 1_000_000,
  circulatingSupply: 200_000,
  reserveSupply: 800_000,
  liquidity: 10_000,
  isActive: true,
  visibility: "PUBLIC",
  avgLikes: 10,
  avgComments: 2,
  engagementRate: 1.2,
  viewsPerSubs: 2,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
  lastSyncedAt: "2026-07-10T00:00:00.000Z",
  _count: { videos: 30 },
};

const acceptedOrder: Order = {
  id: "order-1",
  creatorId: creator.id,
  type: "BUY",
  orderType: "LIMIT",
  price: 125,
  quantity: 2,
  filled: 0,
  status: "OPEN",
  createdAt: "2026-07-10T00:00:00.000Z",
};

beforeEach(() => {
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  mocks.randomUUID.mockReset().mockReturnValue("inline-key");
  vi.stubGlobal("crypto", { randomUUID: mocks.randomUUID });
  vi.stubGlobal("alert", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("submits the inline order through the typed client with one idempotency key", async () => {
  const getCreator = vi.fn().mockResolvedValue(creator);
  const placeOrder = vi
    .fn<CreatorXDataClient["placeOrder"]>()
    .mockResolvedValue(acceptedOrder);
  mocks.client = {
    getCreator,
    getCreatorStats: vi.fn().mockResolvedValue([]),
    getCreatorVideos: vi.fn().mockResolvedValue([]),
    getCreatorHistory: vi.fn().mockResolvedValue([]),
    getCreatorTrades: vi.fn().mockResolvedValue([]),
    getOrderBook: vi.fn().mockResolvedValue({ asks: [], bids: [] }),
    placeOrder,
  } as unknown as CreatorXDataClient;

  render(<CreatorDetailClient id={creator.id} />);
  await screen.findByText("Creator One/P");
  fireEvent.change(screen.getByPlaceholderText("0.0"), {
    target: { value: "2" },
  });
  const buyButtons = screen.getAllByRole("button", { name: "BUY" });
  fireEvent.click(buyButtons[buyButtons.length - 1]);

  await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(1));
  expect(placeOrder).toHaveBeenCalledWith(
    {
      creatorId: creator.id,
      side: "BUY",
      orderType: "LIMIT",
      price: 125,
      quantity: 2,
    },
    { idempotencyKey: "inline-key" },
  );
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(getCreator).toHaveBeenCalledTimes(2));
});
