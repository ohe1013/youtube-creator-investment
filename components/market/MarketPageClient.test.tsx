// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarketPageClient } from "@/components/market/MarketPageClient";
import { appInTossDemoData } from "@/lib/appintoss-demo-data";
import type {
  CreatorSummary,
  CreatorXDataClient,
  Portfolio,
} from "@/lib/data/contracts";

type DashboardProbeProps = {
  selectedCreator: CreatorSummary;
  userBalance: number;
  userQuantity: number;
  onOrderAccepted(): Promise<void>;
};

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  dashboardProps: null as unknown,
  session: {
    status: "authenticated" as
      | "loading"
      | "authenticated"
      | "unauthenticated"
      | "error",
    identityKind: "anonymous-device" as
      | "browser"
      | "anonymous-device"
      | "guest",
  },
  ticker: null as string | null,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (name: string) => (name === "ticker" ? mocks.ticker : null),
  }),
}));

vi.mock("@/components/runtime/CreatorXDataProvider", () => ({
  useCreatorXDataClient: () => mocks.client,
}));

vi.mock("@/lib/session/CreatorXSessionProvider", () => ({
  useCreatorXSession: () => mocks.session,
}));

vi.mock("@/components/market/MarketDashboard", () => ({
  MarketDashboard: (props: DashboardProbeProps) => {
    mocks.dashboardProps = props;
    return (
      <div>
        <span>selected:{props.selectedCreator.id}</span>
        <span>balance:{props.userBalance}</span>
        <span>quantity:{props.userQuantity}</span>
      </div>
    );
  },
}));

const baseCreator = appInTossDemoData.creators[0] as CreatorSummary;

function portfolio(balance: number, creatorId: string, quantity: number): Portfolio {
  return {
    balance,
    positions:
      quantity === 0
        ? []
        : [
            {
              id: `position-${quantity}`,
              creatorId,
              quantity,
              avgPrice: 100,
              creator: {
                id: creatorId,
                name: "Special Creator",
                currentPrice: 125,
                thumbnailUrl: null,
              },
            },
          ],
    openOrders: [],
    trades: [],
  };
}

function makeCreator(id: string): CreatorSummary {
  return { ...baseCreator, id, name: `Creator ${id}` };
}

function makeClient(
  creators: CreatorSummary[],
  getPortfolio: CreatorXDataClient["getPortfolio"],
): CreatorXDataClient {
  return {
    listCreators: vi.fn().mockResolvedValue({
      creators,
      pagination: { page: 1, limit: 50, total: creators.length, totalPages: 1 },
    }),
    getCreatorHistory: vi.fn().mockResolvedValue([]),
    getCreatorTrades: vi.fn().mockResolvedValue([]),
    getCreatorStats: vi.fn().mockResolvedValue([]),
    getCreatorVideos: vi.fn().mockResolvedValue([]),
    getOrderBook: vi.fn().mockResolvedValue({ asks: [], bids: [] }),
    getPortfolio,
  } as unknown as CreatorXDataClient;
}

beforeEach(() => {
  mocks.dashboardProps = null;
  mocks.ticker = null;
  mocks.session.status = "authenticated";
  mocks.session.identityKind = "anonymous-device";
});

afterEach(() => cleanup());

describe("MarketPageClient", () => {
  it("does not request the private portfolio for an unauthenticated browser", async () => {
    const getPortfolio = vi
      .fn<CreatorXDataClient["getPortfolio"]>()
      .mockResolvedValue(portfolio(999, baseCreator.id, 9));
    mocks.session.status = "unauthenticated";
    mocks.session.identityKind = "browser";
    mocks.client = makeClient([baseCreator], getPortfolio);

    render(<MarketPageClient />);

    await screen.findByText(`selected:${baseCreator.id}`);
    expect(screen.getByText("balance:0")).toBeInTheDocument();
    expect(screen.getByText("quantity:0")).toBeInTheDocument();
    expect(getPortfolio).not.toHaveBeenCalled();
  });

  it.each(["amp&id", "hash#id", "percent%2Fid", "space # ? id"])(
    "selects the exact decoded ticker %s instead of falling back to the first creator",
    async (specialId) => {
      const first = makeCreator("first-creator");
      const special = makeCreator(specialId);
      mocks.ticker = specialId;
      mocks.client = makeClient(
        [first, special],
        vi.fn().mockResolvedValue(portfolio(100, specialId, 1)),
      );

      render(<MarketPageClient />);

      await screen.findByText(`selected:${specialId}`);
      expect(screen.queryByText("selected:first-creator")).toBeNull();
    },
  );

  it("reloads balance and owned quantity after an accepted order", async () => {
    let resolveUpdated: ((value: Portfolio) => void) | undefined;
    const getPortfolio = vi
      .fn<CreatorXDataClient["getPortfolio"]>()
      .mockResolvedValueOnce(portfolio(100, baseCreator.id, 1))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveUpdated = resolve;
          }),
      );
    mocks.client = makeClient([baseCreator], getPortfolio);

    render(<MarketPageClient />);
    await screen.findByText("balance:100");

    let accepted: Promise<void> | undefined;
    act(() => {
      accepted = (mocks.dashboardProps as DashboardProbeProps).onOrderAccepted();
    });
    expect(getPortfolio).toHaveBeenCalledTimes(2);
    resolveUpdated?.(portfolio(75, baseCreator.id, 2));
    await act(async () => {
      await accepted;
    });

    await waitFor(() => expect(screen.getByText("balance:75")).toBeInTheDocument());
    expect(screen.getByText("quantity:2")).toBeInTheDocument();
  });
});
