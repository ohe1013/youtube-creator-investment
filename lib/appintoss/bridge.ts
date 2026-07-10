export type SafeAreaInsetsValue = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type GameUserKeyResult =
  | { type?: unknown; hash?: unknown }
  | "INVALID_CATEGORY"
  | "ERROR"
  | undefined;

export type CreatorXFrameworkPort = {
  getUserKeyForGame(): Promise<GameUserKeyResult>;
  SafeAreaInsets: {
    get(): SafeAreaInsetsValue;
    subscribe(options: {
      onEvent: (value: SafeAreaInsetsValue) => void;
    }): () => void;
  };
  graniteEvent: {
    addEventListener(
      event: "backEvent",
      options: { onEvent: () => void; onError: (error: Error) => void },
    ): () => void;
  };
  closeView(): Promise<void>;
  openURL(url: string): Promise<unknown>;
};

export interface CreatorXBridge {
  getAnonymousSubject(): Promise<string>;
  getSafeAreaInsets(): SafeAreaInsetsValue;
  subscribeSafeArea(
    onChange: (value: SafeAreaInsetsValue) => void,
  ): () => void;
  subscribeBack(
    onBack: () => void,
    onError: (error: Error) => void,
  ): () => void;
  close(): Promise<void>;
  openExternal(url: string): Promise<void>;
}

export type CreatorXBridgeLoader = () => Promise<CreatorXBridge>;

type InstalledCreatorXFramework = typeof import("@apps-in-toss/web-framework");

function ensureCreatorXFrameworkPort(
  framework: InstalledCreatorXFramework,
): CreatorXFrameworkPort {
  return framework;
}

async function importCreatorXFramework(): Promise<CreatorXFrameworkPort> {
  return ensureCreatorXFrameworkPort(
    await import("@apps-in-toss/web-framework"),
  );
}

export function assertHttpsExternalUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("외부 링크는 유효한 HTTPS 주소여야 합니다.");
  }

  if (url.protocol !== "https:") {
    throw new Error("외부 링크는 HTTPS 주소만 열 수 있습니다.");
  }
  return url;
}

export async function loadCreatorXBridge(
  loadFramework: () => Promise<CreatorXFrameworkPort> = importCreatorXFramework,
): Promise<CreatorXBridge> {
  const framework = await loadFramework();

  return {
    async getAnonymousSubject() {
      const result = await framework.getUserKeyForGame();
      if (
        typeof result !== "object" ||
        result === null ||
        result.type !== "HASH" ||
        typeof result.hash !== "string" ||
        result.hash.trim().length === 0
      ) {
        throw new Error("게임 사용자 키를 확인할 수 없습니다.");
      }
      return result.hash.trim();
    },
    getSafeAreaInsets() {
      return framework.SafeAreaInsets.get();
    },
    subscribeSafeArea(onChange) {
      return framework.SafeAreaInsets.subscribe({ onEvent: onChange });
    },
    subscribeBack(onBack, onError) {
      return framework.graniteEvent.addEventListener("backEvent", {
        onEvent: onBack,
        onError,
      });
    },
    async close() {
      await framework.closeView();
    },
    async openExternal(url) {
      assertHttpsExternalUrl(url);
      await framework.openURL(url);
    },
  };
}
