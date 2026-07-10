"use client";

import { useEffect } from "react";

export function AppInTossRuntime({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;

    let unsubscribe: (() => void) | undefined;
    let disposed = false;

    async function setupBridge() {
      try {
        const { closeView, graniteEvent } = await import(
          "@apps-in-toss/web-framework"
        );

        if (disposed) return;

        unsubscribe = graniteEvent.addEventListener("backEvent", {
          onEvent: async () => {
            const isRoot =
              window.location.pathname === "/" && window.location.search.length === 0;

            if (!isRoot && window.history.length > 1) {
              window.history.back();
              return;
            }

            await closeView();
          },
          onError: () => {
            // Native back events are best-effort in browser previews.
          },
        });
      } catch {
        // Browser preview outside Toss/Sandbox does not expose the native bridge.
      }
    }

    void setupBridge();

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [enabled]);

  return null;
}
