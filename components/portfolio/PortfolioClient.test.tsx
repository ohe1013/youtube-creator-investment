// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PortfolioClient } from "@/components/portfolio/PortfolioClient";
import type {
  CancelOrderResult,
  CreatorXDataClient,
  Portfolio,
} from "@/lib/data/contracts";

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  session: {
    status: "authenticated" as "authenticated" | "unauthenticated",
    identityKind: "anonymous-device" as "browser" | "anonymous-device",
    refresh: vi.fn(),
  },
}));

vi.mock("@/components/runtime/CreatorXDataProvider", () => ({
  useCreatorXDataClient: () => mocks.client,
}));

vi.mock("@/lib/session/CreatorXSessionProvider", () => ({
  useCreatorXSession: () => mocks.session,
}));

vi.mock("@/lib/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const portfolio = {
  balance: "1000",
  reservedBalance: "100",
  availableBalance: "900",
  positions: [],
  openOrders: [
    {
      id: "order-1",
      creatorId: "creator/with?special",
      side: "BUY",
      orderType: "LIMIT",
      price: "50",
      quantity: "2",
      filled: "0",
      reservedQuote: "100",
      reservedQuantity: "0",
      status: "OPEN",
      completedAt: null,
      cancelReason: null,
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
    },
  ],
  executions: [
    {
      id: "execution-1",
      creatorId: "creator-1",
      side: "BUY",
      price: "50",
      quantity: "2",
      quoteAmount: "100",
      executedAt: "2026-07-10T00:00:00.000Z",
    },
  ],
} as unknown as Portfolio;

function cancelOrderResult(): CancelOrderResult {
  return {
    responseStatus: 200,
    order: { ...portfolio.openOrders[0], status: "CANCELLED" },
    portfolio: { ...portfolio, openOrders: [] },
  } as unknown as CancelOrderResult;
}

beforeEach(() => {
  mocks.session.status = "authenticated";
  mocks.session.identityKind = "anonymous-device";
  mocks.session.refresh.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("crypto", { randomUUID: () => "cancel-key" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("cancels through the typed client then immediately reloads portfolio and session", async () => {
  const getPortfolio = vi
    .fn<CreatorXDataClient["getPortfolio"]>()
    .mockResolvedValue(portfolio);
  const cancelOrder = vi
    .fn<CreatorXDataClient["cancelOrder"]>()
    .mockResolvedValue(cancelOrderResult());
  mocks.client = { getPortfolio, cancelOrder } as unknown as CreatorXDataClient;

  render(<PortfolioClient />);
  fireEvent.click(await screen.findByRole("button", { name: "portfolio.openOrders" }));
  fireEvent.click(await screen.findByRole("button", { name: "portfolio.cancel" }));

  await waitFor(() =>
    expect(cancelOrder).toHaveBeenCalledWith("order-1", {
      idempotencyKey: expect.any(String),
    }),
  );
  await waitFor(() => expect(getPortfolio).toHaveBeenCalledTimes(2));
  expect(mocks.session.refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("link", { name: "creator/with?special" })).toHaveAttribute(
    "href",
    "/creator?id=creator%2Fwith%3Fspecial",
  );
});

it("does not request a private portfolio for an unauthenticated browser", async () => {
  const getPortfolio = vi
    .fn<CreatorXDataClient["getPortfolio"]>()
    .mockResolvedValue(portfolio);
  mocks.session.status = "unauthenticated";
  mocks.session.identityKind = "browser";
  mocks.client = {
    getPortfolio,
    cancelOrder: vi.fn(),
  } as unknown as CreatorXDataClient;

  render(<PortfolioClient />);
  expect(await screen.findByRole("link")).toHaveAttribute("href", "/auth/signin");
  await Promise.resolve();
  expect(getPortfolio).not.toHaveBeenCalled();
});

it("renders the server-derived portfolio execution side without a client subject", async () => {
  const getPortfolio = vi
    .fn<CreatorXDataClient["getPortfolio"]>()
    .mockResolvedValue(portfolio);
  mocks.client = { getPortfolio, cancelOrder: vi.fn() } as unknown as CreatorXDataClient;

  render(<PortfolioClient />);
  fireEvent.click(await screen.findByRole("button", { name: "portfolio.tradeHistory" }));

  expect(await screen.findByText("common.buy")).toBeInTheDocument();
  expect(screen.queryByText("common.sell")).toBeNull();
});

it("locks duplicate cancellation and ignores a stale pre-cancel poll", async () => {
  vi.useFakeTimers();
  let resolveStalePoll: ((value: Portfolio) => void) | undefined;
  let resolveCancel: ((result: CancelOrderResult) => void) | undefined;
  const withoutOrder: Portfolio = {
    ...portfolio,
    balance: "1100" as never,
    availableBalance: "1000" as never,
    openOrders: [],
  };
  const getPortfolio = vi
    .fn<CreatorXDataClient["getPortfolio"]>()
    .mockResolvedValueOnce(portfolio)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStalePoll = resolve;
        }),
    )
    .mockResolvedValueOnce(withoutOrder);
  const cancelOrder = vi.fn<CreatorXDataClient["cancelOrder"]>().mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveCancel = resolve;
      }),
  );
  mocks.client = { getPortfolio, cancelOrder } as unknown as CreatorXDataClient;

  render(<PortfolioClient />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  fireEvent.click(screen.getByRole("button", { name: "portfolio.openOrders" }));
  const cancelButton = screen.getByRole("button", { name: "portfolio.cancel" });

  await act(async () => {
    vi.advanceTimersByTime(5000);
    await Promise.resolve();
  });
  fireEvent.click(cancelButton);
  fireEvent.click(cancelButton);
  expect(cancelOrder).toHaveBeenCalledTimes(1);
  expect(cancelButton).toBeDisabled();

  resolveCancel?.(cancelOrderResult());
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(getPortfolio).toHaveBeenCalledTimes(3);
  expect(screen.queryByRole("button", { name: "portfolio.cancel" })).toBeNull();

  resolveStalePoll?.(portfolio);
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.queryByRole("button", { name: "portfolio.cancel" })).toBeNull();
  expect(mocks.session.refresh).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});
