// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PortfolioClient } from "@/components/portfolio/PortfolioClient";
import type { CreatorXDataClient, Portfolio } from "@/lib/data/contracts";

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  refresh: vi.fn(),
}));

vi.mock("@/components/runtime/CreatorXDataProvider", () => ({
  useCreatorXDataClient: () => mocks.client,
}));

vi.mock("@/lib/session/CreatorXSessionProvider", () => ({
  useCreatorXSession: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/lib/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const portfolio: Portfolio = {
  balance: 1000,
  positions: [],
  openOrders: [
    {
      id: "order-1",
      creatorId: "creator/with?special",
      type: "BUY",
      orderType: "LIMIT",
      price: 50,
      quantity: 2,
      filled: 0,
      status: "OPEN",
      createdAt: "2026-07-10T00:00:00.000Z",
      creator: { id: "creator/with?special", name: "Creator One" },
    },
  ],
  trades: [],
};

beforeEach(() => {
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("alert", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("cancels through the typed client then immediately reloads portfolio and session", async () => {
  const getPortfolio = vi
    .fn<CreatorXDataClient["getPortfolio"]>()
    .mockResolvedValue(portfolio);
  const cancelOrder = vi
    .fn<CreatorXDataClient["cancelOrder"]>()
    .mockResolvedValue(undefined);
  mocks.client = { getPortfolio, cancelOrder } as unknown as CreatorXDataClient;

  render(<PortfolioClient />);
  fireEvent.click(await screen.findByRole("button", { name: "portfolio.openOrders" }));
  fireEvent.click(await screen.findByRole("button", { name: "portfolio.cancel" }));

  await waitFor(() => expect(cancelOrder).toHaveBeenCalledWith("order-1"));
  await waitFor(() => expect(getPortfolio).toHaveBeenCalledTimes(2));
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("link", { name: "Creator One" })).toHaveAttribute(
    "href",
    "/creator?id=creator%2Fwith%3Fspecial",
  );
});
