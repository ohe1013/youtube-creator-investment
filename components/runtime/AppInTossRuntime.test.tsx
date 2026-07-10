// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppInTossRuntime } from "@/components/AppInTossRuntime";
import { ExternalLink } from "@/components/runtime/ExternalLink";
import {
  loadCreatorXBridge,
  type CreatorXBridge,
  type CreatorXFrameworkPort,
  type SafeAreaInsetsValue,
} from "@/lib/appintoss/bridge";

class FakeVisualViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  width = 390;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function bridgeHarness(initialInsets: SafeAreaInsetsValue = {
  top: 10,
  right: 20,
  bottom: 30,
  left: 40,
}) {
  let onSafeArea: ((value: SafeAreaInsetsValue) => void) | undefined;
  let onBack: (() => void) | undefined;
  let onBackError: ((error: Error) => void) | undefined;
  const unsubscribeSafeArea = vi.fn();
  const unsubscribeBack = vi.fn();
  const close = vi.fn<() => Promise<void>>(async () => undefined);
  const openExternal = vi.fn<(url: string) => Promise<void>>(
    async () => undefined,
  );

  const bridge: CreatorXBridge = {
    getAnonymousSubject: vi.fn(async () => "game-user"),
    getSafeAreaInsets: vi.fn(() => initialInsets),
    subscribeSafeArea: vi.fn((listener) => {
      onSafeArea = listener;
      return unsubscribeSafeArea;
    }),
    subscribeBack: vi.fn((listener, onError) => {
      onBack = listener;
      onBackError = onError;
      return unsubscribeBack;
    }),
    close,
    openExternal,
  };

  return {
    bridge,
    close,
    emitBack: () => onBack?.(),
    emitBackError: (error: Error) => onBackError?.(error),
    emitSafeArea: (value: SafeAreaInsetsValue) => onSafeArea?.(value),
    openExternal,
    unsubscribeBack,
    unsubscribeSafeArea,
  };
}

function installVisualViewport(viewport = new FakeVisualViewport()) {
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: viewport,
  });
  return viewport;
}

const runtimeVariables = [
  "--creatorx-safe-top",
  "--creatorx-safe-right",
  "--creatorx-safe-bottom",
  "--creatorx-safe-left",
  "--creatorx-viewport-height",
  "--creatorx-keyboard-height",
] as const;

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 800,
  });
  installVisualViewport();
  for (const variable of runtimeVariables) {
    document.documentElement.style.removeProperty(variable);
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const variable of runtimeVariables) {
    document.documentElement.style.removeProperty(variable);
  }
});

describe("AppInTossRuntime", () => {
  it("does not load native capabilities when the runtime is disabled", async () => {
    const loadBridge = vi.fn(async () => bridgeHarness().bridge);

    render(<AppInTossRuntime enabled={false} loadBridge={loadBridge} />);

    await act(async () => undefined);
    expect(loadBridge).not.toHaveBeenCalled();
  });

  it("closes the Apps-in-Toss view when back is pressed at the root", async () => {
    const harness = bridgeHarness();
    render(
      <AppInTossRuntime
        enabled
        loadBridge={async () => harness.bridge}
      />,
    );
    await waitFor(() =>
      expect(harness.bridge.subscribeBack).toHaveBeenCalledTimes(1),
    );

    act(() => harness.emitBack());

    await waitFor(() => expect(harness.close).toHaveBeenCalledTimes(1));
  });

  it("uses browser history instead of closing on a non-root route", async () => {
    window.history.replaceState({}, "", "/creator?id=creator-1");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const harness = bridgeHarness();
    render(
      <AppInTossRuntime
        enabled
        loadBridge={async () => harness.bridge}
      />,
    );
    await waitFor(() =>
      expect(harness.bridge.subscribeBack).toHaveBeenCalledTimes(1),
    );

    act(() => harness.emitBack());

    expect(back).toHaveBeenCalledTimes(1);
    expect(harness.close).not.toHaveBeenCalled();
  });

  it("publishes the initial safe-area values to all four CSS variables", async () => {
    const harness = bridgeHarness({ top: 11, right: 12, bottom: 13, left: 14 });
    render(
      <AppInTossRuntime
        enabled
        loadBridge={async () => harness.bridge}
      />,
    );

    await waitFor(() => {
      const style = document.documentElement.style;
      expect(style.getPropertyValue("--creatorx-safe-top")).toBe("11px");
      expect(style.getPropertyValue("--creatorx-safe-right")).toBe("12px");
      expect(style.getPropertyValue("--creatorx-safe-bottom")).toBe("13px");
      expect(style.getPropertyValue("--creatorx-safe-left")).toBe("14px");
    });
  });

  it("updates safe-area CSS variables when the native subscription emits", async () => {
    const harness = bridgeHarness();
    render(
      <AppInTossRuntime
        enabled
        loadBridge={async () => harness.bridge}
      />,
    );
    await waitFor(() =>
      expect(harness.bridge.subscribeSafeArea).toHaveBeenCalledTimes(1),
    );

    act(() => harness.emitSafeArea({ top: 1, right: 2, bottom: 3, left: 4 }));

    const style = document.documentElement.style;
    expect(style.getPropertyValue("--creatorx-safe-top")).toBe("1px");
    expect(style.getPropertyValue("--creatorx-safe-right")).toBe("2px");
    expect(style.getPropertyValue("--creatorx-safe-bottom")).toBe("3px");
    expect(style.getPropertyValue("--creatorx-safe-left")).toBe("4px");
  });

  it("tracks visual viewport resize and scroll events", async () => {
    const viewport = installVisualViewport();
    const harness = bridgeHarness();
    render(
      <AppInTossRuntime
        enabled
        loadBridge={async () => harness.bridge}
      />,
    );
    await waitFor(() =>
      expect(harness.bridge.subscribeBack).toHaveBeenCalledTimes(1),
    );

    viewport.height = 520;
    act(() => viewport.dispatchEvent(new Event("resize")));
    expect(
      document.documentElement.style.getPropertyValue(
        "--creatorx-viewport-height",
      ),
    ).toBe("520px");
    expect(
      document.documentElement.style.getPropertyValue(
        "--creatorx-keyboard-height",
      ),
    ).toBe("280px");

    viewport.height = 500;
    viewport.offsetTop = 25;
    act(() => viewport.dispatchEvent(new Event("scroll")));
    expect(
      document.documentElement.style.getPropertyValue(
        "--creatorx-keyboard-height",
      ),
    ).toBe("275px");
  });

  it("scrolls the focused order control into view when the keyboard opens", async () => {
    const viewport = installVisualViewport();
    const harness = bridgeHarness();
    const scrollIntoView = vi.fn();
    const input = document.createElement("input");
    input.dataset.creatorxKeyboardTarget = "true";
    input.scrollIntoView = scrollIntoView;
    document.body.append(input);
    input.focus();
    render(
      <AppInTossRuntime
        enabled
        loadBridge={async () => harness.bridge}
      />,
    );
    await waitFor(() =>
      expect(harness.bridge.subscribeBack).toHaveBeenCalledTimes(1),
    );

    viewport.height = 430;
    act(() => viewport.dispatchEvent(new Event("resize")));

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    input.remove();
  });

  it("cleans up both native subscriptions and both viewport listeners", async () => {
    const viewport = installVisualViewport();
    const removeEventListener = vi.spyOn(viewport, "removeEventListener");
    const harness = bridgeHarness();
    const view = render(
      <AppInTossRuntime
        enabled
        loadBridge={async () => harness.bridge}
      />,
    );
    await waitFor(() =>
      expect(harness.bridge.subscribeBack).toHaveBeenCalledTimes(1),
    );

    view.unmount();

    expect(harness.unsubscribeSafeArea).toHaveBeenCalledTimes(1);
    expect(harness.unsubscribeBack).toHaveBeenCalledTimes(1);
    expect(removeEventListener).toHaveBeenCalledWith(
      "resize",
      expect.any(Function),
    );
    expect(removeEventListener).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
    );
  });

  it("ignores native events that were already queued when cleanup ran", async () => {
    const harness = bridgeHarness();
    const view = render(
      <AppInTossRuntime enabled loadBridge={async () => harness.bridge} />,
    );
    await waitFor(() =>
      expect(harness.bridge.subscribeBack).toHaveBeenCalledTimes(1),
    );

    view.unmount();
    act(() => {
      harness.emitSafeArea({ top: 91, right: 92, bottom: 93, left: 94 });
      harness.emitBack();
    });

    expect(
      document.documentElement.style.getPropertyValue("--creatorx-safe-top"),
    ).toBe("");
    expect(harness.close).not.toHaveBeenCalled();
  });

  it("renders an observable retry action and recovers from bridge load failure", async () => {
    const harness = bridgeHarness();
    const loadBridge = vi
      .fn<() => Promise<CreatorXBridge>>()
      .mockRejectedValueOnce(new Error("bridge unavailable"))
      .mockResolvedValueOnce(harness.bridge);
    render(<AppInTossRuntime enabled loadBridge={loadBridge} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "bridge unavailable",
    );
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    await waitFor(() =>
      expect(harness.bridge.subscribeBack).toHaveBeenCalledTimes(1),
    );
    expect(loadBridge).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces native back subscription errors", async () => {
    const harness = bridgeHarness();
    render(
      <AppInTossRuntime
        enabled
        loadBridge={async () => harness.bridge}
      />,
    );
    await waitFor(() =>
      expect(harness.bridge.subscribeBack).toHaveBeenCalledTimes(1),
    );

    act(() => harness.emitBackError(new Error("back bridge failed")));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "back bridge failed",
    );
  });

  it("retries a failed root close directly without reloading the bridge", async () => {
    const harness = bridgeHarness();
    const retriedClose = deferred<undefined>();
    harness.close
      .mockRejectedValueOnce(new Error("close failed"))
      .mockImplementationOnce(() => retriedClose.promise);
    const loadBridge = vi.fn(async () => harness.bridge);
    render(<AppInTossRuntime enabled loadBridge={loadBridge} />);
    await waitFor(() =>
      expect(harness.bridge.subscribeBack).toHaveBeenCalledTimes(1),
    );

    act(() => harness.emitBack());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("close failed");
    const retry = screen.getByRole("button", { name: "다시 시도" });
    act(() => {
      retry.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      retry.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitFor(() => expect(harness.close).toHaveBeenCalledTimes(2));
    expect(loadBridge).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("close failed");

    await act(async () => {
      retriedClose.resolve(undefined);
      await retriedClose.promise;
    });
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });
});

describe("ExternalLink", () => {
  it("renders a normal, unhandled anchor in browser mode", () => {
    const loadBridge = vi.fn(async () => bridgeHarness().bridge);
    render(
      <ExternalLink
        href="https://youtube.com/channel/browser"
        appInToss={false}
        loadBridge={loadBridge}
      >
        YouTube
      </ExternalLink>,
    );
    const link = screen.getByRole("link", { name: "YouTube" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });

    expect(link.dispatchEvent(click)).toBe(true);
    expect(click.defaultPrevented).toBe(false);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(loadBridge).not.toHaveBeenCalled();
  });

  it("opens an HTTPS URL through the native bridge", async () => {
    const harness = bridgeHarness();
    render(
      <ExternalLink
        href="https://youtube.com/channel/native"
        appInToss
        loadBridge={async () => harness.bridge}
      >
        YouTube
      </ExternalLink>,
    );

    fireEvent.click(screen.getByRole("link", { name: "YouTube" }));

    await waitFor(() =>
      expect(harness.openExternal).toHaveBeenCalledWith(
        "https://youtube.com/channel/native",
      ),
    );
  });

  it("coalesces two native clicks dispatched in the same turn", async () => {
    const harness = bridgeHarness();
    const bridgeReady = deferred<CreatorXBridge>();
    const loadBridge = vi.fn(() => bridgeReady.promise);
    render(
      <ExternalLink
        href="https://example.com/once"
        appInToss
        loadBridge={loadBridge}
      >
        Open once
      </ExternalLink>,
    );
    const link = screen.getByRole("link", { name: "Open once" });

    act(() => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(loadBridge).toHaveBeenCalledTimes(1);
    await act(async () => {
      bridgeReady.resolve(harness.bridge);
      await bridgeReady.promise;
    });
    await waitFor(() =>
      expect(harness.openExternal).toHaveBeenCalledTimes(1),
    );
  });

  it("lets a new href succeed without a late old rejection restoring its error", async () => {
    const oldOpen = deferred<undefined>();
    const harness = bridgeHarness();
    harness.openExternal.mockImplementation((url) =>
      url.endsWith("/old") ? oldOpen.promise : Promise.resolve(undefined),
    );
    const loadBridge = vi.fn(async () => harness.bridge);
    const view = render(
      <ExternalLink
        href="https://example.com/old"
        appInToss
        loadBridge={loadBridge}
      >
        Changing link
      </ExternalLink>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Changing link" }));
    await waitFor(() =>
      expect(harness.openExternal).toHaveBeenCalledWith(
        "https://example.com/old",
      ),
    );

    view.rerender(
      <ExternalLink
        href="https://example.com/new"
        appInToss
        loadBridge={loadBridge}
      >
        Changing link
      </ExternalLink>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Changing link" }));
    await waitFor(() =>
      expect(harness.openExternal).toHaveBeenCalledWith(
        "https://example.com/new",
      ),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => {
      oldOpen.reject(new Error("late old failure"));
      await oldOpen.promise.catch(() => undefined);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("rejects non-HTTPS native URLs before loading the SDK bridge", async () => {
    const loadBridge = vi.fn(async () => bridgeHarness().bridge);
    render(
      <ExternalLink href="http://example.com" appInToss loadBridge={loadBridge}>
        Unsafe
      </ExternalLink>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Unsafe" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("HTTPS");
    expect(loadBridge).not.toHaveBeenCalled();
  });

  it("shows retry UI when native openURL rejects and retries the same URL", async () => {
    const harness = bridgeHarness();
    harness.openExternal
      .mockRejectedValueOnce(new Error("open failed"))
      .mockResolvedValueOnce(undefined);
    render(
      <ExternalLink
        href="https://example.com/retry"
        appInToss
        loadBridge={async () => harness.bridge}
      >
        Retry link
      </ExternalLink>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Retry link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("open failed");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    await waitFor(() => expect(harness.openExternal).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("loadCreatorXBridge", () => {
  it("keeps the default adapter statically compatible with the installed SDK", () => {
    const source = readFileSync(
      resolve(process.cwd(), "lib/appintoss/bridge.ts"),
      "utf8",
    );

    expect(source).toContain(
      'typeof import("@apps-in-toss/web-framework")',
    );
    expect(source).not.toContain("as unknown as CreatorXFrameworkPort");
  });

  it("maps safe-area and back subscriptions to the exact SDK signatures", async () => {
    const safeCleanup = vi.fn();
    const backCleanup = vi.fn();
    const safeSubscribe = vi.fn(() => safeCleanup);
    const backSubscribe = vi.fn(() => backCleanup);
    const framework: CreatorXFrameworkPort = {
      getUserKeyForGame: vi.fn(async () => ({ type: "HASH", hash: " user " })),
      SafeAreaInsets: {
        get: vi.fn(() => ({ top: 1, right: 2, bottom: 3, left: 4 })),
        subscribe: safeSubscribe,
      },
      graniteEvent: { addEventListener: backSubscribe },
      closeView: vi.fn(async () => undefined),
      openURL: vi.fn(async () => undefined),
    };
    const bridge = await loadCreatorXBridge(async () => framework);
    const onSafeArea = vi.fn();
    const onBack = vi.fn();
    const onError = vi.fn();

    expect(bridge.getSafeAreaInsets()).toEqual({
      top: 1,
      right: 2,
      bottom: 3,
      left: 4,
    });
    expect(bridge.subscribeSafeArea(onSafeArea)).toBe(safeCleanup);
    expect(safeSubscribe).toHaveBeenCalledWith({ onEvent: onSafeArea });
    expect(bridge.subscribeBack(onBack, onError)).toBe(backCleanup);
    expect(backSubscribe).toHaveBeenCalledWith("backEvent", {
      onEvent: onBack,
      onError,
    });
  });

  it("normalizes the game subject and awaits closeView and HTTPS openURL", async () => {
    const closeView = vi.fn(async () => undefined);
    const openURL = vi.fn(async () => undefined);
    const framework: CreatorXFrameworkPort = {
      getUserKeyForGame: vi.fn(async () => ({ type: "HASH", hash: " game-user " })),
      SafeAreaInsets: {
        get: vi.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
        subscribe: vi.fn(() => vi.fn()),
      },
      graniteEvent: { addEventListener: vi.fn(() => vi.fn()) },
      closeView,
      openURL,
    };
    const bridge = await loadCreatorXBridge(async () => framework);

    expect(await bridge.getAnonymousSubject()).toBe("game-user");
    await bridge.close();
    await bridge.openExternal("https://example.com/path");

    expect(closeView).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith("https://example.com/path");
    await expect(bridge.openExternal("http://example.com")).rejects.toThrow(
      "HTTPS",
    );
    expect(openURL).toHaveBeenCalledTimes(1);
  });
});
