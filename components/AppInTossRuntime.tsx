"use client";

import { useEffect, useState } from "react";

import { RuntimeIssueBanner } from "@/components/runtime/RuntimeIssueBanner";
import {
  loadCreatorXBridge,
  type CreatorXBridgeLoader,
  type SafeAreaInsetsValue,
} from "@/lib/appintoss/bridge";

const safeAreaVariables = {
  top: "--creatorx-safe-top",
  right: "--creatorx-safe-right",
  bottom: "--creatorx-safe-bottom",
  left: "--creatorx-safe-left",
} as const;

function toPixels(value: number) {
  return `${Number.isFinite(value) ? Math.max(0, value) : 0}px`;
}

function applySafeArea(value: SafeAreaInsetsValue) {
  const style = document.documentElement.style;
  for (const edge of Object.keys(safeAreaVariables) as Array<
    keyof SafeAreaInsetsValue
  >) {
    style.setProperty(safeAreaVariables[edge], toPixels(value[edge]));
  }
}

function resetRuntimeVariables() {
  const style = document.documentElement.style;
  for (const variable of Object.values(safeAreaVariables)) {
    style.removeProperty(variable);
  }
  style.removeProperty("--creatorx-viewport-height");
  style.removeProperty("--creatorx-keyboard-height");
}

function issueMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "앱인토스 연결을 확인하지 못했습니다.";
}

function isRootRoute() {
  return (
    window.location.pathname === "/" &&
    window.location.search.length === 0 &&
    window.location.hash.length === 0
  );
}

function scrollFocusedControlIntoView() {
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    active.matches(
      "[data-creatorx-keyboard-target], input, textarea, select, [contenteditable='true']",
    )
  ) {
    active.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }
}

export function AppInTossRuntime({
  enabled,
  loadBridge = loadCreatorXBridge,
}: {
  enabled: boolean;
  loadBridge?: CreatorXBridgeLoader;
}) {
  const [issue, setIssue] = useState<string | null>(null);
  const [retryGeneration, setRetryGeneration] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let unsubscribeSafeArea: (() => void) | undefined;
    let unsubscribeBack: (() => void) | undefined;
    const viewport = window.visualViewport;

    const reportIssue = (error: unknown) => {
      if (!disposed) setIssue(issueMessage(error));
    };

    const updateViewport = () => {
      const height = viewport?.height ?? window.innerHeight;
      const offsetTop = viewport?.offsetTop ?? 0;
      const keyboardHeight = Math.max(
        0,
        window.innerHeight - height - offsetTop,
      );
      const style = document.documentElement.style;
      style.setProperty("--creatorx-viewport-height", toPixels(height));
      style.setProperty("--creatorx-keyboard-height", toPixels(keyboardHeight));
      if (keyboardHeight > 0) scrollFocusedControlIntoView();
    };

    updateViewport();
    viewport?.addEventListener("resize", updateViewport);
    viewport?.addEventListener("scroll", updateViewport);

    async function setupBridge() {
      try {
        const bridge = await loadBridge();
        if (disposed) return;

        applySafeArea(bridge.getSafeAreaInsets());
        unsubscribeSafeArea = bridge.subscribeSafeArea((value) => {
          if (!disposed) applySafeArea(value);
        });
        unsubscribeBack = bridge.subscribeBack(
          () => {
            if (disposed) return;
            if (!isRootRoute()) {
              window.history.back();
              return;
            }
            void bridge.close().catch(reportIssue);
          },
          reportIssue,
        );
      } catch (error) {
        reportIssue(error);
      }
    }

    void setupBridge();

    return () => {
      disposed = true;
      unsubscribeSafeArea?.();
      unsubscribeBack?.();
      viewport?.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("scroll", updateViewport);
      resetRuntimeVariables();
    };
  }, [enabled, loadBridge, retryGeneration]);

  if (!enabled || issue === null) return null;

  return (
    <RuntimeIssueBanner
      message={issue}
      onRetry={() => {
        setIssue(null);
        setRetryGeneration((generation) => generation + 1);
      }}
    />
  );
}
