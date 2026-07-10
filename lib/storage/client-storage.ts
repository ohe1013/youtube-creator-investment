import { CreatorXClientError } from "@/lib/data/errors";
import type { CreatorXRuntimeConfig } from "@/lib/runtime/config";

export interface AsyncKeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

type MaybePromise<T> = T | Promise<T>;

export interface KeyValueStorageBackend {
  getItem(key: string): MaybePromise<string | null>;
  setItem(key: string, value: string): MaybePromise<void>;
  removeItem(key: string): MaybePromise<void>;
}

export type NativeStorageLoader = () => MaybePromise<KeyValueStorageBackend>;

export type ClientStorageConfig = Pick<
  CreatorXRuntimeConfig,
  "releaseChannel"
> & {
  browser: KeyValueStorageBackend;
  loadNative?: NativeStorageLoader;
};

function asAsyncStore(backend: KeyValueStorageBackend): AsyncKeyValueStore {
  return {
    async getItem(key) {
      return await backend.getItem(key);
    },
    async setItem(key, value) {
      await backend.setItem(key, value);
    },
    async removeItem(key) {
      await backend.removeItem(key);
    },
  };
}

export async function createClientStorage(
  config: ClientStorageConfig,
  bridgeLoader: NativeStorageLoader | undefined = config.loadNative,
): Promise<AsyncKeyValueStore> {
  try {
    if (!bridgeLoader) {
      throw new Error("Native storage bridge is unavailable");
    }

    const native = await bridgeLoader();
    return asAsyncStore(native);
  } catch {
    if (config.releaseChannel !== "production") {
      return asAsyncStore(config.browser);
    }

    throw new CreatorXClientError(
      "STORAGE_UNAVAILABLE",
      "저장소를 사용할 수 없습니다. 앱을 다시 열어 주세요.",
      true,
    );
  }
}
