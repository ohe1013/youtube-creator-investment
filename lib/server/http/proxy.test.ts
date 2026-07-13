import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";
import { CREATORX_TOSS_ORIGINS } from "@/lib/server/http/cors";

const validProductionPublicEnv = {
  NEXT_PUBLIC_APP_IN_TOSS: "1",
  NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL: "production",
  NEXT_PUBLIC_CREATORX_DATA_MODE: "remote",
  NEXT_PUBLIC_CREATORX_API_BASE_URL: "https://api.creatorx.example",
  NEXT_PUBLIC_CREATORX_OPERATOR_NAME: "CreatorX Operator",
  NEXT_PUBLIC_CREATORX_SUPPORT_URL: "https://support.creatorx.example",
  NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT: "privacy@creatorx.example",
  NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE: "2026-07-10",
  NEXT_PUBLIC_CREATORX_ICON_URL:
    "https://assets.creatorx.example/creatorx-icon.png",
};

function useProductionEnvironment(overrides: Record<string, string | undefined> = {}) {
  const environment: Record<string, string | undefined> = {
    NODE_ENV: "production",
    ...validProductionPublicEnv,
    CREATORX_IDENTITY_PEPPER: "p".repeat(32),
    CREATORX_DEV_CORS_ORIGINS: undefined,
    CREATORX_TRUST_PROXY: "0",
    VERCEL: undefined,
    ...overrides,
  };
  for (const [key, value] of Object.entries(environment)) {
    vi.stubEnv(key, value);
  }
}

afterEach(() => vi.unstubAllEnvs());

describe("API ingress proxy", () => {
  it("fails closed for an HTTPS-looking direct request without trusted proxy attestation", async () => {
    useProductionEnvironment();

    const response = proxy(
      new NextRequest("https://api.creatorx.example/api/creators", {
        headers: { "x-forwarded-proto": "https" },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INTERNAL_SERVER_ERROR" },
    });
  });

  it("adds exact CORS headers while preserving the Next continuation response", () => {
    useProductionEnvironment({ VERCEL: "1" });

    const response = proxy(
      new NextRequest("https://api.creatorx.example/api/creators", {
        headers: {
          "x-forwarded-proto": "https",
          origin: CREATORX_TOSS_ORIGINS[0],
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("access-control-allow-origin")).toBe(
      CREATORX_TOSS_ORIGINS[0],
    );
    expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
  });

  it("blocks an unknown origin before the API route can run", async () => {
    useProductionEnvironment({ VERCEL: "1" });

    const response = proxy(
      new NextRequest("https://api.creatorx.example/api/creators", {
        headers: {
          "x-forwarded-proto": "https",
          origin: "https://evil.example",
        },
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CORS_ORIGIN_DENIED" },
    });
  });

  it("answers an allowed API preflight at ingress", () => {
    useProductionEnvironment({ VERCEL: "1" });

    const response = proxy(
      new NextRequest("https://api.creatorx.example/api/orders", {
        method: "OPTIONS",
        headers: {
          "x-forwarded-proto": "https",
          origin: CREATORX_TOSS_ORIGINS[1],
          "access-control-request-method": "POST",
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      CREATORX_TOSS_ORIGINS[1],
    );
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "POST",
    );
  });
});
