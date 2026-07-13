// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MarketDashboard,
  type MarketCreator,
} from "@/components/market/MarketDashboard";
import type {
  CreatorXDataClient,
  Order,
} from "@/lib/data/contracts";

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  refresh: vi.fn(),
  randomUUID: vi.fn(),
}));

vi.mock("@/components/runtime/CreatorXDataProvider", () => ({
  useCreatorXDataClient: () => mocks.client,
  useCreatorXOrderAttemptStore: () => null,
}));

vi.mock("@/lib/session/CreatorXSessionProvider", () => ({
  useCreatorXSession: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/lib/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/market/CreatorInfo", () => ({
  CreatorInfo: () => null,
}));

vi.mock("@/components/market/MarketChart", () => ({
  MarketChart: () => null,
}));

vi.mock("@/components/market/MarketHeader", () => ({
  MarketHeader: () => null,
}));

vi.mock("@/components/market/MarketList", () => ({
  MarketList: () => null,
}));

vi.mock("@/components/market/RecentTrades", () => ({
  RecentTrades: () => null,
}));

const creator: MarketCreator = {
  id: "creator-1",
  youtubeChannelId: "channel-1",
  name: "Creator One",
  thumbnailUrl: null,
  category: "Tech",
  country: "KR",
  currentSubs: 1000,
  currentViews: 2000,
  currentVideos: 10,
  currentScore: 80,
  initialPrice: 100,
  currentPrice: 125,
  totalSupply: 1000,
  circulatingSupply: 500,
  reserveSupply: 500,
  liquidity: 100,
  isActive: true,
  visibility: "PUBLIC",
  avgLikes: 20,
  avgComments: 2,
  engagementRate: 3,
  viewsPerSubs: 4,
  createdAt: "2026-07-10T00:00:00.000Z",
  lastSyncedAt: "2026-07-10T00:00:00.000Z",
  _count: { videos: 10 },
};

function enterQuantity(value: string) {
  fireEvent.change(screen.getAllByRole("spinbutton")[1], {
    target: { value },
  });
}

function submitBuy() {
  const buttons = screen.getAllByRole("button", { name: "common.buy" });
  fireEvent.click(buttons[buttons.length - 1]);
}

beforeEach(() => {
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  mocks.randomUUID.mockReset().mockReturnValue("key-1");
  vi.stubGlobal("crypto", { randomUUID: mocks.randomUUID });
  vi.stubGlobal("alert", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MarketDashboard order coordination", () => {
  it("keeps one MARKET POST pending when the current order-book price is selected", async () => {
    let resolveOrder!: (order: Order) => void;
    const placeOrder = vi
      .fn<CreatorXDataClient["placeOrder"]>()
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveOrder = resolve;
          }),
      );
    mocks.client = { placeOrder } as unknown as CreatorXDataClient;

    render(
      <MarketDashboard
        selectedCreator={creator}
        stats={{ high24h: 130, low24h: 120, vol24h: 50, change24h: 2 }}
        chartData={[]}
        trades={[]}
        creators={[creator]}
        orderBook={{ asks: [], bids: [] }}
        userBalance={1000}
        userQuantity={4}
        onOrderAccepted={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    enterQuantity("2");
    submitBuy();
    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("125"));
    enterQuantity("2");
    submitBuy();

    expect(placeOrder).toHaveBeenCalledTimes(1);

    resolveOrder({
      id: "order-1",
      creatorId: creator.id,
      side: "BUY",
      orderType: "MARKET",
      price: "125",
      quantity: "2",
      filled: "2",
      reservedQuote: "0",
      reservedQuantity: "0",
      status: "FILLED",
      completedAt: "2026-07-10T00:00:00.000Z",
      cancelReason: null,
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
    } as unknown as Order);
  });
});
