// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrderForm } from "@/components/market/OrderForm";
import {
  CreatorXDataProvider,
  type CreatorXDataProviderDependencies,
} from "@/components/runtime/CreatorXDataProvider";
import { DemoDataClient } from "@/lib/data/demo-client";
import type { CreatorXRuntimeConfig } from "@/lib/runtime/config";
import type { AsyncKeyValueStore } from "@/lib/storage/client-storage";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  randomUUID: vi.fn(),
}));

vi.mock("@/lib/session/CreatorXSessionProvider", () => ({
  useCreatorXSession: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/lib/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const config: CreatorXRuntimeConfig = {
  appInToss: true,
  releaseChannel: "sandbox",
  dataMode: "demo",
  tossLoginEnabled: false,
  apiBaseUrl: null,
  allowBrowserStorageFallback: true,
  brandIconUrl: null,
  legal: {
    operatorName: "CreatorX",
    supportUrl: "https://support.example.com",
    privacyContact: "privacy@example.com",
    effectiveDate: "2026-07-10",
  },
};

class CommitThenThrowDemoStore implements AsyncKeyValueStore {
  readonly values = new Map<string, string>();
  private throwAfterDemoCommit = true;

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    if (
      this.throwAfterDemoCommit &&
      key.startsWith("creatorx:appintoss:state:")
    ) {
      this.throwAfterDemoCommit = false;
      throw new Error("response lost after durable demo commit");
    }
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function nativeAdapter(
  values: Map<string, string>,
  options: { failSettledAttemptWrite?: boolean } = {},
): AsyncKeyValueStore {
  return {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      if (
        options.failSettledAttemptWrite &&
        key.startsWith("creatorx:order-attempt:") &&
        (JSON.parse(value) as { status?: string }).status === "settled"
      ) {
        throw new Error("settled attempt write failed before commit");
      }
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
  };
}

function orderForm() {
  return (
    <OrderForm
      creatorId="creator-kpop-lab"
      currentPrice={1280}
      userBalance={100_000}
      userQuantity={0}
    />
  );
}

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
  mocks.randomUUID
    .mockReset()
    .mockReturnValueOnce("attempt-key-1")
    .mockReturnValueOnce("attempt-key-2");
  vi.stubGlobal("crypto", { randomUUID: mocks.randomUUID });
  vi.stubGlobal("alert", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useCreatorXOrderSubmission demo restart durability", () => {
  it("holds the stable lease while an old Provider waits for refresh", async () => {
    const values = new Map<string, string>();
    const refreshGate = Promise.withResolvers<void>();
    mocks.refresh
      .mockReset()
      .mockImplementationOnce(() => refreshGate.promise)
      .mockResolvedValue(undefined);
    const browserStorage = vi.fn(() => {
      throw new Error("native success must not load browser storage");
    });
    const clients: DemoDataClient[] = [];
    const placeOrderSpies: Array<ReturnType<typeof vi.spyOn>> = [];
    let id = 0;
    const dependencies: CreatorXDataProviderDependencies = {
      loadBrowserStorage: browserStorage,
      loadNativeStorage: vi.fn(async () => nativeAdapter(values)),
      getGameUserKey: vi.fn(async () => ({
        type: "HASH",
        hash: "lease-device",
      })),
      createDemoClient: (clientDependencies) => {
        const client = new DemoDataClient({
          ...clientDependencies,
          now: () => new Date("2026-07-10T10:11:12.000Z"),
          idFactory: () => `lease-${++id}`,
        });
        clients.push(client);
        placeOrderSpies.push(vi.spyOn(client, "placeOrder"));
        return client;
      },
    };

    const first = render(
      <CreatorXDataProvider config={config} dependencies={dependencies}>
        {orderForm()}
      </CreatorXDataProvider>,
    );
    await screen.findAllByRole("spinbutton");
    enterQuantity("2");
    submitBuy();
    await waitFor(() => expect(placeOrderSpies[0]).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    first.unmount();

    render(
      <CreatorXDataProvider config={config} dependencies={dependencies}>
        {orderForm()}
      </CreatorXDataProvider>,
    );
    await screen.findAllByRole("spinbutton");
    enterQuantity("2");
    submitBuy();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(placeOrderSpies[1]).toHaveBeenCalledTimes(0);

    await act(async () => {
      refreshGate.resolve();
      await refreshGate.promise;
    });
    submitBuy();
    await waitFor(() => expect(placeOrderSpies[1]).toHaveBeenCalledTimes(1));

    expect(placeOrderSpies[0].mock.calls[0][1]?.idempotencyKey).toBe(
      "attempt-key-1",
    );
    expect(placeOrderSpies[1].mock.calls[0][1]?.idempotencyKey).toBe(
      "attempt-key-2",
    );
    expect(browserStorage).not.toHaveBeenCalled();
  });

  it("returns an accepted order when the settled barrier cannot be persisted", async () => {
    const values = new Map<string, string>();
    const browserStorage = vi.fn(() => {
      throw new Error("native success must not load browser storage");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const placeOrderSpies: Array<ReturnType<typeof vi.spyOn>> = [];
    let id = 0;
    const dependencies: CreatorXDataProviderDependencies = {
      loadBrowserStorage: browserStorage,
      loadNativeStorage: vi.fn(async () =>
        nativeAdapter(values, { failSettledAttemptWrite: true }),
      ),
      getGameUserKey: vi.fn(async () => ({
        type: "HASH",
        hash: "settle-failure-device",
      })),
      createDemoClient: (clientDependencies) => {
        const client = new DemoDataClient({
          ...clientDependencies,
          now: () => new Date("2026-07-10T10:11:12.000Z"),
          idFactory: () => `settle-failure-${++id}`,
        });
        placeOrderSpies.push(vi.spyOn(client, "placeOrder"));
        return client;
      },
    };

    render(
      <CreatorXDataProvider config={config} dependencies={dependencies}>
        {orderForm()}
      </CreatorXDataProvider>,
    );
    await screen.findAllByRole("spinbutton");
    enterQuantity("2");
    submitBuy();

    await waitFor(() =>
      expect(vi.mocked(alert)).toHaveBeenCalledWith(
        "Trade Executed: BUY 2 shares @ 1280",
      ),
    );
    expect(placeOrderSpies[0]).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      "CreatorX order was accepted, but attempt settlement was not persisted",
      expect.objectContaining({ code: "STORAGE_UNAVAILABLE" }),
    );
    expect(browserStorage).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("reuses the selected native-store key after Provider and DemoDataClient recreation", async () => {
    const store = new CommitThenThrowDemoStore();
    const browserStorage = vi.fn(() => {
      throw new Error("native demo attempts must not mirror to browser storage");
    });
    const clients: DemoDataClient[] = [];
    const placeOrderSpies: Array<ReturnType<typeof vi.spyOn>> = [];
    let id = 0;
    const dependencies: CreatorXDataProviderDependencies = {
      loadBrowserStorage: browserStorage,
      loadNativeStorage: vi.fn(async () => store),
      getGameUserKey: vi.fn(async () => ({
        type: "HASH",
        hash: "restart-device",
      })),
      createDemoClient: (clientDependencies) => {
        const client = new DemoDataClient({
          ...clientDependencies,
          now: () => new Date("2026-07-10T10:11:12.000Z"),
          idFactory: () => `restart-${++id}`,
        });
        clients.push(client);
        placeOrderSpies.push(vi.spyOn(client, "placeOrder"));
        return client;
      },
    };

    const first = render(
      <CreatorXDataProvider config={config} dependencies={dependencies}>
        {orderForm()}
      </CreatorXDataProvider>,
    );
    await screen.findAllByRole("spinbutton");
    enterQuantity("2");
    submitBuy();
    await waitFor(() => expect(placeOrderSpies[0]).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "common.buy" }).at(-1)).toBeEnabled(),
    );
    const firstKey = placeOrderSpies[0].mock.calls[0][1]?.idempotencyKey;
    first.unmount();

    render(
      <CreatorXDataProvider config={config} dependencies={dependencies}>
        {orderForm()}
      </CreatorXDataProvider>,
    );
    await screen.findAllByRole("spinbutton");
    enterQuantity("2");
    submitBuy();
    await waitFor(() => expect(placeOrderSpies[1]).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));

    const secondKey = placeOrderSpies[1].mock.calls[0][1]?.idempotencyKey;
    expect(secondKey).toBe(firstKey);
    expect(mocks.randomUUID).toHaveBeenCalledTimes(1);
    expect(browserStorage).not.toHaveBeenCalled();
    expect(clients).toHaveLength(2);
    expect(
      [...store.values.keys()].filter((key) =>
        key.startsWith("creatorx:order-attempt:"),
      ),
    ).toEqual([]);
    await expect(clients[1].getPortfolio()).resolves.toMatchObject({
      balance: 97_440,
      positions: [{ creatorId: "creator-kpop-lab", quantity: 2 }],
      openOrders: [],
      trades: [{ creatorId: "creator-kpop-lab", quantity: 2 }],
    });
  });
});
