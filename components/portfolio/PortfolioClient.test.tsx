// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PortfolioClient } from "@/components/portfolio/PortfolioClient";
import type { CreatorXDataClient, Portfolio } from "@/lib/data/contracts";

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
  mocks.session.status = "authenticated";
  mocks.session.identityKind = "anonymous-device";
  mocks.session.refresh.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("alert", vi.fn());
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
    .mockResolvedValue(undefined);
  mocks.client = { getPortfolio, cancelOrder } as unknown as CreatorXDataClient;

  render(<PortfolioClient />);
  fireEvent.click(await screen.findByRole("button", { name: "portfolio.openOrders" }));
  fireEvent.click(await screen.findByRole("button", { name: "portfolio.cancel" }));

  await waitFor(() => expect(cancelOrder).toHaveBeenCalledWith("order-1"));
  await waitFor(() => expect(getPortfolio).toHaveBeenCalledTimes(2));
  expect(mocks.session.refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("link", { name: "Creator One" })).toHaveAttribute(
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

it("locks duplicate cancellation and ignores a stale pre-cancel poll", async () => {
  vi.useFakeTimers();
  let resolveStalePoll: ((value: Portfolio) => void) | undefined;
  let resolveCancel: (() => void) | undefined;
  const withoutOrder: Portfolio = { ...portfolio, balance: 1100, openOrders: [] };
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

  resolveCancel?.();
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
