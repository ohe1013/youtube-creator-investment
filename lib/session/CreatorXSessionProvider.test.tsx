// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("exposes App-in-Toss remote mode as an unauthenticated guest error", async () => {
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
      "SESSION_UNAVAILABLE",
    );
    expect(screen.queryByRole("button", { name: "다시 시도" })).toBeNull();
    expect((mocks.dataClient as CreatorXDataClient).getPortfolio).not.toHaveBeenCalled();
    expect(mocks.useSession).not.toHaveBeenCalled();
  });

  it("throws when the normalized hook is used outside its provider", () => {
    expect(() => render(<SessionProbe />)).toThrow(
      "useCreatorXSession must be used within CreatorXSessionProvider",
    );
  });
});
