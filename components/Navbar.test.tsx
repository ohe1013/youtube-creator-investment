// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import Navbar from "@/components/Navbar";

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  session: {
    status: "authenticated" as const,
    subject: "browser-user",
    identityKind: "browser" as "browser" | "anonymous-device" | "guest",
    balance: 4321,
    error: null,
    refresh: vi.fn(),
    signOut: vi.fn(),
  },
}));

vi.mock("@/lib/session/CreatorXSessionProvider", () => ({
  useCreatorXSession: () => mocks.session,
}));

vi.mock("@/lib/LanguageContext", () => ({
  useLanguage: () => ({
    locale: "ko",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn() }),
}));

beforeEach(() => {
  mocks.session.identityKind = "browser";
  mocks.session.signOut.mockReset().mockResolvedValue(undefined);
});

afterEach(() => cleanup());

it("shows normalized portfolio balance and delegates logout to the session adapter", async () => {
  render(<Navbar />);

  await waitFor(() => expect(screen.getAllByText("4,321 P").length).toBeGreaterThan(0));
  const logout = screen.getAllByRole("button", { name: "common.logout" })[0];
  fireEvent.click(logout);
  await waitFor(() => expect(mocks.session.signOut).toHaveBeenCalledTimes(1));
  expect(
    screen.getByRole("navigation").querySelector(".container"),
  ).not.toHaveClass("creatorx-navbar-native-inline");
});

it("reserves a native close rail only in Apps-in-Toss mode", async () => {
  mocks.session.identityKind = "anonymous-device";

  render(<Navbar />);

  await waitFor(() => expect(screen.getByRole("navigation")).toBeVisible());
  expect(
    screen.getByRole("navigation").querySelector(".container"),
  ).toHaveClass("creatorx-navbar-native-inline");
});

it("makes terms, privacy, and support discoverable from the mobile menu", async () => {
  render(<Navbar />);

  await waitFor(() => expect(screen.getByRole("navigation")).toBeVisible());
  fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));

  expect(screen.getByRole("link", { name: "이용약관" })).toHaveAttribute(
    "href",
    "/terms",
  );
  expect(
    screen.getByRole("link", { name: "개인정보처리방침" }),
  ).toHaveAttribute("href", "/privacy");
  expect(screen.getByRole("link", { name: "고객지원" })).toHaveAttribute(
    "href",
    "/support",
  );
});
