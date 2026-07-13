"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  SessionProvider,
  signOut as nextAuthSignOut,
  useSession,
} from "next-auth/react";
import { appLogin } from "@apps-in-toss/web-framework";

import {
  useCreatorXDataClient,
  useCreatorXDataRuntime,
} from "@/components/runtime/CreatorXDataProvider";
import { loadCreatorXBridge } from "@/lib/appintoss/bridge";
import { CreatorXSessionClient } from "@/lib/data/creatorx-session-client";
import { CreatorXClientError } from "@/lib/data/errors";
import { decimalToDisplayNumber } from "@/lib/data/decimal-display";
import { TossLoginClient } from "@/lib/data/toss-login-client";
import type { CreatorXRuntimeConfig } from "@/lib/runtime/config";
import {
  CreatorXTokenRuntimeProvider,
  useCreatorXTokenRuntime,
  useOptionalCreatorXTokenRuntime,
} from "@/lib/session/CreatorXTokenRuntime";

export interface CreatorXSessionValue {
  status: "loading" | "authenticated" | "unauthenticated" | "error";
  subject: string | null;
  identityKind: "browser" | "anonymous-device" | "guest" | "toss";
  balance: number;
  error: CreatorXClientError | null;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}

const CreatorXSessionContext = createContext<CreatorXSessionValue | undefined>(
  undefined,
);

type PortfolioState = {
  status: "loading" | "authenticated" | "error";
  balance: number;
  error: CreatorXClientError | null;
};

function normalizeSessionError(error: unknown): CreatorXClientError {
  if (error instanceof CreatorXClientError) return error;
  return new CreatorXClientError(
    "SESSION_UNAVAILABLE",
    "세션 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    true,
  );
}

function usePortfolioState(): PortfolioState & { refresh(): Promise<void> } {
  const client = useCreatorXDataClient();
  const [state, setState] = useState<PortfolioState>({
    status: "loading",
    balance: 0,
    error: null,
  });
  const latestRequest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++latestRequest.current;
    try {
      const portfolio = await client.getPortfolio();
      if (latestRequest.current !== request) return;
      setState({
        status: "authenticated",
        balance: decimalToDisplayNumber(portfolio.balance),
        error: null,
      });
    } catch (error) {
      if (latestRequest.current !== request) return;
      setState({ status: "error", balance: 0, error: normalizeSessionError(error) });
    }
  }, [client]);

  useEffect(() => {
    const request = ++latestRequest.current;
    void client.getPortfolio().then(
      (portfolio) => {
        if (latestRequest.current !== request) return;
        setState({
          status: "authenticated",
          balance: decimalToDisplayNumber(portfolio.balance),
          error: null,
        });
      },
      (error: unknown) => {
        if (latestRequest.current !== request) return;
        setState({
          status: "error",
          balance: 0,
          error: normalizeSessionError(error),
        });
      },
    );
    return () => {
      latestRequest.current += 1;
    };
  }, [client]);

  return useMemo(() => ({ ...state, refresh }), [refresh, state]);
}

function SessionBoundary({
  children,
  value,
}: {
  children: ReactNode;
  value: CreatorXSessionValue;
}) {
  let content = children;
  if (value.status === "loading") {
    content = <p role="status">CreatorX 세션을 불러오는 중입니다.</p>;
  } else if (value.status === "error") {
    content = (
      <section
        role="alert"
        aria-label={value.error?.userMessage}
        data-error-code={value.error?.code}
      >
        <p>{value.error?.userMessage}</p>
        {value.error?.retryable && (
          <button type="button" onClick={() => void value.refresh()}>
            다시 시도
          </button>
        )}
      </section>
    );
  }

  return (
    <CreatorXSessionContext.Provider value={value}>
      {content}
    </CreatorXSessionContext.Provider>
  );
}

function DemoSessionAdapter({ children }: { children: ReactNode }) {
  const { subject } = useCreatorXDataRuntime();
  const portfolio = usePortfolioState();
  const signOut = useCallback(async () => undefined, []);
  const value = useMemo<CreatorXSessionValue>(() => {
    if (subject === null) {
      return {
        status: "error",
        subject: null,
        identityKind: "anonymous-device",
        balance: 0,
        error: new CreatorXClientError(
          "SESSION_UNAVAILABLE",
          "기기 세션을 확인하지 못했습니다.",
          true,
        ),
        refresh: portfolio.refresh,
        signOut,
      };
    }
    return {
      status: portfolio.status,
      subject,
      identityKind: "anonymous-device",
      balance: portfolio.balance,
      error: portfolio.error,
      refresh: portfolio.refresh,
      signOut,
    };
  }, [portfolio, signOut, subject]);
  return <SessionBoundary value={value}>{children}</SessionBoundary>;
}

function AuthenticatedBrowserSession({
  children,
  subject,
  signOut,
}: {
  children: ReactNode;
  subject: string | null;
  signOut(): Promise<void>;
}) {
  const portfolio = usePortfolioState();
  const value = useMemo<CreatorXSessionValue>(
    () => ({
      status: portfolio.status,
      subject,
      identityKind: "browser",
      balance: portfolio.balance,
      error: portfolio.error,
      refresh: portfolio.refresh,
      signOut,
    }),
    [portfolio, signOut, subject],
  );
  return <SessionBoundary value={value}>{children}</SessionBoundary>;
}

function InactiveBrowserSession({
  children,
  status,
  signOut,
}: {
  children: ReactNode;
  status: "loading" | "unauthenticated";
  signOut(): Promise<void>;
}) {
  const refresh = useCallback(async () => undefined, []);
  const value = useMemo<CreatorXSessionValue>(
    () => ({
      status,
      subject: null,
      identityKind: "browser",
      balance: 0,
      error: null,
      refresh,
      signOut,
    }),
    [refresh, signOut, status],
  );
  return <SessionBoundary value={value}>{children}</SessionBoundary>;
}

function BrowserSessionAdapter({ children }: { children: ReactNode }) {
  const nextSession = useSession();
  const signOut = useCallback(async () => {
    await nextAuthSignOut();
  }, []);
  if (nextSession.status === "authenticated") {
    const subject = nextSession.data?.user?.id ?? null;
    return (
      <AuthenticatedBrowserSession
        key={subject ?? "missing-browser-subject"}
        subject={subject}
        signOut={signOut}
      >
        {children}
      </AuthenticatedBrowserSession>
    );
  }
  return (
    <InactiveBrowserSession status={nextSession.status} signOut={signOut}>
      {children}
    </InactiveBrowserSession>
  );
}

function BrowserSessionBranch({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <BrowserSessionAdapter>{children}</BrowserSessionAdapter>
    </SessionProvider>
  );
}

export function RemoteGuestSessionUnavailableAdapter({
  children,
}: {
  children: ReactNode;
}) {
  const error = useMemo(
    () =>
      new CreatorXClientError(
        "SESSION_UNAVAILABLE",
        "원격 게스트 세션은 서버 인증 연결 후 사용할 수 있습니다.",
        false,
      ),
    [],
  );
  const refresh = useCallback(async () => undefined, []);
  const signOut = useCallback(async () => undefined, []);
  const value = useMemo<CreatorXSessionValue>(
    () => ({
      status: "error",
      subject: null,
      identityKind: "guest",
      balance: 0,
      error,
      refresh,
      signOut,
    }),
    [error, refresh, signOut],
  );
  return <SessionBoundary value={value}>{children}</SessionBoundary>;
}

function guestSessionFailedError() {
  return new CreatorXClientError(
    "SESSION_UNAVAILABLE",
    "CreatorX guest session could not be completed. Please try again.",
    true,
  );
}

export function RemoteGuestSessionAdapter({
  children,
  config,
}: {
  children: ReactNode;
  config: CreatorXRuntimeConfig;
}) {
  const [state, setState] = useState<{
    status: "loading" | "authenticated" | "unauthenticated" | "error";
    balance: number;
    error: CreatorXClientError | null;
  }>({ status: "loading", balance: 0, error: null });
  const latestAttempt = useRef(0);
  const inFlightSession = useRef<Promise<void> | null>(null);
  const tokenRuntime = useCreatorXTokenRuntime();
  const dataClient = useCreatorXDataClient();
  const sessionClient = useMemo(
    () =>
      config.apiBaseUrl === null
        ? null
        : new CreatorXSessionClient({ baseUrl: config.apiBaseUrl }),
    [config.apiBaseUrl],
  );

  const establishAuthenticatedSession = useCallback(
    async (attempt: number) => {
      const portfolio = await dataClient.getPortfolio();
      if (latestAttempt.current !== attempt) return;
      setState({
        status: "authenticated",
        balance: decimalToDisplayNumber(portfolio.balance),
        error: null,
      });
    },
    [dataClient],
  );

  const refresh = useCallback(async () => {
    if (inFlightSession.current !== null) return inFlightSession.current;
    const attempt = ++latestAttempt.current;
    const work = (async () => {
      setState({ status: "loading", balance: 0, error: null });
      try {
        if (sessionClient === null) throw new Error("missing CreatorX API URL");
        if ((await tokenRuntime.getAccessToken()) !== null) {
          await establishAuthenticatedSession(attempt);
          return;
        }
        const restored = await tokenRuntime.restore();
        if (restored !== null) {
          await establishAuthenticatedSession(attempt);
          return;
        }
        const bridge = await loadCreatorXBridge();
        const tokens = await sessionClient.createGuest({
          anonymousKey: await bridge.getAnonymousSubject(),
        });
        if (latestAttempt.current !== attempt) return;
        await tokenRuntime.acceptTokens(tokens);
        if (latestAttempt.current !== attempt) return;
        await establishAuthenticatedSession(attempt);
      } catch (error) {
        if (latestAttempt.current !== attempt) return;
        setState({
          status: "error",
          balance: 0,
          error:
            error instanceof CreatorXClientError ? error : guestSessionFailedError(),
        });
      }
    })();
    inFlightSession.current = work;
    try {
      await work;
    } finally {
      if (inFlightSession.current === work) inFlightSession.current = null;
    }
  }, [establishAuthenticatedSession, sessionClient, tokenRuntime]);

  const signOut = useCallback(async () => {
    await tokenRuntime.clear();
    setState({ status: "unauthenticated", balance: 0, error: null });
  }, [tokenRuntime]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<CreatorXSessionValue>(
    () => ({
      status: state.status,
      subject: null,
      identityKind: "guest",
      balance: state.balance,
      error: state.error,
      refresh,
      signOut,
    }),
    [refresh, signOut, state],
  );
  return <SessionBoundary value={value}>{children}</SessionBoundary>;
}

function tossLoginUnavailableError() {
  return new CreatorXClientError(
    "TOSS_LOGIN_UNAVAILABLE",
    "Toss Login is not enabled. Complete Toss Business verification and configure the server mTLS certificate before enabling it.",
    false,
  );
}

function tossLoginFailedError() {
  return new CreatorXClientError(
    "SESSION_UNAVAILABLE",
    "Toss Login could not be completed. Please try again.",
    true,
  );
}

function DisabledTossLoginSession({ children }: { children: ReactNode }) {
  const refresh = useCallback(async () => undefined, []);
  const signOut = useCallback(async () => undefined, []);
  const error = useMemo(() => tossLoginUnavailableError(), []);
  const value = useMemo<CreatorXSessionValue>(
    () => ({
      status: "error",
      subject: null,
      identityKind: "toss",
      balance: 0,
      error,
      refresh,
      signOut,
    }),
    [error, refresh, signOut],
  );
  return <SessionBoundary value={value}>{children}</SessionBoundary>;
}

function isTossLoginResult(
  value: unknown,
): value is { authorizationCode: string; referrer: "DEFAULT" | "SANDBOX" } {
  return (
    typeof value === "object" &&
    value !== null &&
    "authorizationCode" in value &&
    typeof value.authorizationCode === "string" &&
    value.authorizationCode.trim().length > 0 &&
    "referrer" in value &&
    (value.referrer === "DEFAULT" || value.referrer === "SANDBOX")
  );
}

function EnabledTossLoginSession({
  children,
  config,
}: {
  children: ReactNode;
  config: CreatorXRuntimeConfig;
}) {
  const [state, setState] = useState<{
    status: "loading" | "authenticated" | "unauthenticated" | "error";
    balance: number;
    error: CreatorXClientError | null;
  }>({ status: "loading", balance: 0, error: null });
  const latestAttempt = useRef(0);
  const inFlightLogin = useRef<Promise<void> | null>(null);
  const tokenRuntime = useCreatorXTokenRuntime();
  const dataClient = useCreatorXDataClient();
  const tossLoginClient = useMemo(
    () =>
      config.apiBaseUrl === null
        ? null
        : new TossLoginClient({ baseUrl: config.apiBaseUrl }),
    [config.apiBaseUrl],
  );

  const establishAuthenticatedSession = useCallback(
    async (attempt: number) => {
      const portfolio = await dataClient.getPortfolio();
      if (latestAttempt.current !== attempt) return;
      setState({
        status: "authenticated",
        balance: decimalToDisplayNumber(portfolio.balance),
        error: null,
      });
    },
    [dataClient],
  );

  const refresh = useCallback(async () => {
    if (inFlightLogin.current !== null) return inFlightLogin.current;
    const attempt = ++latestAttempt.current;
    const work = (async () => {
      setState({ status: "loading", balance: 0, error: null });
      try {
        if (tossLoginClient === null) throw new Error("missing CreatorX API URL");
        if ((await tokenRuntime.getAccessToken()) !== null) {
          await establishAuthenticatedSession(attempt);
          return;
        }
        const restored = await tokenRuntime.restore();
        if (restored !== null) {
          await establishAuthenticatedSession(attempt);
          return;
        }
        const login = await appLogin();
        if (!isTossLoginResult(login)) throw new Error("invalid Toss Login response");
        const parsed = await tossLoginClient.exchange(login);
        if (latestAttempt.current !== attempt) return;
        await tokenRuntime.acceptTokens(parsed);
        if (latestAttempt.current !== attempt) return;
        await establishAuthenticatedSession(attempt);
      } catch (error) {
        if (latestAttempt.current !== attempt) return;
        setState({
          status: "error",
          balance: 0,
          error:
            error instanceof CreatorXClientError &&
            error.code === "TOSS_LOGIN_UNAVAILABLE"
              ? tossLoginUnavailableError()
              : tossLoginFailedError(),
        });
      }
    })();
    inFlightLogin.current = work;
    try {
      await work;
    } finally {
      if (inFlightLogin.current === work) inFlightLogin.current = null;
    }
  }, [establishAuthenticatedSession, tokenRuntime, tossLoginClient]);

  const signOut = useCallback(async () => {
    const accessToken = await tokenRuntime.getAccessToken();
    try {
      if (accessToken !== null && tossLoginClient !== null) {
        await tossLoginClient.unlink(accessToken);
      }
    } finally {
      await tokenRuntime.clear();
      setState({ status: "unauthenticated", balance: 0, error: null });
    }
  }, [tokenRuntime, tossLoginClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<CreatorXSessionValue>(
    () => ({
      status: state.status,
      subject: null,
      identityKind: "toss",
      balance: state.balance,
      error: state.error,
      refresh,
      signOut,
    }),
    [refresh, signOut, state],
  );
  return <SessionBoundary value={value}>{children}</SessionBoundary>;
}

function RemoteTossLoginSessionAdapter({
  children,
  config,
}: {
  children: ReactNode;
  config: CreatorXRuntimeConfig;
}) {
  if (!config.tossLoginEnabled) {
    return <DisabledTossLoginSession>{children}</DisabledTossLoginSession>;
  }
  return <EnabledTossLoginSession config={config}>{children}</EnabledTossLoginSession>;
}

function CreatorXSessionBranch({
  children,
  config,
}: {
  children: ReactNode;
  config: CreatorXRuntimeConfig;
}) {
  if (!config.appInToss) {
    return <BrowserSessionBranch>{children}</BrowserSessionBranch>;
  }
  if (config.dataMode === "remote") {
    if (!config.tossLoginEnabled && config.releaseChannel !== "production") {
      return (
        <RemoteGuestSessionAdapter config={config}>
          {children}
        </RemoteGuestSessionAdapter>
      );
    }
    return (
      <RemoteTossLoginSessionAdapter config={config}>
        {children}
      </RemoteTossLoginSessionAdapter>
    );
  }
  return <DemoSessionAdapter>{children}</DemoSessionAdapter>;
}

export function CreatorXSessionProvider({
  children,
  config,
}: {
  children: ReactNode;
  config: CreatorXRuntimeConfig;
}) {
  const tokenRuntime = useOptionalCreatorXTokenRuntime();
  if (tokenRuntime !== null) {
    return <CreatorXSessionBranch config={config}>{children}</CreatorXSessionBranch>;
  }
  return (
    <CreatorXTokenRuntimeProvider config={config}>
      <CreatorXSessionBranch config={config}>{children}</CreatorXSessionBranch>
    </CreatorXTokenRuntimeProvider>
  );
}

export function useCreatorXSession(): CreatorXSessionValue {
  const value = useContext(CreatorXSessionContext);
  if (value === undefined) {
    throw new Error(
      "useCreatorXSession must be used within CreatorXSessionProvider",
    );
  }
  return value;
}
