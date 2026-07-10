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
import {
  createPersistentOrderAttemptStore,
  type OrderAttemptStore,
} from "@/lib/orders/order-attempt-store";
import type { CreatorXRuntimeConfig } from "@/lib/runtime/config";
import {
  createClientStorage,
  type AsyncKeyValueStore,
  type KeyValueStorageBackend,
} from "@/lib/storage/client-storage";

const BROWSER_DEMO_SUBJECT = "browser-demo-user";

type NativeSubjectResult = unknown;
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
  getGameUserKey?: () => Promise<NativeSubjectResult>;
  getBrowserOrigin?: () => string | null;
  getAccessToken?: () => Promise<string | null>;
};

export type CreatorXDataRuntimeValue = {
  client: CreatorXDataClient | null;
  orderAttemptStore: OrderAttemptStore | null;
  subject: string | null;
  status: "loading" | "ready" | "error";
  error: CreatorXClientError | null;
  retry: () => void;
};

type DataRuntimeConfig = Pick<
  CreatorXRuntimeConfig,
  "appInToss" | "releaseChannel" | "dataMode" | "apiBaseUrl"
>;

type ResolvedDependencies = {
  createDemoClient: (
    dependencies: DemoDataClientDependencies,
  ) => CreatorXDataClient;
  createRemoteClient: (
    options: RemoteDataClientOptions,
  ) => CreatorXDataClient;
  loadBrowserStorage: () => MaybePromise<AsyncKeyValueStore>;
  loadNativeStorage: () => Promise<AsyncKeyValueStore>;
  getGameUserKey: () => Promise<NativeSubjectResult>;
  getBrowserOrigin: () => string | null;
  getAccessToken: (() => Promise<string | null>) | undefined;
};

type BootstrapDescriptor = {
  config: DataRuntimeConfig;
  dependencies: ResolvedDependencies;
};

type BootstrapResult = {
  client: CreatorXDataClient;
  orderAttemptStore: OrderAttemptStore | null;
  subject: string | null;
};

type BootstrapState = Omit<CreatorXDataRuntimeValue, "retry"> & {
  descriptor: BootstrapDescriptor;
};

type PendingBootstrap = {
  descriptor: BootstrapDescriptor;
  attempt: number;
  controller: AbortController;
  promise: Promise<BootstrapResult>;
  subscribers: number;
  settled: boolean;
};

type BootstrapCache = { current: PendingBootstrap | null };

type BootstrapSubscription = {
  promise: Promise<BootstrapResult>;
  release(): void;
};

type LazyBrowserStorage = KeyValueStorageBackend & {
  load(): Promise<AsyncKeyValueStore>;
};

const CreatorXDataContext = createContext<CreatorXDataRuntimeValue | undefined>(
  undefined,
);

function defaultCreateDemoClient(
  dependencies: DemoDataClientDependencies,
): CreatorXDataClient {
  return new DemoDataClient(dependencies);
}

function defaultCreateRemoteClient(
  options: RemoteDataClientOptions,
): CreatorXDataClient {
  return new RemoteDataClient(options);
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

function abortError(): Error {
  const error = new Error("CreatorX data bootstrap was aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error && signal.reason.name === "AbortError") {
    throw signal.reason;
  }
  throw abortError();
}

function normalizeBootstrapError(error: unknown): CreatorXClientError {
  if (error instanceof CreatorXClientError) return error;
  return new CreatorXClientError(
    "INVALID_RESPONSE",
    "앱 데이터를 준비할 수 없습니다. 다시 시도해 주세요.",
    true,
  );
}

function readGameSubject(value: NativeSubjectResult): string | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    value.type !== "HASH" ||
    !("hash" in value)
  ) {
    return null;
  }
  const hash = value.hash;
  if (typeof hash !== "string" || hash.trim() === "") return null;
  return hash.trim();
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

async function defaultGameUserKey(): Promise<NativeSubjectResult> {
  const { getUserKeyForGame } = await import("@apps-in-toss/web-framework");
  return await getUserKeyForGame();
}

function createLazyBrowserStorage(
  loader: () => MaybePromise<AsyncKeyValueStore>,
): LazyBrowserStorage {
  let storePromise: Promise<AsyncKeyValueStore> | null = null;
  const load = () => {
    storePromise ??= Promise.resolve().then(loader);
    return storePromise;
  };
  return {
    load,
    async getItem(key) {
      return await (await load()).getItem(key);
    },
    async setItem(key, value) {
      await (await load()).setItem(key, value);
    },
    async removeItem(key) {
      await (await load()).removeItem(key);
    },
  };
}

async function selectAppInTossStorage(
  config: DataRuntimeConfig,
  dependencies: ResolvedDependencies,
  signal: AbortSignal,
): Promise<AsyncKeyValueStore> {
  const browser = createLazyBrowserStorage(dependencies.loadBrowserStorage);
  let nativeSelected = false;
  const store = await createClientStorage({
    releaseChannel: config.releaseChannel,
    browser,
    loadNative: async () => {
      const native = await dependencies.loadNativeStorage();
      throwIfAborted(signal);
      nativeSelected = true;
      return native;
    },
  });
  throwIfAborted(signal);
  if (!nativeSelected) await browser.load();
  throwIfAborted(signal);
  return store;
}

async function bootstrapDemo(
  descriptor: BootstrapDescriptor,
  signal: AbortSignal,
): Promise<BootstrapResult> {
  const { config, dependencies } = descriptor;
  if (!config.appInToss) {
    let store: AsyncKeyValueStore;
    try {
      store = await dependencies.loadBrowserStorage();
    } catch (error) {
      throwIfAborted(signal);
      if (error instanceof CreatorXClientError) throw error;
      throw storageError();
    }
    throwIfAborted(signal);
    return {
      client: dependencies.createDemoClient({
        store,
        namespace: BROWSER_DEMO_SUBJECT,
      }),
      orderAttemptStore: createPersistentOrderAttemptStore(
        store,
        BROWSER_DEMO_SUBJECT,
      ),
      subject: BROWSER_DEMO_SUBJECT,
    };
  }

  let store: AsyncKeyValueStore;
  try {
    store = await selectAppInTossStorage(config, dependencies, signal);
  } catch (error) {
    throwIfAborted(signal);
    if (error instanceof CreatorXClientError) throw error;
    throw storageError();
  }

  let gameUserKey: NativeSubjectResult;
  try {
    gameUserKey = await dependencies.getGameUserKey();
  } catch {
    throwIfAborted(signal);
    throw sessionError();
  }
  throwIfAborted(signal);

  const subject = readGameSubject(gameUserKey);
  if (subject === null) throw sessionError();
  return {
    client: dependencies.createDemoClient({ store, namespace: subject }),
    orderAttemptStore: createPersistentOrderAttemptStore(store, subject),
    subject,
  };
}

async function bootstrapRemote(
  descriptor: BootstrapDescriptor,
  signal: AbortSignal,
): Promise<BootstrapResult> {
  const { config, dependencies } = descriptor;
  let baseUrl: URL;
  if (config.appInToss) {
    if (config.apiBaseUrl === null) {
      throw configurationError(
        "App-in-Toss 원격 모드에는 절대 API 주소가 필요합니다.",
      );
    }
    baseUrl = new URL(config.apiBaseUrl.toString());
  } else {
    const origin = dependencies.getBrowserOrigin();
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
  return {
    client: dependencies.createRemoteClient({
      baseUrl,
      getAccessToken: dependencies.getAccessToken,
    }),
    orderAttemptStore: null,
    subject: null,
  };
}

async function bootstrap(
  descriptor: BootstrapDescriptor,
  signal: AbortSignal,
): Promise<BootstrapResult> {
  return descriptor.config.dataMode === "demo"
    ? await bootstrapDemo(descriptor, signal)
    : await bootstrapRemote(descriptor, signal);
}

function loadingState(descriptor: BootstrapDescriptor): BootstrapState {
  return {
    descriptor,
    client: null,
    orderAttemptStore: null,
    subject: null,
    status: "loading",
    error: null,
  };
}

function sameRequest(
  pending: PendingBootstrap,
  descriptor: BootstrapDescriptor,
  attempt: number,
): boolean {
  return pending.descriptor === descriptor && pending.attempt === attempt;
}

function startPendingBootstrap(
  cache: BootstrapCache,
  descriptor: BootstrapDescriptor,
  attempt: number,
): PendingBootstrap {
  const controller = new AbortController();
  const pending: PendingBootstrap = {
    descriptor,
    attempt,
    controller,
    promise: bootstrap(descriptor, controller.signal),
    subscribers: 0,
    settled: false,
  };
  cache.current = pending;
  void pending.promise.then(
    () => {
      pending.settled = true;
    },
    () => {
      pending.settled = true;
      if (cache.current === pending) cache.current = null;
    },
  );
  return pending;
}

function acquireBootstrap(
  cache: BootstrapCache,
  descriptor: BootstrapDescriptor,
  attempt: number,
): BootstrapSubscription {
  let pending = cache.current;
  if (pending && !sameRequest(pending, descriptor, attempt)) {
    if (!pending.settled) pending.controller.abort();
    cache.current = null;
    pending = null;
  }
  pending ??= startPendingBootstrap(cache, descriptor, attempt);
  pending.subscribers += 1;
  let released = false;

  return {
    promise: pending.promise,
    release() {
      if (released) return;
      released = true;
      pending.subscribers -= 1;
      queueMicrotask(() => {
        if (cache.current !== pending || pending.subscribers !== 0) return;
        if (!pending.settled) pending.controller.abort();
        cache.current = null;
      });
    },
  };
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
  const {
    createDemoClient = defaultCreateDemoClient,
    createRemoteClient = defaultCreateRemoteClient,
    loadBrowserStorage = defaultBrowserStorage,
    loadNativeStorage = defaultNativeStorage,
    getGameUserKey = defaultGameUserKey,
    getBrowserOrigin = defaultBrowserOrigin,
    getAccessToken,
  } = dependencies;
  const resolvedDependencies = useMemo<ResolvedDependencies>(
    () => ({
      createDemoClient,
      createRemoteClient,
      loadBrowserStorage,
      loadNativeStorage,
      getGameUserKey,
      getBrowserOrigin,
      getAccessToken,
    }),
    [
      createDemoClient,
      createRemoteClient,
      getAccessToken,
      getBrowserOrigin,
      getGameUserKey,
      loadBrowserStorage,
      loadNativeStorage,
    ],
  );
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
  const descriptor = useMemo<BootstrapDescriptor>(
    () => ({ config: bootstrapConfig, dependencies: resolvedDependencies }),
    [bootstrapConfig, resolvedDependencies],
  );
  const [cache] = useState<BootstrapCache>(() => ({ current: null }));
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<BootstrapState>(() =>
    loadingState(descriptor),
  );
  const currentState =
    state.descriptor === descriptor ? state : loadingState(descriptor);

  const retry = useCallback(() => {
    setState(loadingState(descriptor));
    setAttempt((value) => value + 1);
  }, [descriptor]);

  useEffect(() => {
    const subscription = acquireBootstrap(cache, descriptor, attempt);
    let active = true;
    void subscription.promise.then(
      (result) => {
        if (!active) return;
        setState({
          descriptor,
          client: result.client,
          orderAttemptStore: result.orderAttemptStore,
          subject: result.subject,
          status: "ready",
          error: null,
        });
      },
      (error: unknown) => {
        if (
          !active ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          return;
        }
        setState({
          descriptor,
          client: null,
          orderAttemptStore: null,
          subject: null,
          status: "error",
          error: normalizeBootstrapError(error),
        });
      },
    );

    return () => {
      active = false;
      subscription.release();
    };
  }, [attempt, cache, descriptor]);

  const value = useMemo<CreatorXDataRuntimeValue>(
    () => ({
      client: currentState.client,
      orderAttemptStore: currentState.orderAttemptStore,
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

export function useCreatorXOrderAttemptStore(): OrderAttemptStore | null {
  const value = useContext(CreatorXDataContext);
  if (value === undefined) {
    throw new Error(
      "useCreatorXOrderAttemptStore must be used within CreatorXDataProvider",
    );
  }
  return value.orderAttemptStore;
}
