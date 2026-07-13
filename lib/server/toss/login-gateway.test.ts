import { describe, expect, it, vi } from "vitest";
import type { Dispatcher } from "undici";

import {
  TOSS_LOGIN_BASE_URL,
  createTossLoginGateway,
} from "@/lib/server/toss/login-gateway";

const certificate = "-----BEGIN CERTIFICATE-----\ncreatorx-test-cert\n-----END CERTIFICATE-----";
const privateKey = "-----BEGIN PRIVATE KEY-----\ncreatorx-test-key\n-----END PRIVATE KEY-----";
const encodedCertificate = Buffer.from(certificate, "utf8").toString("base64");
const encodedPrivateKey = Buffer.from(privateKey, "utf8").toString("base64");

function successResponse(success: unknown) {
  return new Response(JSON.stringify({ resultType: "SUCCESS", success }), {
    headers: { "content-type": "application/json" },
  });
}

function createGatewayHarness() {
  const dispatcher = {
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Dispatcher;
  const createAgent = vi.fn(() => dispatcher);
  const fetch = vi.fn();
  const gateway = createTossLoginGateway(
    {
      enabled: true,
      certificateBase64: encodedCertificate,
      privateKeyBase64: encodedPrivateKey,
    },
    { createAgent, fetch },
  );

  return { createAgent, dispatcher, fetch, gateway };
}

describe("TossLoginGateway", () => {
  it("exchanges an App-in-Toss authorization code over mTLS without logging Toss tokens", async () => {
    const { createAgent, dispatcher, fetch, gateway } = createGatewayHarness();
    const accessToken = "toss-access-token-must-not-be-logged";
    const refreshToken = "toss-refresh-token-must-not-be-logged";
    fetch.mockResolvedValueOnce(
      successResponse({
        tokenType: "Bearer",
        accessToken,
        refreshToken,
        scope: "user_key",
        expiresIn: 3599,
      }),
    );
    const consoleSpies = [
      vi.spyOn(console, "debug"),
      vi.spyOn(console, "error"),
      vi.spyOn(console, "info"),
      vi.spyOn(console, "log"),
      vi.spyOn(console, "warn"),
    ];

    try {
      await expect(
        gateway.exchangeCode({
          authorizationCode: "single-use-code",
          referrer: "SANDBOX",
        }),
      ).resolves.toEqual({
        accessToken,
        refreshToken,
        tokenType: "Bearer",
        expiresIn: 3599,
      });
    } finally {
      consoleSpies.forEach((spy) => spy.mockRestore());
    }

    expect(createAgent).toHaveBeenCalledWith({
      connect: { cert: certificate, key: privateKey },
    });
    expect(fetch).toHaveBeenCalledWith(
      TOSS_LOGIN_BASE_URL +
        "/api-partner/v1/apps-in-toss/user/oauth2/generate-token",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          authorizationCode: "single-use-code",
          referrer: "SANDBOX",
        }),
        dispatcher,
        redirect: "error",
      },
    );
    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("refreshes only through the mTLS transport and keeps one-hour access metadata", async () => {
    const { fetch, gateway } = createGatewayHarness();
    fetch.mockResolvedValueOnce(
      successResponse({
        tokenType: "bearer",
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        scope: "user_key",
        expiresIn: 3600,
      }),
    );

    await expect(gateway.refresh("server-only-refresh-token")).resolves.toEqual({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
    });
    expect(fetch).toHaveBeenCalledWith(
      TOSS_LOGIN_BASE_URL +
        "/api-partner/v1/apps-in-toss/user/oauth2/refresh-token",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "server-only-refresh-token" }),
        redirect: "error",
      }),
    );
  });

  it("normalizes the documented string-form access lifetime to a bounded number", async () => {
    const { fetch, gateway } = createGatewayHarness();
    fetch.mockResolvedValueOnce(
      successResponse({
        tokenType: "Bearer",
        accessToken: "access-token",
        refreshToken: "refresh-token",
        scope: "user_key",
        expiresIn: "3599",
      }),
    );

    await expect(
      gateway.exchangeCode({ authorizationCode: "code", referrer: "DEFAULT" }),
    ).resolves.toMatchObject({ expiresIn: 3599 });
  });

  it("reads only a canonical positive safe-integer userKey with a Bearer access token", async () => {
    const { fetch, gateway } = createGatewayHarness();
    fetch.mockResolvedValueOnce(
      successResponse({
        userKey: 443731104,
        scope: "user_key user_name",
        name: "must-not-be-mapped",
      }),
    );

    await expect(gateway.loginMe("request-local-access-token")).resolves.toEqual({
      userKey: "443731104",
    });
    expect(fetch).toHaveBeenCalledWith(
      TOSS_LOGIN_BASE_URL +
        "/api-partner/v1/apps-in-toss/user/oauth2/login-me",
      expect.objectContaining({
        method: "GET",
        headers: { authorization: "Bearer request-local-access-token" },
        redirect: "error",
      }),
    );
  });

  it.each([
    {
      name: "a raw OAuth error",
      response: new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    },
    {
      name: "a failed result envelope",
      response: new Response(
        JSON.stringify({
          resultType: "FAIL",
          error: { errorCode: "INTERNAL_ERROR", reason: "upstream detail" },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    },
    {
      name: "a malformed success envelope",
      response: successResponse({ accessToken: "unexpected-token" }),
    },
  ])("normalizes $name without leaking upstream values", async ({ response }) => {
    const { fetch, gateway } = createGatewayHarness();
    fetch.mockResolvedValueOnce(response);

    await expect(
      gateway.exchangeCode({ authorizationCode: "code", referrer: "DEFAULT" }),
    ).rejects.toMatchObject({
      code: "TOSS_LOGIN_UPSTREAM_ERROR",
      message: "Toss Login is temporarily unavailable.",
    });
  });

  it("rejects successful-looking tokens outside the documented one-hour access lifetime", async () => {
    const { fetch, gateway } = createGatewayHarness();
    fetch.mockResolvedValueOnce(
      successResponse({
        tokenType: "Bearer",
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: 3601,
      }),
    );

    await expect(
      gateway.exchangeCode({ authorizationCode: "code", referrer: "DEFAULT" }),
    ).rejects.toMatchObject({
      code: "TOSS_LOGIN_UPSTREAM_ERROR",
    });
  });

  it("normalizes a rejected redirect without disclosing the attempted target", async () => {
    const { fetch, gateway } = createGatewayHarness();
    const redirectTarget = "https://untrusted.example/collect";
    fetch.mockRejectedValueOnce(new TypeError("redirect to " + redirectTarget));

    const error = await gateway
      .exchangeCode({ authorizationCode: "code", referrer: "DEFAULT" })
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: "TOSS_LOGIN_UPSTREAM_ERROR" });
    expect(String(error)).not.toContain(redirectTarget);
  });

  it("fails closed when the credential gate is disabled or cert/key material is malformed", () => {
    const attempt = (config: Parameters<typeof createTossLoginGateway>[0]) => {
      try {
        createTossLoginGateway(config, { createAgent: vi.fn(), fetch: vi.fn() });
        throw new Error("expected Toss Login to be unavailable");
      } catch (error) {
        expect(error).toMatchObject({ code: "TOSS_LOGIN_UNAVAILABLE" });
      }
    };

    attempt({
      enabled: false,
      certificateBase64: encodedCertificate,
      privateKeyBase64: encodedPrivateKey,
    });
    attempt({
      enabled: true,
      certificateBase64: "not a certificate",
      privateKeyBase64: encodedPrivateKey,
    });
  });

  it("closes the request-scoped mTLS agent exactly once after use", async () => {
    const { dispatcher, gateway } = createGatewayHarness();

    await gateway.close();
    await gateway.close();

    expect(dispatcher.close).toHaveBeenCalledTimes(1);
  });
});
