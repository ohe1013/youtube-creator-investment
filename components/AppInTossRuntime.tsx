"use client";

import { useEffect } from "react";
import { installAppInTossFetch, isAppInTossMode } from "@/lib/appintoss-fetch";

export function AppInTossRuntime() {
  installAppInTossFetch();

  useEffect(() => {
    if (!isAppInTossMode()) return;

    let unsubscribe: (() => void) | undefined;
    let disposed = false;

    async function setupBridge() {
      try {
        const { closeView, graniteEvent, getAnonymousKey } = await import(
          "@apps-in-toss/web-framework"
        );

        await getAnonymousKey().catch(() => null);

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

    setupBridge();

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  return null;
}
