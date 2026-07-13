// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrderForm } from "@/components/market/OrderForm";
import type {
  CreatorXDataClient,
  Order,
  PlaceOrderResult,
} from "@/lib/data/contracts";
import { CreatorXClientError } from "@/lib/data/errors";
import { useCreatorXOrderSubmission } from "@/lib/orders/useCreatorXOrderSubmission";

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

const acceptedOrder: Order = {
  id: "order-1",
  creatorId: "creator-1",
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
} as unknown as Order;

function placeOrderResult(order: Order = acceptedOrder): PlaceOrderResult {
  return {
    responseStatus: 201,
    order,
    portfolio: {
      balance: "1000",
      reservedBalance: "0",
      availableBalance: "1000",
      positions: [],
      openOrders: [],
      executions: [],
    },
  } as unknown as PlaceOrderResult;
}

function renderForm(
  placeOrder: CreatorXDataClient["placeOrder"],
  onOrderAccepted: () => Promise<void> = vi.fn().mockResolvedValue(undefined),
) {
  mocks.client = { placeOrder } as unknown as CreatorXDataClient;
  return render(
    <OrderForm
      creatorId="creator-1"
      currentPrice={125}
      userBalance={1000}
      userQuantity={4}
      onOrderAccepted={onOrderAccepted}
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

function ConcurrentSubmissionHarness() {
  const { isSubmitting, submit } = useCreatorXOrderSubmission();
  return (
    <>
      <output data-testid="submission-state">
        {isSubmitting ? "busy" : "idle"}
      </output>
      <button
        type="button"
        onClick={() => {
          void submit({
            creatorId: "creator-a",
            side: "BUY",
            orderType: "MARKET",
            quantity: "1",
          });
        }}
      >
        submit-a
      </button>
      <button
        type="button"
        onClick={() => {
          void submit({
            creatorId: "creator-b",
            side: "BUY",
            orderType: "MARKET",
            quantity: "1",
          });
        }}
      >
        submit-b
      </button>
    </>
  );
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
  it("keeps isSubmitting active until concurrent A and B signatures both settle", async () => {
    let resolveA: ((result: PlaceOrderResult) => void) | undefined;
    let resolveB: ((result: PlaceOrderResult) => void) | undefined;
    const placeOrder = vi
      .fn<CreatorXDataClient["placeOrder"]>()
      .mockImplementation(
        (input) =>
          new Promise((resolve) => {
            if (input.creatorId === "creator-a") resolveA = resolve;
            else resolveB = resolve;
          }),
      );
    mocks.client = { placeOrder } as unknown as CreatorXDataClient;
    render(<ConcurrentSubmissionHarness />);

    fireEvent.click(screen.getByRole("button", { name: "submit-a" }));
    fireEvent.click(screen.getByRole("button", { name: "submit-b" }));
    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("submission-state")).toHaveTextContent("busy");

    resolveA?.(placeOrderResult({
      ...acceptedOrder,
      id: "order-a",
      creatorId: "creator-a",
      price: "100",
      quantity: "1",
    } as unknown as Order));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("submission-state")).toHaveTextContent("busy");

    resolveB?.(placeOrderResult({
      ...acceptedOrder,
      id: "order-b",
      creatorId: "creator-b",
      price: "200",
      quantity: "1",
    } as unknown as Order));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("submission-state")).toHaveTextContent("idle");
  });

  it("submits the exact typed order with one idempotency key and refreshes session after acceptance", async () => {
    const placeOrder = vi.fn<CreatorXDataClient["placeOrder"]>().mockResolvedValue(
      placeOrderResult(),
    );
    const onOrderAccepted = vi.fn().mockResolvedValue(undefined);
    renderForm(placeOrder, onOrderAccepted);
    enterQuantity("2");
    submitBuy();

    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(1));
    expect(placeOrder).toHaveBeenCalledWith(
      {
        creatorId: "creator-1",
        side: "BUY",
        orderType: "MARKET",
        quantity: "2",
      },
      { idempotencyKey: "key-1" },
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(onOrderAccepted).toHaveBeenCalledTimes(1);
    expect(mocks.randomUUID).toHaveBeenCalledTimes(1);
  });

  it("blocks a rapid duplicate while the first submission is pending", async () => {
    let resolveOrder: ((result: PlaceOrderResult) => void) | undefined;
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

    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(1));
    resolveOrder?.(placeOrderResult());
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  });

  it("keeps pending UI state active through StrictMode effect replay", async () => {
    let resolveOrder: ((result: PlaceOrderResult) => void) | undefined;
    const placeOrder = vi.fn<CreatorXDataClient["placeOrder"]>().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOrder = resolve;
        }),
    );
    mocks.client = { placeOrder } as unknown as CreatorXDataClient;
    render(
      <StrictMode>
        <OrderForm
          creatorId="creator-1"
          currentPrice={125}
          userBalance={1000}
          userQuantity={4}
        />
      </StrictMode>,
    );
    enterQuantity("2");
    submitBuy();
    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(1));

    expect(screen.getByRole("button", { name: "Processing..." })).toBeDisabled();

    resolveOrder?.(placeOrderResult());
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    enterQuantity("2");
    expect(screen.getAllByRole("button", { name: "common.buy" }).at(-1)).toBeEnabled();
  });

  it("keeps the shared lock through unmount and releases it when the POST settles", async () => {
    let resolveFirst: ((result: PlaceOrderResult) => void) | undefined;
    const placeOrder = vi
      .fn<CreatorXDataClient["placeOrder"]>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(placeOrderResult());
    mocks.client = { placeOrder } as unknown as CreatorXDataClient;
    const renderSharedClientForm = () =>
      render(
        <OrderForm
          creatorId="creator-1"
          currentPrice={125}
          userBalance={1000}
          userQuantity={4}
        />,
      );
    const first = renderSharedClientForm();
    enterQuantity("2");
    submitBuy();
    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(1));
    first.unmount();

    renderSharedClientForm();
    enterQuantity("2");
    submitBuy();
    expect(placeOrder).toHaveBeenCalledTimes(1);

    resolveFirst?.(placeOrderResult());
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    submitBuy();
    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(2));
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
      .mockResolvedValue(placeOrderResult());
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
      .mockResolvedValueOnce(placeOrderResult());
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

  it("retains the key for an ambiguous INVALID_RESPONSE even when marked nonretryable", async () => {
    const placeOrder = vi
      .fn<CreatorXDataClient["placeOrder"]>()
      .mockRejectedValueOnce(
        new CreatorXClientError(
          "INVALID_RESPONSE",
          "Committed response could not be parsed",
          false,
          502,
        ),
      )
      .mockResolvedValueOnce(placeOrderResult());
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
      .mockResolvedValueOnce(
        placeOrderResult({ ...acceptedOrder, quantity: "3" } as unknown as Order),
      );
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

  it("clears a confirmed attempt so the same input starts a new logical order", async () => {
    const placeOrder = vi
      .fn<CreatorXDataClient["placeOrder"]>()
      .mockResolvedValueOnce(placeOrderResult())
      .mockResolvedValueOnce(
        placeOrderResult({ ...acceptedOrder, id: "order-2" } as unknown as Order),
      );
    renderForm(placeOrder);
    enterQuantity("2");
    submitBuy();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));

    enterQuantity("2");
    submitBuy();
    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(2));

    expect(placeOrder.mock.calls[0][1]?.idempotencyKey).toBe("key-1");
    expect(placeOrder.mock.calls[1][1]?.idempotencyKey).toBe("key-2");
  });

  it("clears a nonretryable attempt before a manual correction", async () => {
    const placeOrder = vi
      .fn<CreatorXDataClient["placeOrder"]>()
      .mockRejectedValueOnce(
        new CreatorXClientError(
          "INSUFFICIENT_BALANCE",
          "Balance is too low",
          false,
          409,
        ),
      )
      .mockResolvedValueOnce(placeOrderResult());
    renderForm(placeOrder);
    enterQuantity("2");
    submitBuy();
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "common.buy" }).at(-1)).toBeEnabled(),
    );
    submitBuy();
    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(2));

    expect(placeOrder.mock.calls[0][1]?.idempotencyKey).toBe("key-1");
    expect(placeOrder.mock.calls[1][1]?.idempotencyKey).toBe("key-2");
  });

  it("keeps the ambiguous key across a UI remount for identical input", async () => {
    const placeOrder = vi
      .fn<CreatorXDataClient["placeOrder"]>()
      .mockRejectedValueOnce(
        new CreatorXClientError(
          "NETWORK_UNAVAILABLE",
          "Network interrupted",
          true,
        ),
      )
      .mockResolvedValueOnce(placeOrderResult());
    mocks.client = { placeOrder } as unknown as CreatorXDataClient;
    const first = render(
      <OrderForm
        creatorId="creator-1"
        currentPrice={125}
        userBalance={1000}
        userQuantity={4}
      />,
    );
    enterQuantity("2");
    submitBuy();
    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "common.buy" }).at(-1)).toBeEnabled(),
    );
    first.unmount();

    render(
      <OrderForm
        creatorId="creator-1"
        currentPrice={125}
        userBalance={1000}
        userQuantity={4}
      />,
    );
    enterQuantity("2");
    submitBuy();
    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(2));
    expect(placeOrder.mock.calls[0][1]?.idempotencyKey).toBe("key-1");
    expect(placeOrder.mock.calls[1][1]?.idempotencyKey).toBe("key-1");
  });

  it("reports an accepted order even when session and parent refreshes fail", async () => {
    mocks.refresh.mockRejectedValueOnce(new Error("session refresh failed"));
    const placeOrder = vi
      .fn<CreatorXDataClient["placeOrder"]>()
      .mockResolvedValue(placeOrderResult());
    const onOrderAccepted = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("parent refresh failed"));
    renderForm(placeOrder, onOrderAccepted);
    enterQuantity("2");
    submitBuy();

    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(vi.mocked(alert)).toHaveBeenCalledWith(
        "Trade Executed: BUY 2 shares @ 125",
      ),
    );
    expect(onOrderAccepted).toHaveBeenCalledTimes(1);
    expect(placeOrder).toHaveBeenCalledTimes(1);
  });
});
