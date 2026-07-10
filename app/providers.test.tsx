// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { Providers } from "@/app/providers";

const mocks = vi.hoisted(() => ({
  runtime: vi.fn(({ enabled }: { enabled: boolean }) => (
    <div data-testid="native-runtime" data-enabled={String(enabled)} />
  )),
}));

vi.mock("next-themes", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/lib/LanguageContext", () => ({
  LanguageProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/runtime/CreatorXDataProvider", () => ({
  CreatorXDataProvider: () => <div data-testid="data-bootstrap-blocked" />,
}));

vi.mock("@/lib/session/CreatorXSessionProvider", () => ({
  CreatorXSessionProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));

vi.mock("@/components/AppInTossRuntime", () => ({
  AppInTossRuntime: mocks.runtime,
}));

vi.mock("@/lib/runtime/config", () => ({
  parseRuntimeConfig: () => ({
    appInToss: true,
    releaseChannel: "sandbox",
    dataMode: "demo",
    apiBaseUrl: null,
    allowBrowserStorageFallback: true,
    brandIconUrl: null,
    legal: {
      operatorName: "CreatorX",
      supportUrl: "https://example.com/support",
      privacyContact: "privacy@example.com",
      effectiveDate: "2026-07-10",
    },
  }),
}));

afterEach(() => cleanup());

it("mounts the native runtime even when data bootstrap suppresses app children", () => {
  render(
    <Providers>
      <div data-testid="app-content" />
    </Providers>,
  );

  expect(screen.getByTestId("data-bootstrap-blocked")).toBeInTheDocument();
  expect(screen.getByTestId("native-runtime")).toHaveAttribute(
    "data-enabled",
    "true",
  );
  expect(screen.queryByTestId("app-content")).not.toBeInTheDocument();
});
