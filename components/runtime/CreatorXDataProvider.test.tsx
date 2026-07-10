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
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CreatorXDataProvider,
  useCreatorXDataClient,
  useCreatorXDataRuntime,
} from "@/components/runtime/CreatorXDataProvider";
import type { CreatorXDataClient } from "@/lib/data/contracts";
import type { CreatorXRuntimeConfig } from "@/lib/runtime/config";
import type { AsyncKeyValueStore } from "@/lib/storage/client-storage";

const BROWSER_SUBJECT = "browser-demo-user";

afterEach(cleanup);

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
    const getAnonymousKey = vi.fn(async () => ({ hash: "native-hash" }));
    const observedClients: CreatorXDataClient[] = [];

    render(
      <CreatorXDataProvider
        config={runtimeConfig()}
        dependencies={{
          createDemoClient,
          createRemoteClient,
          loadBrowserStorage,
          loadNativeStorage,
          getAnonymousKey,
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
    expect(getAnonymousKey).not.toHaveBeenCalled();
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

  it("shares the validated anonymous hash with the App-in-Toss demo client", async () => {
    const store = memoryStore();
    const createDemoClient = vi.fn(() => clientStub("demo"));
    const loadBrowserStorage = vi.fn(() => memoryStore());
    const loadNativeStorage = vi.fn(async () => store);
    const getAnonymousKey = vi.fn(async () => ({ hash: "  device-hash  " }));

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
          getAnonymousKey,
        }}
      >
        <RuntimeConsumer />
      </CreatorXDataProvider>,
    );

    expect(await screen.findByTestId("runtime-value")).toHaveTextContent(
      "ready:device-hash",
    );
    expect(createDemoClient).toHaveBeenCalledWith({
      store,
      namespace: "device-hash",
    });
    expect(loadNativeStorage).toHaveBeenCalledTimes(1);
    expect(getAnonymousKey).toHaveBeenCalledTimes(1);
    expect(loadBrowserStorage).not.toHaveBeenCalled();
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it.each([
    ["ERROR", async () => "ERROR" as const],
    ["undefined", async () => undefined],
    ["blank hash", async () => ({ hash: "   " })],
    ["malformed hash", async () => ({ hash: 42 })],
    [
      "rejection",
      async () => {
        throw new Error("bridge rejected");
      },
    ],
  ])(
    "surfaces retryable SESSION_UNAVAILABLE for anonymous-key %s without fallback writes",
    async (_label, getAnonymousKey) => {
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
            getAnonymousKey,
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
    const getAnonymousKey = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary bridge error"))
      .mockResolvedValueOnce({ hash: "retried-device" });
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
          getAnonymousKey,
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
    expect(getAnonymousKey).toHaveBeenCalledTimes(2);
    expect(createDemoClient).toHaveBeenCalledTimes(1);
    expect(observedClients).toEqual(new Set([demoClient]));
  });

  it("does not publish a stale async completion after unmount", async () => {
    const anonymousKey = deferred<{ hash: string }>();
    const createDemoClient = vi.fn(() => clientStub("demo"));
    const getAnonymousKey = vi.fn(() => anonymousKey.promise);
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
          getAnonymousKey,
        }}
      >
        <RuntimeConsumer />
      </CreatorXDataProvider>,
    );

    await waitFor(() => expect(getAnonymousKey).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => {
      anonymousKey.resolve({ hash: "late-device" });
      await anonymousKey.promise;
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
