// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CreatorXSessionProvider,
  useCreatorXSession,
} from "@/lib/session/CreatorXSessionProvider";
import type { CreatorXDataClient, Portfolio } from "@/lib/data/contracts";
import { CreatorXClientError } from "@/lib/data/errors";
import type { CreatorXRuntimeConfig } from "@/lib/runtime/config";

const mocks = vi.hoisted(() => ({
  dataClient: null as unknown,
  dataRuntime: {
    client: null as unknown,
    subject: null as string | null,
    status: "ready" as const,
    error: null,
    retry: vi.fn(),
  },
  nextSession: {
    data: null as { user?: { id?: string; balance?: number } } | null,
    status: "unauthenticated" as "loading" | "authenticated" | "unauthenticated",
  },
  sessionProvider: vi.fn(),
  signOut: vi.fn(),
  useSession: vi.fn(),
  appLogin: vi.fn(),
}));

vi.mock("@/components/runtime/CreatorXDataProvider", () => ({
  useCreatorXDataClient: () => mocks.dataClient,
  useCreatorXDataRuntime: () => mocks.dataRuntime,
}));

vi.mock("next-auth/react", () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => {
    mocks.sessionProvider();
    return children;
  },
  signOut: mocks.signOut,
  useSession: () => {
    mocks.useSession();
    return mocks.nextSession;
  },
}));

vi.mock("@apps-in-toss/web-framework", () => ({
  appLogin: mocks.appLogin,
}));

const portfolio = (balance: number): Portfolio => ({
  balance,
  positions: [],
  openOrders: [],
  trades: [],
});

function config(
  overrides: Partial<CreatorXRuntimeConfig> = {},
): CreatorXRuntimeConfig {
  return {
    appInToss: true,
    tossLoginEnabled: false,
    releaseChannel: "sandbox",
    dataMode: "demo",
    apiBaseUrl: null,
    allowBrowserStorageFallback: true,
    brandIconUrl: null,
    legal: {
      operatorName: "CreatorX development team",
      supportUrl: "https://support.example.com",
      privacyContact: "privacy@example.com",
      effectiveDate: "2026-07-10",
    },
    ...overrides,
  };
}

function clientWithPortfolio(
  getPortfolio: CreatorXDataClient["getPortfolio"],
): CreatorXDataClient {
  return { getPortfolio } as unknown as CreatorXDataClient;
}

function SessionProbe() {
  const session = useCreatorXSession();
  return (
    <div>
      <output data-testid="session">
        {JSON.stringify({
          status: session.status,
          subject: session.subject,
          identityKind: session.identityKind,
          balance: session.balance,
          error: session.error?.code ?? null,
        })}
      </output>
      <button type="button" onClick={() => void session.refresh()}>
        refresh session
      </button>
      <button type="button" onClick={() => void session.signOut()}>
        sign out
      </button>
    </div>
  );
}

beforeEach(() => {
  mocks.sessionProvider.mockClear();
  mocks.signOut.mockReset().mockResolvedValue(undefined);
  mocks.useSession.mockClear();
  mocks.nextSession = { data: null, status: "unauthenticated" };
  mocks.appLogin.mockReset().mockResolvedValue({
    authorizationCode: "single-use-authorization-code",
    referrer: "SANDBOX",
  });
  mocks.dataRuntime.subject = "device-subject";
  mocks.dataClient = clientWithPortfolio(vi.fn().mockResolvedValue(portfolio(2500)));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CreatorXSessionProvider", () => {
  it("uses the shared game subject and portfolio without mounting NextAuth or fetching auth session", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <CreatorXSessionProvider config={config()}>
        <SessionProbe />
      </CreatorXSessionProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("session")).toHaveTextContent(
        '"status":"authenticated"',
      ),
    );
    expect(screen.getByTestId("session")).toHaveTextContent(
      '"subject":"device-subject"',
    );
    expect(screen.getByTestId("session")).toHaveTextContent('"balance":2500');
    expect(mocks.sessionProvider).not.toHaveBeenCalled();
    expect(mocks.useSession).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "refresh session" }));
    await waitFor(() =>
      expect(
        (mocks.dataClient as CreatorXDataClient).getPortfolio,
      ).toHaveBeenCalledTimes(2),
    );
    expect(mocks.dataRuntime.subject).toBe("device-subject");

    fireEvent.click(screen.getByRole("button", { name: "sign out" }));
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("maps browser NextAuth identity but always obtains balance from the data client", async () => {
    mocks.nextSession = {
      data: { user: { id: "browser-user", balance: 999999 } },
      status: "authenticated",
    };
    mocks.dataClient = clientWithPortfolio(
      vi.fn().mockResolvedValue(portfolio(4321)),
    );

    render(
      <CreatorXSessionProvider
        config={config({ appInToss: false, releaseChannel: "development" })}
      >
        <SessionProbe />
      </CreatorXSessionProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("session")).toHaveTextContent('"balance":4321'),
    );
    expect(screen.getByTestId("session")).toHaveTextContent(
      '"subject":"browser-user"',
    );
    expect(screen.getByTestId("session")).toHaveTextContent(
      '"identityKind":"browser"',
    );
    expect(mocks.sessionProvider).toHaveBeenCalled();
    expect(mocks.useSession).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "sign out" }));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));
  });

  it("does not request a private portfolio before the browser session authenticates", async () => {
    const getPortfolio = vi
      .fn<CreatorXDataClient["getPortfolio"]>()
      .mockResolvedValue(portfolio(0));
    mocks.dataClient = clientWithPortfolio(getPortfolio);
    mocks.nextSession = { data: null, status: "unauthenticated" };

    render(
      <CreatorXSessionProvider
        config={config({ appInToss: false, releaseChannel: "development" })}
      >
        <SessionProbe />
      </CreatorXSessionProvider>,
    );

    expect(screen.getByTestId("session")).toHaveTextContent(
      '"status":"unauthenticated"',
    );
    await Promise.resolve();
    expect(getPortfolio).not.toHaveBeenCalled();
  });

  it("resets immediately and refetches when browser identity changes from A to B", async () => {
    let resolveB: ((value: Portfolio) => void) | undefined;
    const getPortfolio = vi
      .fn<CreatorXDataClient["getPortfolio"]>()
      .mockResolvedValueOnce(portfolio(100))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveB = resolve;
          }),
      );
    mocks.dataClient = clientWithPortfolio(getPortfolio);
    mocks.nextSession = {
      data: { user: { id: "browser-A" } },
      status: "authenticated",
    };
    const view = render(
      <CreatorXSessionProvider
        config={config({ appInToss: false, releaseChannel: "development" })}
      >
        <SessionProbe />
      </CreatorXSessionProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("session")).toHaveTextContent('"balance":100'),
    );

    mocks.nextSession = {
      data: { user: { id: "browser-B" } },
      status: "authenticated",
    };
    view.rerender(
      <CreatorXSessionProvider
        config={config({ appInToss: false, releaseChannel: "development" })}
      >
        <SessionProbe />
      </CreatorXSessionProvider>,
    );

    expect(screen.queryByText(/"balance":100/)).toBeNull();
    expect(screen.getByRole("status")).toBeInTheDocument();
    await waitFor(() => expect(getPortfolio).toHaveBeenCalledTimes(2));
    resolveB?.(portfolio(200));
    await waitFor(() => {
      expect(screen.getByTestId("session")).toHaveTextContent(
        '"subject":"browser-B"',
      );
      expect(screen.getByTestId("session")).toHaveTextContent('"balance":200');
    });
  });

  it("ignores the stale A portfolio when A resolves after browser B", async () => {
    let resolveA: ((value: Portfolio) => void) | undefined;
    let resolveB: ((value: Portfolio) => void) | undefined;
    const getPortfolio = vi
      .fn<CreatorXDataClient["getPortfolio"]>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveA = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveB = resolve;
          }),
      );
    mocks.dataClient = clientWithPortfolio(getPortfolio);
    mocks.nextSession = {
      data: { user: { id: "browser-A" } },
      status: "authenticated",
    };
    const view = render(
      <CreatorXSessionProvider
        config={config({ appInToss: false, releaseChannel: "development" })}
      >
        <SessionProbe />
      </CreatorXSessionProvider>,
    );
    await waitFor(() => expect(getPortfolio).toHaveBeenCalledTimes(1));

    mocks.nextSession = {
      data: { user: { id: "browser-B" } },
      status: "authenticated",
    };
    view.rerender(
      <CreatorXSessionProvider
        config={config({ appInToss: false, releaseChannel: "development" })}
      >
        <SessionProbe />
      </CreatorXSessionProvider>,
    );
    await waitFor(() => expect(getPortfolio).toHaveBeenCalledTimes(2));
    resolveB?.(portfolio(200));
    await waitFor(() =>
      expect(screen.getByTestId("session")).toHaveTextContent('"balance":200'),
    );
    resolveA?.(portfolio(100));
    await Promise.resolve();
    expect(screen.getByTestId("session")).toHaveTextContent('"balance":200');
    expect(screen.getByTestId("session")).toHaveTextContent(
      '"subject":"browser-B"',
    );
  });

  it("renders a retryable session failure and recovers without changing the subject", async () => {
    const getPortfolio = vi
      .fn<CreatorXDataClient["getPortfolio"]>()
      .mockRejectedValueOnce(
        new CreatorXClientError(
          "NETWORK_UNAVAILABLE",
          "Portfolio unavailable",
          true,
        ),
      )
      .mockResolvedValueOnce(portfolio(7000));
    mocks.dataClient = clientWithPortfolio(getPortfolio);

    render(
      <CreatorXSessionProvider config={config()}>
        <SessionProbe />
      </CreatorXSessionProvider>,
    );

    expect(
      await screen.findByRole("alert", { name: "Portfolio unavailable" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    await waitFor(() =>
      expect(screen.getByTestId("session")).toHaveTextContent('"balance":7000'),
    );
    expect(getPortfolio).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("session")).toHaveTextContent(
      '"subject":"device-subject"',
    );
  });

  it("does not let an older refresh overwrite a newer balance", async () => {
    let resolveOlder: ((value: Portfolio) => void) | undefined;
    let resolveNewer: ((value: Portfolio) => void) | undefined;
    const getPortfolio = vi
      .fn<CreatorXDataClient["getPortfolio"]>()
      .mockResolvedValueOnce(portfolio(100))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOlder = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNewer = resolve;
          }),
      );
    mocks.dataClient = clientWithPortfolio(getPortfolio);

    render(
      <CreatorXSessionProvider config={config()}>
        <SessionProbe />
      </CreatorXSessionProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("session")).toHaveTextContent('"balance":100'),
    );

    fireEvent.click(screen.getByRole("button", { name: "refresh session" }));
    fireEvent.click(screen.getByRole("button", { name: "refresh session" }));
    resolveNewer?.(portfolio(300));
    await waitFor(() =>
      expect(screen.getByTestId("session")).toHaveTextContent('"balance":300'),
    );
    resolveOlder?.(portfolio(200));
    await Promise.resolve();
    expect(screen.getByTestId("session")).toHaveTextContent('"balance":300');
  });

  it("shows an actionable disabled state without calling the Toss bridge when Toss Login is not verified", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <CreatorXSessionProvider
        config={config({
          dataMode: "remote",
          apiBaseUrl: new URL("https://api.example.com"),
        })}
      >
        <SessionProbe />
      </CreatorXSessionProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveAttribute(
      "data-error-code",
      "TOSS_LOGIN_UNAVAILABLE",
    );
    expect(screen.queryByRole("button", { name: "다시 시도" })).toBeNull();
    expect((mocks.dataClient as CreatorXDataClient).getPortfolio).not.toHaveBeenCalled();
    expect(mocks.useSession).not.toHaveBeenCalled();
    expect(mocks.appLogin).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces the same actionable disabled state when the server rejects a mismatched Toss Login deployment", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "TOSS_LOGIN_UNAVAILABLE",
            message: "do not expose server configuration",
          },
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <CreatorXSessionProvider
        config={config({
          dataMode: "remote",
          apiBaseUrl: new URL("https://api.example.com"),
          tossLoginEnabled: true,
        })}
      >
        <SessionProbe />
      </CreatorXSessionProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveAttribute(
      "data-error-code",
      "TOSS_LOGIN_UNAVAILABLE",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Toss Login is not enabled");
    expect(screen.queryByRole("button", { name: "?ㅼ떆 ?쒕룄" })).toBeNull();
  });

  it("exchanges only the one-use code and referrer for CreatorX tokens after App-in-Toss login", async () => {
    const creatorXAccessToken = "creatorx-access-token";
    const creatorXRefreshToken = "creatorx-refresh-token";
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accessToken: creatorXAccessToken,
          refreshToken: creatorXRefreshToken,
          tokenType: "Bearer",
          expiresIn: 900,
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <CreatorXSessionProvider
        config={config({
          dataMode: "remote",
          apiBaseUrl: new URL("https://api.example.com"),
          tossLoginEnabled: true,
        })}
      >
        <SessionProbe />
      </CreatorXSessionProvider>,
    );

    await waitFor(() => expect(mocks.appLogin).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("session")).toHaveTextContent(
        '"status":"authenticated"',
      ),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/toss/exchange",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          authorizationCode: "single-use-authorization-code",
          referrer: "SANDBOX",
        }),
        credentials: "omit",
      },
    );
    expect(screen.getByTestId("session")).not.toHaveTextContent(
      creatorXAccessToken,
    );
    expect(screen.getByTestId("session")).not.toHaveTextContent(
      creatorXRefreshToken,
    );
    expect((mocks.dataClient as CreatorXDataClient).getPortfolio).not.toHaveBeenCalled();
  });

  it("keeps only CreatorX tokens in memory long enough to revoke the local Toss session", async () => {
    const creatorXAccessToken = "creatorx-access-token";
    const creatorXRefreshToken = "creatorx-refresh-token";
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accessToken: creatorXAccessToken,
            refreshToken: creatorXRefreshToken,
            tokenType: "Bearer",
            expiresIn: 900,
          }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <CreatorXSessionProvider
        config={config({
          dataMode: "remote",
          apiBaseUrl: new URL("https://api.example.com"),
          tossLoginEnabled: true,
        })}
      >
        <SessionProbe />
      </CreatorXSessionProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("session")).toHaveTextContent(
        '"status":"authenticated"',
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "sign out" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "https://api.example.com/api/auth/toss/unlink",
      {
        method: "POST",
        headers: { authorization: "Bearer creatorx-access-token" },
        credentials: "omit",
      },
    );
    await waitFor(() =>
      expect(screen.getByTestId("session")).toHaveTextContent(
        '"status":"unauthenticated"',
      ),
    );
    expect(screen.getByTestId("session")).not.toHaveTextContent(
      creatorXRefreshToken,
    );
  });

  it("completes the initial Toss Login under React StrictMode", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accessToken: "creatorx-access-token",
          refreshToken: "creatorx-refresh-token",
          tokenType: "Bearer",
          expiresIn: 900,
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <StrictMode>
        <CreatorXSessionProvider
          config={config({
            dataMode: "remote",
            apiBaseUrl: new URL("https://api.example.com"),
            tossLoginEnabled: true,
          })}
        >
          <SessionProbe />
        </CreatorXSessionProvider>
      </StrictMode>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("session")).toHaveTextContent(
        '"status":"authenticated"',
      ),
    );
  });

  it("throws when the normalized hook is used outside its provider", () => {
    expect(() => render(<SessionProbe />)).toThrow(
      "useCreatorXSession must be used within CreatorXSessionProvider",
    );
  });
});
