// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrderForm } from "@/components/market/OrderForm";
import type { CreatorXDataClient, Order } from "@/lib/data/contracts";
import { CreatorXClientError } from "@/lib/data/errors";

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

vi.mock("@/lib/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const acceptedOrder: Order = {
  id: "order-1",
  creatorId: "creator-1",
  type: "BUY",
  orderType: "MARKET",
  price: 125,
  quantity: 2,
  filled: 2,
  status: "FILLED",
  createdAt: "2026-07-10T00:00:00.000Z",
};

function renderForm(placeOrder: CreatorXDataClient["placeOrder"]) {
  mocks.client = { placeOrder } as unknown as CreatorXDataClient;
  render(
    <OrderForm
      creatorId="creator-1"
      currentPrice={125}
      userBalance={1000}
      userQuantity={4}
    />,
  );
}

function enterQuantity(value: string) {
  const inputs = screen.getAllByRole("spinbutton");
  fireEvent.change(inputs[1], { target: { value } });
}

function submitBuy() {
  const buttons = screen.getAllByRole("button", { name: "common.buy" });
  fireEvent.click(buttons[buttons.length - 1]);
}

beforeEach(() => {
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  mocks.randomUUID.mockReset();
  mocks.randomUUID
    .mockReturnValueOnce("key-1")
    .mockReturnValueOnce("key-2")
    .mockReturnValueOnce("key-3");
  vi.stubGlobal("crypto", { randomUUID: mocks.randomUUID });
  vi.stubGlobal("alert", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OrderForm", () => {
  it("submits the exact typed order with one idempotency key and refreshes session after acceptance", async () => {
    const placeOrder = vi.fn<CreatorXDataClient["placeOrder"]>().mockResolvedValue(
      acceptedOrder,
    );
    renderForm(placeOrder);
    enterQuantity("2");
    submitBuy();

    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(1));
    expect(placeOrder).toHaveBeenCalledWith(
      {
        creatorId: "creator-1",
        side: "BUY",
        orderType: "MARKET",
        price: 125,
        quantity: 2,
      },
      { idempotencyKey: "key-1" },
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.randomUUID).toHaveBeenCalledTimes(1);
  });

  it("blocks a rapid duplicate while the first submission is pending", async () => {
    let resolveOrder: ((order: Order) => void) | undefined;
    const placeOrder = vi.fn<CreatorXDataClient["placeOrder"]>().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOrder = resolve;
        }),
    );
    renderForm(placeOrder);
    enterQuantity("2");
    submitBuy();
    submitBuy();

    expect(placeOrder).toHaveBeenCalledTimes(1);
    resolveOrder?.(acceptedOrder);
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  });

  it("keeps duplicate submission blocked until the accepted balance refresh finishes", async () => {
    let resolveRefresh: (() => void) | undefined;
    mocks.refresh.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const placeOrder = vi
      .fn<CreatorXDataClient["placeOrder"]>()
      .mockResolvedValue(acceptedOrder);
    renderForm(placeOrder);
    enterQuantity("2");
    submitBuy();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    submitBuy();

    expect(placeOrder).toHaveBeenCalledTimes(1);
    resolveRefresh?.();
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "common.buy" }).at(-1)).toBeEnabled(),
    );
  });

  it("reuses the key for a manual retry after an ambiguous retryable failure", async () => {
    const placeOrder = vi
      .fn<CreatorXDataClient["placeOrder"]>()
      .mockRejectedValueOnce(
        new CreatorXClientError(
          "NETWORK_UNAVAILABLE",
          "Network interrupted",
          true,
        ),
      )
      .mockResolvedValueOnce(acceptedOrder);
    renderForm(placeOrder);
    enterQuantity("2");
    submitBuy();
    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "common.buy" }).at(-1)).toBeEnabled(),
    );
    submitBuy();

    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(2));
    expect(placeOrder.mock.calls[0][1]?.idempotencyKey).toBe("key-1");
    expect(placeOrder.mock.calls[1][1]?.idempotencyKey).toBe("key-1");
    expect(mocks.randomUUID).toHaveBeenCalledTimes(1);
  });

  it("creates a new key when the input changes after a retryable failure", async () => {
    const placeOrder = vi
      .fn<CreatorXDataClient["placeOrder"]>()
      .mockRejectedValueOnce(
        new CreatorXClientError(
          "NETWORK_UNAVAILABLE",
          "Network interrupted",
          true,
        ),
      )
      .mockResolvedValueOnce({ ...acceptedOrder, quantity: 3 });
    renderForm(placeOrder);
    enterQuantity("2");
    submitBuy();
    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "common.buy" }).at(-1)).toBeEnabled(),
    );
    enterQuantity("3");
    submitBuy();

    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(2));
    expect(placeOrder.mock.calls[0][1]?.idempotencyKey).toBe("key-1");
    expect(placeOrder.mock.calls[1][1]?.idempotencyKey).toBe("key-2");
  });
});
