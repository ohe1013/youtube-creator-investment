"use client";

import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";

import {
  creatorXSessionTokensSchema,
  type CreatorXSessionTokens,
} from "@/lib/contracts/session";
import { CreatorXSessionClient } from "@/lib/data/creatorx-session-client";
import { CreatorXClientError } from "@/lib/data/errors";
import type { CreatorXRuntimeConfig } from "@/lib/runtime/config";
import { createClientStorage, type AsyncKeyValueStore } from "@/lib/storage/client-storage";

const REFRESH_STORAGE_KEY = "creatorx:session:refresh:v1";

export type CreatorXTokenRuntime = {
  getAccessToken(): Promise<string | null>;
  refreshAccessToken(failedAccessToken: string): Promise<string | null>;
  restore(): Promise<string | null>;
  acceptTokens(tokens: CreatorXSessionTokens): Promise<void>;
  clear(): Promise<void>;
};

const CreatorXTokenRuntimeContext = createContext<CreatorXTokenRuntime | null>(
  null,
);

function sessionUnavailable(): CreatorXClientError {
  return new CreatorXClientError(
    "SESSION_UNAVAILABLE",
    "CreatorX session could not be refreshed. Please sign in again.",
    true,
  );
}

function browserStorage(): AsyncKeyValueStore {
  if (typeof window === "undefined") throw sessionUnavailable();
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

async function nativeStorage(): Promise<AsyncKeyValueStore> {
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

function TokenRuntimeProviderContent({
  children,
  config,
}: {
  children: ReactNode;
  config: CreatorXRuntimeConfig;
}) {
  const accessToken = useRef<string | null>(null);
  const storage = useRef<Promise<AsyncKeyValueStore> | null>(null);
  const refreshFlight = useRef<Promise<string | null> | null>(null);
  const apiBaseUrl = config.apiBaseUrl?.toString() ?? null;

  const runtime = useMemo<CreatorXTokenRuntime>(() => {
    const getStorage = () => {
      storage.current ??= createClientStorage({
        releaseChannel: config.releaseChannel,
        browser: browserStorage(),
        loadNative: nativeStorage,
      });
      return storage.current;
    };

    const clear = async () => {
      accessToken.current = null;
      try {
        await (await getStorage()).removeItem(REFRESH_STORAGE_KEY);
      } catch {
        // A failed cleanup must never leave the access token available in memory.
      }
    };

    const rotate = async (): Promise<string | null> => {
      try {
        const activeBaseUrl = apiBaseUrl === null ? null : new URL(apiBaseUrl);
        if (activeBaseUrl === null) throw sessionUnavailable();
        const sessionClient = new CreatorXSessionClient({ baseUrl: activeBaseUrl });

        const store = await getStorage();
        const refreshToken = await store.getItem(REFRESH_STORAGE_KEY);
        if (refreshToken === null || refreshToken.trim() === "") {
          accessToken.current = null;
          return null;
        }

        const parsed = await sessionClient.refresh({ refreshToken });

        // Persist rotation before making the corresponding access token usable.
        await store.setItem(REFRESH_STORAGE_KEY, parsed.refreshToken);
        accessToken.current = parsed.accessToken;
        return parsed.accessToken;
      } catch (error) {
        await clear();
        if (error instanceof CreatorXClientError) throw error;
        throw sessionUnavailable();
      }
    };

    const runRefresh = () => {
      refreshFlight.current ??= rotate().finally(() => {
        refreshFlight.current = null;
      });
      return refreshFlight.current;
    };

    return {
      async getAccessToken() {
        return accessToken.current;
      },
      async refreshAccessToken(failedAccessToken) {
        if (accessToken.current !== failedAccessToken) return accessToken.current;
        return await runRefresh();
      },
      async restore() {
        if (accessToken.current !== null) return accessToken.current;
        return await runRefresh();
      },
      async acceptTokens(tokens) {
        const parsed = creatorXSessionTokensSchema.parse(tokens);
        await (await getStorage()).setItem(
          REFRESH_STORAGE_KEY,
          parsed.refreshToken,
        );
        accessToken.current = parsed.accessToken;
      },
      clear,
    };
  }, [apiBaseUrl, config.releaseChannel]);

  return (
    <CreatorXTokenRuntimeContext.Provider value={runtime}>
      {children}
    </CreatorXTokenRuntimeContext.Provider>
  );
}

export function CreatorXTokenRuntimeProvider({
  children,
  config,
}: {
  children: ReactNode;
  config: CreatorXRuntimeConfig;
}) {
  return (
    <TokenRuntimeProviderContent config={config}>
      {children}
    </TokenRuntimeProviderContent>
  );
}

export function useCreatorXTokenRuntime(): CreatorXTokenRuntime {
  const runtime = useContext(CreatorXTokenRuntimeContext);
  if (runtime === null) {
    throw new Error(
      "useCreatorXTokenRuntime must be used within CreatorXTokenRuntimeProvider",
    );
  }
  return runtime;
}

export function useOptionalCreatorXTokenRuntime(): CreatorXTokenRuntime | null {
  return useContext(CreatorXTokenRuntimeContext);
}
