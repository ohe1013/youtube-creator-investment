// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
