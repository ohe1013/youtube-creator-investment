import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTossSession: vi.fn(),
  enforceRateLimit: vi.fn(),
}));

vi.mock("@/lib/server/auth/providers/toss", () => ({
  createTossSession: mocks.createTossSession,
}));
vi.mock("@/lib/server/http/rate-limit", () => ({
  enforceRateLimit: mocks.enforceRateLimit,
}));

import { POST } from "@/app/api/auth/toss/exchange/route";
import { ApiError } from "@/lib/server/http/api-error";

beforeEach(() => {
  mocks.createTossSession.mockReset();
  mocks.enforceRateLimit.mockReset();
  vi.stubEnv("VERCEL", undefined);
  vi.stubEnv("CREATORX_TRUST_PROXY", "0");
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/auth/toss/exchange", () => {
  it("rejects an invalid login bridge payload before invoking the provider", async () => {
    const response = await POST(
      new Request("http://localhost/api/auth/toss/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorizationCode: "", referrer: "UNTRUSTED" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
    expect(mocks.createTossSession).not.toHaveBeenCalled();
  });

  it("returns the shared rate-limit response before constructing a Toss session", async () => {
    mocks.enforceRateLimit.mockRejectedValue(
      new ApiError(429, "RATE_LIMITED", "Too many requests.", {
        retryAfterSeconds: 60,
      }),
    );

    const response = await POST(
      new Request("http://localhost/api/auth/toss/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          authorizationCode: "single-use-code",
          referrer: "DEFAULT",
        }),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toMatch(/^[1-9]\d*$/);
    expect(await response.json()).toMatchObject({
      error: { code: "RATE_LIMITED" },
    });
    expect(mocks.createTossSession).not.toHaveBeenCalled();
  });

  it("rate limits a trusted first forwarded IP before creating the server session", async () => {
    vi.stubEnv("VERCEL", "1");
    mocks.createTossSession.mockResolvedValue({
      accessToken: "creatorx-access-token",
      refreshToken: "creatorx-refresh-token",
      tokenType: "Bearer",
      expiresIn: 900,
    });

    const response = await POST(
      new Request("http://localhost/api/auth/toss/exchange", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "2001:DB8::7, 198.51.100.1",
        },
        body: JSON.stringify({
          authorizationCode: "single-use-code",
          referrer: "SANDBOX",
          userId: "client-controlled",
          accessToken: "forbidden-toss-access-token",
          refreshToken: "forbidden-toss-refresh-token",
        }),
      }),
    );

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      scope: "toss-login-exchange",
      identifier: "2001:db8::7",
      maxRequests: 5,
      windowMs: 60_000,
    });
    expect(mocks.enforceRateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.createTossSession).toHaveBeenCalledWith({
      authorizationCode: "single-use-code",
      referrer: "SANDBOX",
    });
    expect(mocks.createTossSession).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      accessToken: "creatorx-access-token",
      refreshToken: "creatorx-refresh-token",
      tokenType: "Bearer",
      expiresIn: 900,
    });
  });

  it("uses a single trusted forwarded IP when the proxy does not append a chain", async () => {
    vi.stubEnv("VERCEL", "1");
    mocks.createTossSession.mockResolvedValue({
      accessToken: "creatorx-access-token",
      refreshToken: "creatorx-refresh-token",
      tokenType: "Bearer",
      expiresIn: 900,
    });

    await POST(
      new Request("http://localhost/api/auth/toss/exchange", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.8",
        },
        body: JSON.stringify({
          authorizationCode: "single-use-code",
          referrer: "DEFAULT",
        }),
      }),
    );

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      scope: "toss-login-exchange",
      identifier: "203.0.113.8",
      maxRequests: 5,
      windowMs: 60_000,
    });
  });

  it.each([
    {
      label: "an untrusted forwarded IP",
      vercel: undefined,
      trustProxy: "0",
      forwardedFor: "203.0.113.9",
    },
    {
      label: "a malformed trusted forwarded value",
      vercel: "1",
      trustProxy: "0",
      forwardedFor: "not-an-ip, 203.0.113.9",
    },
    {
      label: "an oversized trusted forwarded value",
      vercel: "1",
      trustProxy: "0",
      forwardedFor: "2001:db8::7" + "x".repeat(256),
    },
  ])("uses anonymous instead of storing $label", async ({ vercel, trustProxy, forwardedFor }) => {
    vi.stubEnv("VERCEL", vercel);
    vi.stubEnv("CREATORX_TRUST_PROXY", trustProxy);
    mocks.createTossSession.mockResolvedValue({
      accessToken: "creatorx-access-token",
      refreshToken: "creatorx-refresh-token",
      tokenType: "Bearer",
      expiresIn: 900,
    });

    const response = await POST(
      new Request("http://localhost/api/auth/toss/exchange", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": forwardedFor,
        },
        body: JSON.stringify({
          authorizationCode: "single-use-code",
          referrer: "DEFAULT",
        }),
      }),
    );

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      scope: "toss-login-exchange",
      identifier: "anonymous",
      maxRequests: 5,
      windowMs: 60_000,
    });
    expect(mocks.createTossSession).toHaveBeenCalledWith({
      authorizationCode: "single-use-code",
      referrer: "DEFAULT",
    });
    expect(response.status).toBe(201);
    expect(JSON.stringify(await response.json())).not.toContain(forwardedFor);
  });
});
