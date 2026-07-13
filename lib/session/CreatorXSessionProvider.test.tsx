// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CreatorXSessionProvider,
  type CreatorXSessionValue,
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
  getUserKeyForGame: vi.fn(),
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
  getUserKeyForGame: mocks.getUserKeyForGame,
}));

const portfolio = (balance: number): Portfolio => ({
  balance: String(balance) as never,
  reservedBalance: "0" as never,
  availableBalance: String(balance) as never,
  positions: [],
  openOrders: [],
  executions: [],
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

function SessionProbe({
  onSession,
}: {
  onSession?: (session: CreatorXSessionValue) => void;
}) {
  const session = useCreatorXSession();
  useEffect(() => {
    onSession?.(session);
  }, [onSession, session]);
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

function requireSession(
  reference: { current: CreatorXSessionValue | null },
): CreatorXSessionValue {
  if (reference.current === null) {
    throw new Error("session probe did not report a session value");
  }
  return reference.current;
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
  mocks.getUserKeyForGame
    .mockReset()
    .mockResolvedValue({ type: "HASH", hash: "sandbox-game-user-key" });
  mocks.dataRuntime.subject = "device-subject";
  mocks.dataClient = clientWithPortfolio(vi.fn().mockResolvedValue(portfolio(2500)));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
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

    await waitFor(() =>
      expect(screen.getByTestId("session")).toHaveTextContent(
        '"status":"unauthenticated"',
      ),
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

  it.each(["sandbox", "development"] as const)(
    "creates a server-owned guest session in %s remote mode without calling Toss Login",
    async (releaseChannel) => {
    const creatorXAccessToken = "guest-access-token";
    const creatorXRefreshToken = "guest-refresh-token";
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
      <StrictMode>
        <CreatorXSessionProvider
          config={config({
            releaseChannel,
            dataMode: "remote",
            apiBaseUrl: new URL("https://api.example.com"),
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
    expect(screen.getByTestId("session")).toHaveTextContent(
      '"identityKind":"guest"',
    );
    expect(screen.getByTestId("session")).toHaveTextContent('"balance":2500');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/guest",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ anonymousKey: "sandbox-game-user-key" }),
        credentials: "same-origin",
        redirect: "error",
      },
    );
    expect(mocks.getUserKeyForGame).toHaveBeenCalledTimes(1);
    expect(mocks.appLogin).not.toHaveBeenCalled();
    expect(screen.getByTestId("session")).not.toHaveTextContent(
      creatorXAccessToken,
    );
    expect(screen.getByTestId("session")).not.toHaveTextContent(
      creatorXRefreshToken,
    );
    },
  );

  it("keeps a guest session signed out when guest issuance resolves after sign-out", async () => {
    const delayedGuest = Promise.withResolvers<Response>();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          accessToken: "guest-access-initial",
          refreshToken: "guest-refresh-initial",
          tokenType: "Bearer",
          expiresIn: 900,
        }),
      )
      .mockReturnValueOnce(delayedGuest.promise);
    vi.stubGlobal("fetch", fetchSpy);
    const latestSession = { current: null as CreatorXSessionValue | null };

    render(
      <CreatorXSessionProvider
        config={config({
          dataMode: "remote",
          apiBaseUrl: new URL("https://api.example.com"),
        })}
      >
        <SessionProbe onSession={(session) => { latestSession.current = session; }} />
      </CreatorXSessionProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("session")).toHaveTextContent(
        '"status":"authenticated"',
      ),
    );
    await requireSession(latestSession).signOut();
    await waitFor(() =>
      expect(screen.getByTestId("session")).toHaveTextContent(
        '"status":"unauthenticated"',
      ),
    );

    const refresh = requireSession(latestSession).refresh();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    await requireSession(latestSession).signOut();
    delayedGuest.resolve(
      Response.json({
        accessToken: "guest-access-stale",
        refreshToken: "guest-refresh-stale",
        tokenType: "Bearer",
        expiresIn: 900,
      }),
    );
    await refresh;

    await waitFor(() =>
      expect(screen.getByTestId("session")).toHaveTextContent(
        '"status":"unauthenticated"',
      ),
    );
    expect(window.localStorage.getItem("creatorx:session:refresh:v1")).toBeNull();
    expect(screen.getByTestId("session")).not.toHaveTextContent(
      "guest-access-stale",
    );
  });

  it("keeps production remote mode fail-closed when Toss Login is not verified", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <CreatorXSessionProvider
        config={config({
          releaseChannel: "production",
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
        credentials: "same-origin",
        redirect: "error",
      },
    );
    expect(screen.getByTestId("session")).not.toHaveTextContent(
      creatorXAccessToken,
    );
    expect(screen.getByTestId("session")).not.toHaveTextContent(
      creatorXRefreshToken,
    );
    await waitFor(() =>
      expect(
        (mocks.dataClient as CreatorXDataClient).getPortfolio,
      ).toHaveBeenCalledTimes(1),
    );
    expect(screen.getByTestId("session")).toHaveTextContent('"balance":2500');
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
        credentials: "same-origin",
        redirect: "error",
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

  it("keeps a Toss session signed out when exchange resolves after sign-out", async () => {
    const delayedExchange = Promise.withResolvers<Response>();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          accessToken: "toss-access-initial",
          refreshToken: "toss-refresh-initial",
          tokenType: "Bearer",
          expiresIn: 900,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockReturnValueOnce(delayedExchange.promise);
    vi.stubGlobal("fetch", fetchSpy);
    const latestSession = { current: null as CreatorXSessionValue | null };

    render(
      <CreatorXSessionProvider
        config={config({
          dataMode: "remote",
          apiBaseUrl: new URL("https://api.example.com"),
          tossLoginEnabled: true,
        })}
      >
        <SessionProbe onSession={(session) => { latestSession.current = session; }} />
      </CreatorXSessionProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("session")).toHaveTextContent(
        '"status":"authenticated"',
      ),
    );
    await requireSession(latestSession).signOut();
    await waitFor(() =>
      expect(screen.getByTestId("session")).toHaveTextContent(
        '"status":"unauthenticated"',
      ),
    );

    const refresh = requireSession(latestSession).refresh();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
    await requireSession(latestSession).signOut();
    delayedExchange.resolve(
      Response.json({
        accessToken: "toss-access-stale",
        refreshToken: "toss-refresh-stale",
        tokenType: "Bearer",
        expiresIn: 900,
      }),
    );
    await refresh;

    await waitFor(() =>
      expect(screen.getByTestId("session")).toHaveTextContent(
        '"status":"unauthenticated"',
      ),
    );
    expect(window.localStorage.getItem("creatorx:session:refresh:v1")).toBeNull();
    expect(screen.getByTestId("session")).not.toHaveTextContent(
      "toss-access-stale",
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

  it("rotates a persisted CreatorX refresh token before app login and never persists its access token", async () => {
    window.localStorage.setItem("creatorx:session:refresh:v1", "stored-refresh-token");
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accessToken: "rotated-access-token",
          refreshToken: "rotated-refresh-token",
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

    await waitFor(() =>
      expect(screen.getByTestId("session")).toHaveTextContent(
        '"status":"authenticated"',
      ),
    );
    expect(mocks.appLogin).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/guest/refresh",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    expect(window.localStorage.getItem("creatorx:session:refresh:v1")).toBe(
      "rotated-refresh-token",
    );
    expect(window.localStorage.getItem("creatorx:session:refresh:v1")).not.toContain(
      "rotated-access-token",
    );
    expect(screen.getByTestId("session")).not.toHaveTextContent(
      "rotated-access-token",
    );
  });

  it("throws when the normalized hook is used outside its provider", () => {
    expect(() => render(<SessionProbe />)).toThrow(
      "useCreatorXSession must be used within CreatorXSessionProvider",
    );
  });
});
