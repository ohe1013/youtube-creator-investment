// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CreatorXDataProvider,
  useCreatorXDataClient,
  useCreatorXDataRuntime,
} from "@/components/runtime/CreatorXDataProvider";
import type { CreatorXDataClient } from "@/lib/data/contracts";
import type { DemoDataClientDependencies } from "@/lib/data/demo-client";
import type { CreatorXRuntimeConfig } from "@/lib/runtime/config";
import type { AsyncKeyValueStore } from "@/lib/storage/client-storage";

const BROWSER_SUBJECT = "browser-demo-user";

const sdkMocks = vi.hoisted(() => ({
  getAnonymousKey: vi.fn(),
  getUserKeyForGame: vi.fn(),
}));

vi.mock("@apps-in-toss/web-framework", () => ({
  getAnonymousKey: sdkMocks.getAnonymousKey,
  getUserKeyForGame: sdkMocks.getUserKeyForGame,
}));

afterEach(() => {
  cleanup();
  sdkMocks.getAnonymousKey.mockReset();
  sdkMocks.getUserKeyForGame.mockReset();
});

function runtimeConfig(
  overrides: Partial<CreatorXRuntimeConfig> = {},
): CreatorXRuntimeConfig {
  return {
    appInToss: false,
    releaseChannel: "development",
    dataMode: "demo",
    apiBaseUrl: null,
    allowBrowserStorageFallback: true,
    brandIconUrl: null,
    legal: {
      operatorName: "CreatorX 개발팀",
      supportUrl: "https://support.example.com",
      privacyContact: "privacy@example.com",
      effectiveDate: "2026-07-10",
    },
    ...overrides,
  };
}

function clientStub(label: string): CreatorXDataClient {
  return { label } as unknown as CreatorXDataClient;
}

function memoryStore(): AsyncKeyValueStore & {
  getItem: ReturnType<typeof vi.fn<AsyncKeyValueStore["getItem"]>>;
  setItem: ReturnType<typeof vi.fn<AsyncKeyValueStore["setItem"]>>;
  removeItem: ReturnType<typeof vi.fn<AsyncKeyValueStore["removeItem"]>>;
} {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function RuntimeConsumer({
  onClient,
}: {
  onClient?: (client: CreatorXDataClient) => void;
}) {
  const client = useCreatorXDataClient();
  const runtime = useCreatorXDataRuntime();
  onClient?.(client);
  return (
    <output data-testid="runtime-value">
      {runtime.status}:{runtime.subject ?? "none"}
    </output>
  );
}

describe("CreatorXDataProvider", () => {
  it("selects only DemoDataClient in browser demo mode without native calls", async () => {
    const store = memoryStore();
    const demoClient = clientStub("demo");
    const createDemoClient = vi.fn(() => demoClient);
    const createRemoteClient = vi.fn(() => clientStub("remote"));
    const loadBrowserStorage = vi.fn(() => store);
    const loadNativeStorage = vi.fn(async () => memoryStore());
    const getGameUserKey = vi.fn(async () => ({
      type: "HASH",
      hash: "native-hash",
    }));
    const observedClients: CreatorXDataClient[] = [];

    render(
      <CreatorXDataProvider
        config={runtimeConfig()}
        dependencies={{
          createDemoClient,
          createRemoteClient,
          loadBrowserStorage,
          loadNativeStorage,
          getGameUserKey,
        }}
      >
        <RuntimeConsumer onClient={(client) => observedClients.push(client)} />
      </CreatorXDataProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("불러오는 중");
    expect(await screen.findByTestId("runtime-value")).toHaveTextContent(
      `ready:${BROWSER_SUBJECT}`,
    );
    expect(createDemoClient).toHaveBeenCalledWith({
      store,
      namespace: BROWSER_SUBJECT,
    });
    expect(createRemoteClient).not.toHaveBeenCalled();
    expect(loadBrowserStorage).toHaveBeenCalledTimes(1);
    expect(loadNativeStorage).not.toHaveBeenCalled();
    expect(getGameUserKey).not.toHaveBeenCalled();
    expect(observedClients.every((client) => client === demoClient)).toBe(true);
  });

  it("selects only RemoteDataClient with browser same-origin and a stable token seam", async () => {
    const remoteClient = clientStub("remote");
    const createDemoClient = vi.fn(() => clientStub("demo"));
    const createRemoteClient = vi.fn(() => remoteClient);
    const getBrowserOrigin = vi.fn(() => "https://browser.example.com");
    const getAccessToken = vi.fn(async () => "token");
    const dependencies = {
      createDemoClient,
      createRemoteClient,
      getBrowserOrigin,
      getAccessToken,
    };
    const config = runtimeConfig({ dataMode: "remote" });
    const observedClients = new Set<CreatorXDataClient>();

    const view = render(
      <CreatorXDataProvider config={config} dependencies={dependencies}>
        <RuntimeConsumer onClient={(client) => observedClients.add(client)} />
      </CreatorXDataProvider>,
    );

    expect(await screen.findByTestId("runtime-value")).toHaveTextContent(
      "ready:none",
    );
    expect(createDemoClient).not.toHaveBeenCalled();
    expect(createRemoteClient).toHaveBeenCalledTimes(1);
    expect(createRemoteClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: new URL("https://browser.example.com"),
        getAccessToken,
      }),
    );

    view.rerender(
      <CreatorXDataProvider
        config={runtimeConfig({ dataMode: "remote" })}
        dependencies={dependencies}
      >
        <RuntimeConsumer onClient={(client) => observedClients.add(client)} />
      </CreatorXDataProvider>,
    );

    await waitFor(() => expect(createRemoteClient).toHaveBeenCalledTimes(1));
    expect(getBrowserOrigin).toHaveBeenCalledTimes(1);
    expect(observedClients).toEqual(new Set([remoteClient]));
  });

  it("uses the configured absolute API URL in App-in-Toss remote mode", async () => {
    const createDemoClient = vi.fn(() => clientStub("demo"));
    const createRemoteClient = vi.fn(() => clientStub("remote"));
    const getBrowserOrigin = vi.fn(() => "https://must-not-be-used.example.com");
    const apiBaseUrl = new URL("https://creatorx-api.example.com/v1/");
    const dependencies = {
      createDemoClient,
      createRemoteClient,
      getBrowserOrigin,
    };

    const view = render(
      <CreatorXDataProvider
        config={runtimeConfig({
          appInToss: true,
          releaseChannel: "sandbox",
          dataMode: "remote",
          apiBaseUrl,
        })}
        dependencies={dependencies}
      >
        <RuntimeConsumer />
      </CreatorXDataProvider>,
    );

    expect(await screen.findByTestId("runtime-value")).toHaveTextContent(
      "ready:none",
    );
    expect(createRemoteClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: apiBaseUrl }),
    );
    expect(createDemoClient).not.toHaveBeenCalled();
    expect(getBrowserOrigin).not.toHaveBeenCalled();

    view.rerender(
      <CreatorXDataProvider
        config={runtimeConfig({
          appInToss: true,
          releaseChannel: "sandbox",
          dataMode: "remote",
          apiBaseUrl: new URL("https://creatorx-api.example.com/v1/"),
        })}
        dependencies={dependencies}
      >
        <RuntimeConsumer />
      </CreatorXDataProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(createRemoteClient).toHaveBeenCalledTimes(1);
  });

  it("shows a retryable CONFIG_INVALID issue when App-in-Toss remote URL is missing", async () => {
    const createRemoteClient = vi.fn(() => clientStub("remote"));

    render(
      <CreatorXDataProvider
        config={runtimeConfig({
          appInToss: true,
          releaseChannel: "sandbox",
          dataMode: "remote",
          apiBaseUrl: null,
        })}
        dependencies={{ createRemoteClient }}
      >
        <RuntimeConsumer />
      </CreatorXDataProvider>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-error-code", "CONFIG_INVALID");
    expect(alert).toHaveTextContent("API 주소");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeEnabled();
    expect(createRemoteClient).not.toHaveBeenCalled();
  });

  it("shares the validated game-user hash with the App-in-Toss demo client", async () => {
    const store = memoryStore();
    const createDemoClient = vi.fn(
      (dependencies: DemoDataClientDependencies) =>
        clientStub(dependencies.namespace),
    );
    const loadBrowserStorage = vi.fn(() => memoryStore());
    const loadNativeStorage = vi.fn(async () => store);
    const getGameUserKey = vi.fn(async () => ({
      type: "HASH",
      hash: "  device-hash  ",
    }));

    render(
      <CreatorXDataProvider
        config={runtimeConfig({
          appInToss: true,
          releaseChannel: "sandbox",
          dataMode: "demo",
        })}
        dependencies={{
          createDemoClient,
          loadBrowserStorage,
          loadNativeStorage,
          getGameUserKey,
        }}
      >
        <RuntimeConsumer />
      </CreatorXDataProvider>,
    );

    expect(await screen.findByTestId("runtime-value")).toHaveTextContent(
      "ready:device-hash",
    );
    expect(createDemoClient).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: "device-hash" }),
    );
    expect(store.setItem).not.toHaveBeenCalled();
    const selectedStore = createDemoClient.mock.calls[0][0].store;
    await selectedStore.getItem("native-missing");
    await selectedStore.setItem("native-key", "native-value");
    expect(store.getItem).toHaveBeenCalledWith("native-missing");
    expect(store.setItem).toHaveBeenCalledWith("native-key", "native-value");
    expect(loadNativeStorage).toHaveBeenCalledTimes(1);
    expect(getGameUserKey).toHaveBeenCalledTimes(1);
    expect(loadBrowserStorage).not.toHaveBeenCalled();
  });

  it("uses the official game user-key SDK seam by default", async () => {
    const store = memoryStore();
    const createDemoClient = vi.fn(() => clientStub("demo"));
    sdkMocks.getUserKeyForGame.mockResolvedValue({
      type: "HASH",
      hash: "official-game-key",
    });

    render(
      <CreatorXDataProvider
        config={runtimeConfig({
          appInToss: true,
          releaseChannel: "sandbox",
          dataMode: "demo",
        })}
        dependencies={{
          createDemoClient,
          loadNativeStorage: async () => store,
        }}
      >
        <RuntimeConsumer />
      </CreatorXDataProvider>,
    );

    expect(await screen.findByTestId("runtime-value")).toHaveTextContent(
      "ready:official-game-key",
    );
    expect(sdkMocks.getUserKeyForGame).toHaveBeenCalledTimes(1);
    expect(sdkMocks.getAnonymousKey).not.toHaveBeenCalled();
  });

  it("uses browser storage only when native storage fails in sandbox", async () => {
    const browserStore = memoryStore();
    const createDemoClient = vi.fn(
      (dependencies: DemoDataClientDependencies) => {
        return clientStub(`sandbox-fallback:${dependencies.namespace}`);
      },
    );
    const loadBrowserStorage = vi.fn(() => browserStore);
    const loadNativeStorage = vi.fn(async () => {
      throw new Error("native bridge missing");
    });
    const getGameUserKey = vi.fn(async () => ({
      type: "HASH",
      hash: "sandbox-device",
    }));

    render(
      <CreatorXDataProvider
        config={runtimeConfig({
          appInToss: true,
          releaseChannel: "sandbox",
          dataMode: "demo",
        })}
        dependencies={{
          createDemoClient,
          loadBrowserStorage,
          loadNativeStorage,
          getGameUserKey,
        }}
      >
        <RuntimeConsumer />
      </CreatorXDataProvider>,
    );

    expect(await screen.findByTestId("runtime-value")).toHaveTextContent(
      "ready:sandbox-device",
    );
    expect(loadNativeStorage).toHaveBeenCalledTimes(1);
    expect(loadBrowserStorage).toHaveBeenCalledTimes(1);
    const selectedStore = createDemoClient.mock.calls[0][0].store;
    await selectedStore.setItem("fallback", "value");
    expect(browserStore.setItem).toHaveBeenCalledWith("fallback", "value");
    expect(getGameUserKey).toHaveBeenCalledTimes(1);
  });

  it("never falls back to browser storage when native storage fails in production", async () => {
    const loadBrowserStorage = vi.fn(() => memoryStore());
    const loadNativeStorage = vi.fn(async () => {
      throw new Error("native bridge missing");
    });
    const getGameUserKey = vi.fn(async () => ({
      type: "HASH",
      hash: "must-not-load",
    }));
    const createDemoClient = vi.fn(() => clientStub("demo"));

    render(
      <CreatorXDataProvider
        config={runtimeConfig({
          appInToss: true,
          releaseChannel: "production",
          dataMode: "demo",
          allowBrowserStorageFallback: false,
        })}
        dependencies={{
          createDemoClient,
          loadBrowserStorage,
          loadNativeStorage,
          getGameUserKey,
        }}
      >
        <RuntimeConsumer />
      </CreatorXDataProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveAttribute(
      "data-error-code",
      "STORAGE_UNAVAILABLE",
    );
    expect(loadNativeStorage).toHaveBeenCalledTimes(1);
    expect(loadBrowserStorage).not.toHaveBeenCalled();
    expect(getGameUserKey).not.toHaveBeenCalled();
    expect(createDemoClient).not.toHaveBeenCalled();
  });

  it.each([
    ["INVALID_CATEGORY", async () => "INVALID_CATEGORY" as const],
    ["ERROR", async () => "ERROR" as const],
    ["undefined", async () => undefined],
    ["missing HASH type", async () => ({ hash: "device-hash" })],
    ["wrong type", async () => ({ type: "TOKEN", hash: "device-hash" })],
    ["blank hash", async () => ({ type: "HASH", hash: "   " })],
    ["malformed hash", async () => ({ type: "HASH", hash: 42 })],
    [
      "rejection",
      async () => {
        throw new Error("bridge rejected");
      },
    ],
  ])(
    "surfaces retryable SESSION_UNAVAILABLE for game-user-key %s without fallback writes",
    async (_label, getGameUserKey) => {
      const store = memoryStore();
      const createDemoClient = vi.fn(() => clientStub("demo"));
      const loadBrowserStorage = vi.fn(() => memoryStore());

      render(
        <CreatorXDataProvider
          config={runtimeConfig({
            appInToss: true,
            releaseChannel: "sandbox",
            dataMode: "demo",
          })}
          dependencies={{
            createDemoClient,
            loadBrowserStorage,
            loadNativeStorage: async () => store,
            getGameUserKey,
          }}
        >
          <RuntimeConsumer />
        </CreatorXDataProvider>,
      );

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveAttribute("data-error-code", "SESSION_UNAVAILABLE");
      expect(screen.getByRole("button", { name: "다시 시도" })).toBeEnabled();
      expect(createDemoClient).not.toHaveBeenCalled();
      expect(loadBrowserStorage).not.toHaveBeenCalled();
      expect(store.setItem).not.toHaveBeenCalled();
    },
  );

  it("evicts a rejected bootstrap and succeeds on retry", async () => {
    const store = memoryStore();
    const demoClient = clientStub("demo");
    const createDemoClient = vi.fn(() => demoClient);
    const getGameUserKey = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary bridge error"))
      .mockResolvedValueOnce({ type: "HASH", hash: "retried-device" });
    const observedClients = new Set<CreatorXDataClient>();

    render(
      <CreatorXDataProvider
        config={runtimeConfig({
          appInToss: true,
          releaseChannel: "sandbox",
          dataMode: "demo",
        })}
        dependencies={{
          createDemoClient,
          loadNativeStorage: async () => store,
          getGameUserKey,
        }}
      >
        <RuntimeConsumer onClient={(client) => observedClients.add(client)} />
      </CreatorXDataProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveAttribute(
      "data-error-code",
      "SESSION_UNAVAILABLE",
    );
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(await screen.findByTestId("runtime-value")).toHaveTextContent(
      "ready:retried-device",
    );
    expect(getGameUserKey).toHaveBeenCalledTimes(2);
    expect(createDemoClient).toHaveBeenCalledTimes(1);
    expect(observedClients).toEqual(new Set([demoClient]));
  });

  it("rebuilds remote mode when origin, factory, or token seams change", async () => {
    const firstClient = clientStub("first-remote");
    const secondClient = clientStub("second-remote");
    const firstFactory = vi.fn(() => firstClient);
    const secondFactory = vi.fn(() => secondClient);
    const firstToken = vi.fn(async () => "first-token");
    const secondToken = vi.fn(async () => "second-token");
    const firstOrigin = vi.fn(() => "https://first.example.com");
    const secondOrigin = vi.fn(() => "https://second.example.com");
    const observed = new Set<CreatorXDataClient>();
    const config = runtimeConfig({ dataMode: "remote" });

    const view = render(
      <CreatorXDataProvider
        config={config}
        dependencies={{
          createRemoteClient: firstFactory,
          getAccessToken: firstToken,
          getBrowserOrigin: firstOrigin,
        }}
      >
        <RuntimeConsumer onClient={(client) => observed.add(client)} />
      </CreatorXDataProvider>,
    );
    expect(await screen.findByTestId("runtime-value")).toHaveTextContent(
      "ready:none",
    );

    view.rerender(
      <CreatorXDataProvider
        config={runtimeConfig({ dataMode: "remote" })}
        dependencies={{
          createRemoteClient: secondFactory,
          getAccessToken: secondToken,
          getBrowserOrigin: secondOrigin,
        }}
      >
        <RuntimeConsumer onClient={(client) => observed.add(client)} />
      </CreatorXDataProvider>,
    );

    await waitFor(() => expect(secondFactory).toHaveBeenCalledTimes(1));
    expect(firstFactory).toHaveBeenCalledTimes(1);
    expect(secondFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: new URL("https://second.example.com"),
        getAccessToken: secondToken,
      }),
    );
    expect(firstOrigin).toHaveBeenCalledTimes(1);
    expect(secondOrigin).toHaveBeenCalledTimes(1);
    expect(observed).toEqual(new Set([firstClient, secondClient]));
  });

  it("invalidates stale native bootstrap when storage or game-key seams change", async () => {
    const staleGameKey = deferred<{ type: "HASH"; hash: string }>();
    const firstGameKey = vi.fn(() => staleGameKey.promise);
    const secondGameKey = vi.fn(async () => ({
      type: "HASH",
      hash: "fresh-device",
    }));
    const firstStorage = vi.fn(async () => memoryStore());
    const secondStorage = vi.fn(async () => memoryStore());
    const createdNamespaces: string[] = [];
    const createDemoClient = vi.fn(
      (dependencies: DemoDataClientDependencies) => {
        createdNamespaces.push(dependencies.namespace);
        return clientStub(dependencies.namespace);
      },
    );
    const config = runtimeConfig({
      appInToss: true,
      releaseChannel: "sandbox",
      dataMode: "demo",
    });

    const view = render(
      <CreatorXDataProvider
        config={config}
        dependencies={{
          createDemoClient,
          loadNativeStorage: firstStorage,
          getGameUserKey: firstGameKey,
        }}
      >
        <RuntimeConsumer />
      </CreatorXDataProvider>,
    );
    await waitFor(() => expect(firstGameKey).toHaveBeenCalledTimes(1));

    view.rerender(
      <CreatorXDataProvider
        config={config}
        dependencies={{
          createDemoClient,
          loadNativeStorage: secondStorage,
          getGameUserKey: secondGameKey,
        }}
      >
        <RuntimeConsumer />
      </CreatorXDataProvider>,
    );

    expect(await screen.findByTestId("runtime-value")).toHaveTextContent(
      "ready:fresh-device",
    );
    await act(async () => {
      staleGameKey.resolve({ type: "HASH", hash: "stale-device" });
      await staleGameKey.promise;
    });
    expect(firstStorage).toHaveBeenCalledTimes(1);
    expect(secondStorage).toHaveBeenCalledTimes(1);
    expect(createdNamespaces).toEqual(["fresh-device"]);
  });

  it("uses the latest repaired dependency seams when retrying", async () => {
    const firstGameKey = vi.fn().mockRejectedValue(new Error("first failure"));
    const repairedGameKey = vi
      .fn()
      .mockRejectedValueOnce(new Error("second failure"))
      .mockResolvedValueOnce({ type: "HASH", hash: "repaired-device" });
    const createDemoClient = vi.fn(() => clientStub("repaired"));
    const loadNativeStorage = vi.fn(async () => memoryStore());
    const config = runtimeConfig({
      appInToss: true,
      releaseChannel: "sandbox",
      dataMode: "demo",
    });

    const view = render(
      <CreatorXDataProvider
        config={config}
        dependencies={{
          createDemoClient,
          loadNativeStorage,
          getGameUserKey: firstGameKey,
        }}
      >
        <RuntimeConsumer />
      </CreatorXDataProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveAttribute(
      "data-error-code",
      "SESSION_UNAVAILABLE",
    );

    view.rerender(
      <CreatorXDataProvider
        config={config}
        dependencies={{
          createDemoClient,
          loadNativeStorage,
          getGameUserKey: repairedGameKey,
        }}
      >
        <RuntimeConsumer />
      </CreatorXDataProvider>,
    );
    await waitFor(() => expect(repairedGameKey).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).toHaveAttribute(
      "data-error-code",
      "SESSION_UNAVAILABLE",
    );
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(await screen.findByTestId("runtime-value")).toHaveTextContent(
      "ready:repaired-device",
    );
    expect(firstGameKey).toHaveBeenCalledTimes(1);
    expect(repairedGameKey).toHaveBeenCalledTimes(2);
  });

  it("reuses one pending bootstrap across StrictMode effect replay", async () => {
    const loadNativeStorage = vi.fn(async () => memoryStore());
    const getGameUserKey = vi.fn(async () => ({
      type: "HASH",
      hash: "strict-device",
    }));
    const createDemoClient = vi.fn(() => clientStub("strict"));

    render(
      <StrictMode>
        <CreatorXDataProvider
          config={runtimeConfig({
            appInToss: true,
            releaseChannel: "sandbox",
            dataMode: "demo",
          })}
          dependencies={{
            createDemoClient,
            loadNativeStorage,
            getGameUserKey,
          }}
        >
          <RuntimeConsumer />
        </CreatorXDataProvider>
      </StrictMode>,
    );

    expect(await screen.findByTestId("runtime-value")).toHaveTextContent(
      "ready:strict-device",
    );
    expect(loadNativeStorage).toHaveBeenCalledTimes(1);
    expect(getGameUserKey).toHaveBeenCalledTimes(1);
    expect(createDemoClient).toHaveBeenCalledTimes(1);
  });

  it("evicts a StrictMode rejection so retry starts one fresh bootstrap", async () => {
    const loadNativeStorage = vi.fn(async () => memoryStore());
    const getGameUserKey = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ type: "HASH", hash: "strict-retry" });
    const createDemoClient = vi.fn(() => clientStub("strict-retry"));

    render(
      <StrictMode>
        <CreatorXDataProvider
          config={runtimeConfig({
            appInToss: true,
            releaseChannel: "sandbox",
            dataMode: "demo",
          })}
          dependencies={{
            createDemoClient,
            loadNativeStorage,
            getGameUserKey,
          }}
        >
          <RuntimeConsumer />
        </CreatorXDataProvider>
      </StrictMode>,
    );

    expect(await screen.findByRole("alert")).toHaveAttribute(
      "data-error-code",
      "SESSION_UNAVAILABLE",
    );
    expect(getGameUserKey).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(await screen.findByTestId("runtime-value")).toHaveTextContent(
      "ready:strict-retry",
    );
    expect(loadNativeStorage).toHaveBeenCalledTimes(2);
    expect(getGameUserKey).toHaveBeenCalledTimes(2);
    expect(createDemoClient).toHaveBeenCalledTimes(1);
  });

  it("does not publish a stale async completion after unmount", async () => {
    const gameUserKey = deferred<{ type: "HASH"; hash: string }>();
    const createDemoClient = vi.fn(() => clientStub("demo"));
    const getGameUserKey = vi.fn(() => gameUserKey.promise);
    const view = render(
      <CreatorXDataProvider
        config={runtimeConfig({
          appInToss: true,
          releaseChannel: "sandbox",
          dataMode: "demo",
        })}
        dependencies={{
          createDemoClient,
          loadNativeStorage: async () => memoryStore(),
          getGameUserKey,
        }}
      >
        <RuntimeConsumer />
      </CreatorXDataProvider>,
    );

    await waitFor(() => expect(getGameUserKey).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => {
      gameUserKey.resolve({ type: "HASH", hash: "late-device" });
      await gameUserKey.promise;
    });

    expect(createDemoClient).not.toHaveBeenCalled();
  });

  it("keeps browser access out of the SSR render path", () => {
    const getBrowserOrigin = vi.fn(() => {
      throw new Error("window must not be touched while rendering on the server");
    });

    expect(() =>
      renderToString(
        <CreatorXDataProvider
          config={runtimeConfig({ dataMode: "remote" })}
          dependencies={{ getBrowserOrigin }}
        >
          <RuntimeConsumer />
        </CreatorXDataProvider>,
      ),
    ).not.toThrow();
    expect(getBrowserOrigin).not.toHaveBeenCalled();
  });

  it("fails clearly when the public hook is used outside its provider", () => {
    expect(() => render(<RuntimeConsumer />)).toThrow(
      "useCreatorXDataClient must be used within CreatorXDataProvider",
    );
  });
});
