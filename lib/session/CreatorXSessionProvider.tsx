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

import {
  useCreatorXDataClient,
  useCreatorXDataRuntime,
} from "@/components/runtime/CreatorXDataProvider";
import { CreatorXClientError } from "@/lib/data/errors";
import type { CreatorXRuntimeConfig } from "@/lib/runtime/config";

export interface CreatorXSessionValue {
  status: "loading" | "authenticated" | "unauthenticated" | "error";
  subject: string | null;
  identityKind: "browser" | "anonymous-device" | "guest";
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
        balance: portfolio.balance,
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
          balance: portfolio.balance,
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
    return (
      <AuthenticatedBrowserSession
        subject={nextSession.data?.user?.id ?? null}
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

function RemoteGuestSessionAdapter({ children }: { children: ReactNode }) {
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

export function CreatorXSessionProvider({
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
    return <RemoteGuestSessionAdapter>{children}</RemoteGuestSessionAdapter>;
  }
  return <DemoSessionAdapter>{children}</DemoSessionAdapter>;
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
