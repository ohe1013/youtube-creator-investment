// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import AuthLayout from "@/app/auth/layout";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));

vi.mock("@/lib/session/CreatorXSessionProvider", () => ({
  useCreatorXSession: () => ({ status: "authenticated" }),
}));

afterEach(() => {
  cleanup();
  mocks.push.mockClear();
  mocks.replace.mockClear();
});

it("replaces the sign-in history entry after authentication", async () => {
  render(<AuthLayout>signed in</AuthLayout>);
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
  expect(mocks.push).not.toHaveBeenCalled();
});
