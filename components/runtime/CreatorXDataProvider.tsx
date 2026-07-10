"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { CreatorXDataClient } from "@/lib/data/contracts";
import {
  DemoDataClient,
  type DemoDataClientDependencies,
} from "@/lib/data/demo-client";
import { CreatorXClientError } from "@/lib/data/errors";
import {
  RemoteDataClient,
  type RemoteDataClientOptions,
} from "@/lib/data/remote-client";
import type { CreatorXRuntimeConfig } from "@/lib/runtime/config";
import type { AsyncKeyValueStore } from "@/lib/storage/client-storage";

const BROWSER_DEMO_SUBJECT = "browser-demo-user";

type AnonymousKeyResult = unknown;
type MaybePromise<T> = T | Promise<T>;

export type CreatorXDataProviderDependencies = {
  createDemoClient?: (
    dependencies: DemoDataClientDependencies,
  ) => CreatorXDataClient;
  createRemoteClient?: (
    options: RemoteDataClientOptions,
  ) => CreatorXDataClient;
  loadBrowserStorage?: () => MaybePromise<AsyncKeyValueStore>;
  loadNativeStorage?: () => Promise<AsyncKeyValueStore>;
  getAnonymousKey?: () => Promise<AnonymousKeyResult>;
  getBrowserOrigin?: () => string | null;
  getAccessToken?: () => Promise<string | null>;
};

export type CreatorXDataRuntimeValue = {
  client: CreatorXDataClient | null;
  subject: string | null;
  status: "loading" | "ready" | "error";
  error: CreatorXClientError | null;
  retry: () => void;
};

type BootstrapResult = {
  client: CreatorXDataClient;
  subject: string | null;
};

type DataRuntimeConfig = Pick<
  CreatorXRuntimeConfig,
  "appInToss" | "releaseChannel" | "dataMode" | "apiBaseUrl"
>;

type BootstrapState = Omit<CreatorXDataRuntimeValue, "retry"> & {
  configKey: string;
};

const CreatorXDataContext = createContext<CreatorXDataRuntimeValue | undefined>(
  undefined,
);

function configKey(config: DataRuntimeConfig): string {
  return [
    config.appInToss ? "toss" : "browser",
    config.releaseChannel,
    config.dataMode,
    config.apiBaseUrl?.toString() ?? "none",
  ].join(":");
}

function loadingState(key: string): BootstrapState {
  return {
    configKey: key,
    client: null,
    subject: null,
    status: "loading",
    error: null,
  };
}

function configurationError(message: string): CreatorXClientError {
  return new CreatorXClientError("CONFIG_INVALID", message, true);
}

function storageError(): CreatorXClientError {
  return new CreatorXClientError(
    "STORAGE_UNAVAILABLE",
    "저장소를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    true,
  );
}

function sessionError(): CreatorXClientError {
  return new CreatorXClientError(
    "SESSION_UNAVAILABLE",
    "기기 세션을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    true,
  );
}

function readAnonymousSubject(value: AnonymousKeyResult): string | null {
  if (typeof value !== "object" || value === null || !("hash" in value)) {
    return null;
  }
  const hash = value.hash;
  if (typeof hash !== "string" || hash.trim() === "") return null;
  return hash.trim();
}

function abortError(): Error {
  const error = new Error("CreatorX data bootstrap was aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function normalizeBootstrapError(error: unknown): CreatorXClientError {
  if (error instanceof CreatorXClientError) return error;
  return new CreatorXClientError(
    "INVALID_RESPONSE",
    "앱 데이터를 준비할 수 없습니다. 다시 시도해 주세요.",
    true,
  );
}

function defaultBrowserOrigin(): string | null {
  return typeof window === "undefined" ? null : window.location.origin;
}

function defaultBrowserStorage(): AsyncKeyValueStore {
  if (typeof window === "undefined") throw storageError();
  return {
    async getItem(key) {
      return window.localStorage.getItem(key);
    },
    async setItem(key, value) {
      window.localStorage.setItem(key, value);
    },
    async removeItem(key) {
      window.localStorage.removeItem(key);
    },
  };
}

async function defaultNativeStorage(): Promise<AsyncKeyValueStore> {
  const sdk = await import("@apps-in-toss/web-framework");
  sdk.getAppsInTossGlobals();
  return {
    async getItem(key) {
      return await sdk.Storage.getItem(key);
    },
    async setItem(key, value) {
      await sdk.Storage.setItem(key, value);
    },
    async removeItem(key) {
      await sdk.Storage.removeItem(key);
    },
  };
}

async function defaultAnonymousKey(): Promise<AnonymousKeyResult> {
  const { getAnonymousKey } = await import("@apps-in-toss/web-framework");
  return await getAnonymousKey();
}

async function bootstrapDemo(
  config: DataRuntimeConfig,
  dependencies: CreatorXDataProviderDependencies,
  signal: AbortSignal,
): Promise<BootstrapResult> {
  const createDemoClient =
    dependencies.createDemoClient ??
    ((value: DemoDataClientDependencies) => new DemoDataClient(value));

  if (!config.appInToss) {
    let store: AsyncKeyValueStore;
    try {
      store = await (dependencies.loadBrowserStorage ?? defaultBrowserStorage)();
    } catch (error) {
      if (error instanceof CreatorXClientError) throw error;
      throw storageError();
    }
    throwIfAborted(signal);
    return {
      client: createDemoClient({
        store,
        namespace: BROWSER_DEMO_SUBJECT,
      }),
      subject: BROWSER_DEMO_SUBJECT,
    };
  }

  let store: AsyncKeyValueStore;
  try {
    store = await (dependencies.loadNativeStorage ?? defaultNativeStorage)();
  } catch (error) {
    if (error instanceof CreatorXClientError) throw error;
    throw storageError();
  }
  throwIfAborted(signal);

  let anonymousKey: AnonymousKeyResult;
  try {
    anonymousKey = await (
      dependencies.getAnonymousKey ?? defaultAnonymousKey
    )();
  } catch {
    throw sessionError();
  }
  throwIfAborted(signal);

  const subject = readAnonymousSubject(anonymousKey);
  if (subject === null) throw sessionError();
  throwIfAborted(signal);
  return {
    client: createDemoClient({ store, namespace: subject }),
    subject,
  };
}

async function bootstrapRemote(
  config: DataRuntimeConfig,
  dependencies: CreatorXDataProviderDependencies,
  signal: AbortSignal,
): Promise<BootstrapResult> {
  let baseUrl: URL;
  if (config.appInToss) {
    if (config.apiBaseUrl === null) {
      throw configurationError(
        "App-in-Toss 원격 모드에는 절대 API 주소가 필요합니다.",
      );
    }
    baseUrl = new URL(config.apiBaseUrl.toString());
  } else {
    const origin = (dependencies.getBrowserOrigin ?? defaultBrowserOrigin)();
    if (origin === null) {
      throw configurationError("브라우저 API 주소를 확인할 수 없습니다.");
    }
    try {
      baseUrl = new URL(origin);
    } catch {
      throw configurationError("브라우저 API 주소가 올바르지 않습니다.");
    }
  }
  throwIfAborted(signal);

  const createRemoteClient =
    dependencies.createRemoteClient ??
    ((options: RemoteDataClientOptions) => new RemoteDataClient(options));
  return {
    client: createRemoteClient({
      baseUrl,
      getAccessToken: dependencies.getAccessToken,
    }),
    subject: null,
  };
}

async function bootstrap(
  config: DataRuntimeConfig,
  dependencies: CreatorXDataProviderDependencies,
  signal: AbortSignal,
): Promise<BootstrapResult> {
  return config.dataMode === "demo"
    ? await bootstrapDemo(config, dependencies, signal)
    : await bootstrapRemote(config, dependencies, signal);
}

export function CreatorXDataProvider({
  children,
  config,
  dependencies = {},
}: {
  children: ReactNode;
  config: CreatorXRuntimeConfig;
  dependencies?: CreatorXDataProviderDependencies;
}) {
  const apiBaseUrlValue = config.apiBaseUrl?.toString() ?? null;
  const bootstrapConfig = useMemo<DataRuntimeConfig>(
    () => ({
      appInToss: config.appInToss,
      releaseChannel: config.releaseChannel,
      dataMode: config.dataMode,
      apiBaseUrl:
        apiBaseUrlValue === null ? null : new URL(apiBaseUrlValue),
    }),
    [
      apiBaseUrlValue,
      config.appInToss,
      config.dataMode,
      config.releaseChannel,
    ],
  );
  const key = configKey(bootstrapConfig);
  const [bootstrapDependencies] = useState<CreatorXDataProviderDependencies>(
    () => dependencies,
  );
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<BootstrapState>(() => loadingState(key));
  const currentState = state.configKey === key ? state : loadingState(key);

  const retry = useCallback(() => {
    setState(loadingState(key));
    setAttempt((value) => value + 1);
  }, [key]);

  useEffect(() => {
    const controller = new AbortController();
    void bootstrap(
      bootstrapConfig,
      bootstrapDependencies,
      controller.signal,
    ).then(
      (result) => {
        if (controller.signal.aborted) return;
        setState({
          configKey: key,
          client: result.client,
          subject: result.subject,
          status: "ready",
          error: null,
        });
      },
      (error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          return;
        }
        setState({
          configKey: key,
          client: null,
          subject: null,
          status: "error",
          error: normalizeBootstrapError(error),
        });
      },
    );

    return () => controller.abort();
  }, [
    attempt,
    bootstrapConfig,
    bootstrapDependencies,
    key,
  ]);

  const value = useMemo<CreatorXDataRuntimeValue>(
    () => ({
      client: currentState.client,
      subject: currentState.subject,
      status: currentState.status,
      error: currentState.error,
      retry,
    }),
    [currentState, retry],
  );

  let content: ReactNode;
  if (currentState.status === "loading") {
    content = <p role="status">CreatorX 데이터를 불러오는 중입니다.</p>;
  } else if (currentState.status === "error") {
    content = (
      <section role="alert" data-error-code={currentState.error?.code}>
        <p>{currentState.error?.userMessage}</p>
        <button type="button" onClick={retry}>
          다시 시도
        </button>
      </section>
    );
  } else {
    content = children;
  }

  return (
    <CreatorXDataContext.Provider value={value}>
      {content}
    </CreatorXDataContext.Provider>
  );
}

export function useCreatorXDataRuntime(): CreatorXDataRuntimeValue {
  const value = useContext(CreatorXDataContext);
  if (value === undefined) {
    throw new Error(
      "useCreatorXDataRuntime must be used within CreatorXDataProvider",
    );
  }
  return value;
}

export function useCreatorXDataClient(): CreatorXDataClient {
  const value = useContext(CreatorXDataContext);
  if (value === undefined) {
    throw new Error(
      "useCreatorXDataClient must be used within CreatorXDataProvider",
    );
  }
  if (value.client === null) {
    throw new Error("CreatorX data client is not ready");
  }
  return value.client;
}
