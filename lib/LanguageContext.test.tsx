/** @vitest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider, useLanguage } from "./LanguageContext";
import { locales } from "./locales";

function LanguageProbe() {
  const { locale, setLocale, t } = useLanguage();

  return (
    <>
      <output data-testid="language-output">
        {locale}:{t("common.chart")}
      </output>
      <button type="button" onClick={() => setLocale("en")}>
        English
      </button>
    </>
  );
}

function provider() {
  return (
    <LanguageProvider>
      <LanguageProbe />
    </LanguageProvider>
  );
}

function renderServerMarkup() {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: undefined,
  });

  try {
    return renderToString(provider());
  } finally {
    if (windowDescriptor) {
      Object.defineProperty(globalThis, "window", windowDescriptor);
    }
  }
}

let hydrationRoot: Root | null = null;

afterEach(() => {
  if (hydrationRoot) {
    act(() => hydrationRoot?.unmount());
    hydrationRoot = null;
  }
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.replaceChildren();
});

describe("LanguageProvider", () => {
  it("hydrates the Korean server snapshot without mismatch, then reveals a stored English locale", async () => {
    const serverMarkup = renderServerMarkup();
    const serverContainer = document.createElement("div");
    serverContainer.innerHTML = serverMarkup;
    expect(serverContainer.querySelector("output")).toHaveTextContent(
      `ko:${locales.ko.common.chart}`,
    );
    window.localStorage.setItem("locale", "en");
    const container = document.createElement("div");
    container.innerHTML = serverMarkup;
    document.body.append(container);
    const recoverableErrors: unknown[] = [];

    await act(async () => {
      hydrationRoot = hydrateRoot(container, provider(), {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
    });

    expect(recoverableErrors).toEqual([]);
    await waitFor(() =>
      expect(container.querySelector("output")).toHaveTextContent("en:Chart"),
    );
  });

  it("falls back to Korean when the persisted locale is invalid", async () => {
    const serverMarkup = renderServerMarkup();
    window.localStorage.setItem("locale", "invalid");
    const container = document.createElement("div");
    container.innerHTML = serverMarkup;
    document.body.append(container);
    const recoverableErrors: unknown[] = [];

    await act(async () => {
      hydrationRoot = hydrateRoot(container, provider(), {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
    });

    expect(recoverableErrors).toEqual([]);
    expect(container.querySelector("output")).toHaveTextContent(
      `ko:${locales.ko.common.chart}`,
    );
  });

  it("persists and publishes same-tab locale changes", () => {
    render(provider());

    fireEvent.click(screen.getByRole("button", { name: "English" }));

    expect(window.localStorage.getItem("locale")).toBe("en");
    expect(screen.getByTestId("language-output")).toHaveTextContent("en:Chart");
  });

  it("reacts to locale storage events from another tab", () => {
    render(provider());
    window.localStorage.setItem("locale", "en");

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "locale",
          newValue: "en",
          oldValue: null,
          storageArea: window.localStorage,
        }),
      );
    });

    expect(screen.getByTestId("language-output")).toHaveTextContent("en:Chart");
  });

  it("uses the Korean fallback when reading storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("storage denied", "SecurityError");
    });

    expect(() => render(provider())).not.toThrow();
    expect(screen.getByTestId("language-output")).toHaveTextContent(
      `ko:${locales.ko.common.chart}`,
    );
  });

  it("does not throw when persisting a locale is denied", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("storage denied", "SecurityError");
    });
    render(provider());
    const errors: unknown[] = [];
    const captureError = (event: ErrorEvent) => {
      event.preventDefault();
      errors.push(event.error);
    };
    window.addEventListener("error", captureError);

    fireEvent.click(screen.getByRole("button", { name: "English" }));

    window.removeEventListener("error", captureError);
    expect(errors).toEqual([]);
    expect(screen.getByTestId("language-output")).toHaveTextContent(
      `ko:${locales.ko.common.chart}`,
    );
  });
});
