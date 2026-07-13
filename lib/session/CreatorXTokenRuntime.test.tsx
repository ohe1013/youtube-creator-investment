// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";

import type { CreatorXRuntimeConfig } from "@/lib/runtime/config";
import {
  CreatorXTokenRuntimeProvider,
  type CreatorXTokenRuntime,
  useCreatorXTokenRuntime,
} from "@/lib/session/CreatorXTokenRuntime";

const config: CreatorXRuntimeConfig = {
  appInToss: true,
  releaseChannel: "sandbox",
  dataMode: "remote",
  tossLoginEnabled: true,
  apiBaseUrl: new URL("https://api.example.com/"),
  allowBrowserStorageFallback: true,
  brandIconUrl: null,
  legal: {
    operatorName: "CreatorX Sandbox",
    supportUrl: "https://example.com/support",
    privacyContact: "support@example.com",
    effectiveDate: "2026-07-13",
  },
};

function RuntimeProbe({
  onRuntime,
}: {
  onRuntime(runtime: CreatorXTokenRuntime): void;
}) {
  const runtime = useCreatorXTokenRuntime();
  useEffect(() => {
    onRuntime(runtime);
  }, [onRuntime, runtime]);
  return null;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("clears an in-memory access token when refresh storage cannot be read", async () => {
  const runtimeRef: { current: CreatorXTokenRuntime | null } = { current: null };
  render(
    <CreatorXTokenRuntimeProvider config={config}>
      <RuntimeProbe onRuntime={(next) => { runtimeRef.current = next; }} />
    </CreatorXTokenRuntimeProvider>,
  );
  await vi.waitFor(() => expect(runtimeRef.current).not.toBeNull());
  const runtime = runtimeRef.current;
  if (runtime === null) throw new Error("runtime probe did not mount");

  await act(async () => {
    await runtime?.acceptTokens({
      accessToken: "access-token-stale",
      refreshToken: "refresh-token-current",
      tokenType: "Bearer",
      expiresIn: 900,
    });
  });

  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("native storage read failed");
  });

  const error = await runtime
    .refreshAccessToken("access-token-stale")
    .catch((reason: unknown) => reason);

  expect(error).toMatchObject({ code: "SESSION_UNAVAILABLE", retryable: true });
  await expect(runtime.getAccessToken()).resolves.toBeNull();
});

it("uses one refresh rotation when concurrent 401 handlers hold the same stale access token", async () => {
  const runtimeRef: { current: CreatorXTokenRuntime | null } = { current: null };
  render(
    <CreatorXTokenRuntimeProvider config={config}>
      <RuntimeProbe onRuntime={(next) => { runtimeRef.current = next; }} />
    </CreatorXTokenRuntimeProvider>,
  );
  await vi.waitFor(() => expect(runtimeRef.current).not.toBeNull());
  const runtime = runtimeRef.current;
  if (runtime === null) throw new Error("runtime probe did not mount");

  await act(async () => {
    await runtime?.acceptTokens({
      accessToken: "access-token-stale",
      refreshToken: "refresh-token-current",
      tokenType: "Bearer",
      expiresIn: 900,
    });
  });

  const response = Promise.withResolvers<Response>();
  const fetchSpy = vi.fn().mockReturnValue(response.promise);
  vi.stubGlobal("fetch", fetchSpy);

  const first = runtime.refreshAccessToken("access-token-stale");
  const second = runtime.refreshAccessToken("access-token-stale");
  await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  response.resolve(
    Response.json({
      accessToken: "access-token-rotated",
      refreshToken: "refresh-token-rotated",
      tokenType: "Bearer",
      expiresIn: 900,
    }),
  );

  await expect(Promise.all([first, second])).resolves.toEqual([
    "access-token-rotated",
    "access-token-rotated",
  ]);
  await expect(runtime.getAccessToken()).resolves.toBe("access-token-rotated");
  expect(localStorage.getItem("creatorx:session:refresh:v1")).toBe(
    "refresh-token-rotated",
  );
});

it("does not restore accepted tokens when sign-out starts during their storage write", async () => {
  const runtimeRef: { current: CreatorXTokenRuntime | null } = { current: null };
  render(
    <CreatorXTokenRuntimeProvider config={config}>
      <RuntimeProbe onRuntime={(next) => { runtimeRef.current = next; }} />
    </CreatorXTokenRuntimeProvider>,
  );
  await vi.waitFor(() => expect(runtimeRef.current).not.toBeNull());
  const runtime = runtimeRef.current;
  if (runtime === null) throw new Error("runtime probe did not mount");

  const originalSetItem = Storage.prototype.setItem;
  const writeGate = Promise.withResolvers<void>();
  const setItem = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation((key, value) => {
      if (
        key === "creatorx:session:refresh:v1" &&
        value === "refresh-token-inflight"
      ) {
        return writeGate.promise.then(() => {
          originalSetItem.call(window.localStorage, key, value);
        }) as never;
      }
      return originalSetItem.call(window.localStorage, key, value);
    });

  const accepting = runtime.acceptTokens({
    accessToken: "access-token-inflight",
    refreshToken: "refresh-token-inflight",
    tokenType: "Bearer",
    expiresIn: 900,
  });
  await vi.waitFor(() => expect(setItem).toHaveBeenCalledTimes(1));
  const clearing = runtime.clear();
  writeGate.resolve();
  await Promise.all([accepting, clearing]);

  await expect(runtime.getAccessToken()).resolves.toBeNull();
  expect(localStorage.getItem("creatorx:session:refresh:v1")).toBeNull();
});

it("does not restore a rotated refresh token when sign-out wins an in-flight rotation", async () => {
  const runtimeRef: { current: CreatorXTokenRuntime | null } = { current: null };
  render(
    <CreatorXTokenRuntimeProvider config={config}>
      <RuntimeProbe onRuntime={(next) => { runtimeRef.current = next; }} />
    </CreatorXTokenRuntimeProvider>,
  );
  await vi.waitFor(() => expect(runtimeRef.current).not.toBeNull());
  const runtime = runtimeRef.current;
  if (runtime === null) throw new Error("runtime probe did not mount");

  await runtime.acceptTokens({
    accessToken: "access-token-stale",
    refreshToken: "refresh-token-current",
    tokenType: "Bearer",
    expiresIn: 900,
  });
  const response = Promise.withResolvers<Response>();
  const fetchSpy = vi.fn().mockReturnValue(response.promise);
  vi.stubGlobal("fetch", fetchSpy);

  const rotating = runtime.refreshAccessToken("access-token-stale");
  await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  const clearing = runtime.clear();
  response.resolve(
    Response.json({
      accessToken: "access-token-rotated",
      refreshToken: "refresh-token-rotated",
      tokenType: "Bearer",
      expiresIn: 900,
    }),
  );

  await expect(rotating).resolves.toBeNull();
  await clearing;
  await expect(runtime.getAccessToken()).resolves.toBeNull();
  expect(localStorage.getItem("creatorx:session:refresh:v1")).toBeNull();
});
