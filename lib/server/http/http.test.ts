import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { parsePublicEnv } from "@/lib/config/public-env";
import { parseServerEnv } from "@/lib/config/server-env";
import { ApiError } from "@/lib/server/http/api-error";
import {
  CREATORX_TOSS_ORIGINS,
  parseDevelopmentOrigins,
} from "@/lib/server/http/cors";
import {
  createCorsPreflightHandler,
  isSecureRequest,
  withApiRoute,
} from "@/lib/server/http/route-handler";
import { hashRateLimitKey } from "@/lib/server/http/rate-limit";

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

describe("public and server environment boundaries", () => {
  it.each([
    [{ NEXT_PUBLIC_CREATORX_DATA_MODE: "demo" }, "remote data mode"],
    [
      { NEXT_PUBLIC_CREATORX_API_BASE_URL: "http://api.creatorx.example" },
      "remote HTTPS API URL",
    ],
    [{ NEXT_PUBLIC_CREATORX_API_BASE_URL: undefined }, "remote HTTPS API URL"],
  ])("rejects unsafe production public config", (override, message) => {
    expect(() =>
      parsePublicEnv({ ...validProductionPublicEnv, ...override }),
    ).toThrow(message);
  });

  it("accepts only explicit local development origins outside production", () => {
    expect(
      parseServerEnv({
        NODE_ENV: "development",
        CREATORX_DEV_CORS_ORIGINS:
          "http://localhost:3000,http://127.0.0.1:5173",
      }).developmentCorsOrigins,
    ).toEqual(["http://localhost:3000", "http://127.0.0.1:5173"]);

    expect(() =>
      parseServerEnv({
        NODE_ENV: "production",
        CREATORX_DEV_CORS_ORIGINS: "http://localhost:3000",
      }),
    ).toThrow("development CORS origins");
  });

  it.each([
    "*",
    "https://evil.example",
    "http://localhost:3000/path",
    "http://localhost:3000?query=1",
    "http://user@localhost:3000",
    "http://localhost:3000#fragment",
  ])("rejects a malformed or non-local development origin: %s", (origin) => {
    expect(() => parseDevelopmentOrigins(origin)).toThrow("local origin");
  });
});

describe("withApiRoute", () => {
  const developmentOptions = {
    isProduction: false,
    developmentOrigins: ["http://localhost:3000"],
  } as const;

  it("generates unique request IDs and returns them in body and headers", async () => {
    const handler = withApiRoute(async (_request, { requestId }) => {
      throw new ApiError(400, "BAD_INPUT", "잘못된 요청입니다.", {
        requestIdSeenByHandler: requestId,
      });
    }, developmentOptions);

    const [first, second] = await Promise.all([
      handler(new Request("http://localhost/api/example")),
      handler(new Request("http://localhost/api/example")),
    ]);
    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(firstBody.error.requestId).toBe(first.headers.get("x-request-id"));
    expect(secondBody.error.requestId).toBe(second.headers.get("x-request-id"));
    expect(firstBody.error.requestId).not.toBe(secondBody.error.requestId);
    expect(firstBody.error.code).toBe("BAD_INPUT");
  });

  it("hides internal exception messages and details", async () => {
    const handler = withApiRoute(async () => {
      throw new Error("DATABASE_URL=postgresql://secret@db/internal");
    }, developmentOptions);

    const response = await handler(
      new Request("http://localhost/api/example", {
        headers: { "x-request-id": "safe-request-id" },
      }),
    );
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(text).toContain("INTERNAL_SERVER_ERROR");
    expect(text).toContain("safe-request-id");
    expect(text).not.toContain("DATABASE_URL");
    expect(text).not.toContain("secret@db");
  });

  it.each(CREATORX_TOSS_ORIGINS)(
    "returns exact CORS headers for Toss origin %s",
    async (origin) => {
      const handler = withApiRoute(
        async () => Response.json({ ok: true }),
        { isProduction: true, developmentOrigins: [] },
      );
      const response = await handler(
        new Request("https://api.creatorx.example/example", {
          headers: { origin },
        }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
      expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
      expect(response.headers.get("vary")).toContain("Origin");
    },
  );

  it("allows an explicitly configured local origin during development", async () => {
    const handler = withApiRoute(
      async () => Response.json({ ok: true }),
      developmentOptions,
    );
    const response = await handler(
      new Request("http://localhost/api/example", {
        headers: { origin: "http://localhost:3000" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000",
    );
  });

  it("rejects an unknown origin before running the handler", async () => {
    const implementation = vi.fn(async () => Response.json({ ok: true }));
    const handler = withApiRoute(implementation, developmentOptions);
    const response = await handler(
      new Request("http://localhost/api/example", {
        headers: { origin: "https://evil.example" },
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(implementation).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      error: { code: "CORS_ORIGIN_DENIED" },
    });
  });

  it("provides a reusable exact-origin OPTIONS preflight handler", async () => {
    const preflight = createCorsPreflightHandler({
      isProduction: true,
      developmentOrigins: [],
    });
    const allowed = await preflight(
      new Request("https://api.creatorx.example/example", {
        method: "OPTIONS",
        headers: {
          origin: CREATORX_TOSS_ORIGINS[0],
          "access-control-request-method": "POST",
        },
      }),
    );
    const rejected = await preflight(
      new Request("https://api.creatorx.example/example", {
        method: "OPTIONS",
        headers: {
          origin: "https://evil.example",
          "access-control-request-method": "POST",
        },
      }),
    );

    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      CREATORX_TOSS_ORIGINS[0],
    );
    expect(allowed.headers.get("access-control-allow-methods")).toContain(
      "POST",
    );
    expect(rejected.status).toBe(403);
    expect(rejected.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("requires HTTPS in production and accepts an exact trusted forwarded protocol", async () => {
    const handler = withApiRoute(
      async () => Response.json({ ok: true }),
      {
        isProduction: true,
        developmentOrigins: [],
        trustForwardedProto: true,
      },
    );

    const rejected = await handler(
      new Request("http://api.creatorx.example/example"),
    );
    const forwarded = await handler(
      new Request("http://api.creatorx.example/example", {
        headers: { "x-forwarded-proto": "https" },
      }),
    );

    expect(rejected.status).toBe(426);
    expect(await rejected.json()).toMatchObject({
      error: { code: "HTTPS_REQUIRED" },
    });
    expect(rejected.headers.get("upgrade")).toBe("TLS/1.2");
    expect(forwarded.status).toBe(200);
  });
});

describe("isSecureRequest", () => {
  it.each([
    ["https://api.creatorx.example/path", undefined, false, true],
    ["http://api.creatorx.example/path", "https", true, true],
    ["http://api.creatorx.example/path", "https", false, false],
    ["http://api.creatorx.example/path", undefined, true, false],
    ["http://api.creatorx.example/path", "https, http", true, false],
    ["http://api.creatorx.example/path", "HTTPS ", true, true],
  ])(
    "validates transport %s / %s",
    (url, forwardedProto, trustProxy, expected) => {
      const headers = forwardedProto
        ? { "x-forwarded-proto": forwardedProto }
        : undefined;
      expect(isSecureRequest(new Request(url, { headers }), trustProxy)).toBe(
        expected,
      );
    },
  );
});

describe("hashRateLimitKey", () => {
  it("uses a server secret and a domain-separated HMAC", () => {
    const expected = createHmac("sha256", "test-server-pepper")
      .update(["creatorx-rate-limit", "trade", "192.0.2.10"].join("\0"))
      .digest("hex");

    expect(
      hashRateLimitKey("trade", "192.0.2.10", "test-server-pepper"),
    ).toBe(expected);
    expect(
      hashRateLimitKey("trade", "192.0.2.10", "different-pepper"),
    ).not.toBe(expected);
  });
});
