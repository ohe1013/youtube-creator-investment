// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import CreatorPage from "@/app/creator/page";

const mocks = vi.hoisted(() => ({
  id: null as string | null,
  detail: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.id === null ? "" : `id=${mocks.id}`),
}));

vi.mock("@/components/creator/CreatorDetailClient", () => ({
  CreatorDetailClient: ({ id }: { id: string }) => {
    mocks.detail(id);
    return <div>detail:{id}</div>;
  },
}));

beforeEach(() => {
  mocks.id = null;
  mocks.detail.mockClear();
});

afterEach(() => cleanup());

it.each([null, ""])('renders an accessible alert and does not load a creator for id "%s"', (id) => {
  mocks.id = id;
  render(<CreatorPage />);
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(mocks.detail).not.toHaveBeenCalled();
});

it("passes a decoded special creator id to the detail client", () => {
  mocks.id = "creator%2Fwith%3F%26%23%20%25";
  render(<CreatorPage />);
  expect(mocks.detail).toHaveBeenCalledWith("creator/with?&# %");
});
