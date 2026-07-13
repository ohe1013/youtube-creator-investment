import { describe, expect, it, vi } from "vitest";

import { TossLoginClient } from "@/lib/data/toss-login-client";

const baseUrl = new URL("https://api.example.com");

describe("TossLoginClient", () => {
  it("posts only the App-in-Toss authorization code and referrer and returns CreatorX tokens", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      Response.json({
        accessToken: "creatorx-access-token",
        refreshToken: "creatorx-refresh-token",
        tokenType: "Bearer",
        expiresIn: 900,
      }),
    );
    const client = new TossLoginClient({ baseUrl, fetchFn });

    const untrustedBridgeResult = {
      authorizationCode: "single-use-code",
      referrer: "SANDBOX" as const,
      userId: "client-controlled",
      accessToken: "forbidden-toss-token",
    };

    await expect(client.exchange(untrustedBridgeResult)).resolves.toEqual({
      accessToken: "creatorx-access-token",
      refreshToken: "creatorx-refresh-token",
      tokenType: "Bearer",
      expiresIn: 900,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/toss/exchange",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          authorizationCode: "single-use-code",
          referrer: "SANDBOX",
        }),
        credentials: "same-origin",
        redirect: "error",
      },
    );
  });

  it("normalizes a redirect rejection without forwarding the authorization code", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValue(new TypeError("redirect disallowed"));
    const client = new TossLoginClient({ baseUrl, fetchFn });

    const error = await client
      .exchange({ authorizationCode: "single-use-code", referrer: "DEFAULT" })
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      code: "SESSION_UNAVAILABLE",
      retryable: true,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/toss/exchange",
      expect.objectContaining({
        credentials: "same-origin",
        redirect: "error",
      }),
    );
  });

  it("normalizes a server-side missing credential gate without exposing its detail", async () => {
    const secret = "server mTLS certificate missing";
    const fetchFn = vi.fn().mockResolvedValue(
      Response.json(
        { error: { code: "TOSS_LOGIN_UNAVAILABLE", message: secret } },
        { status: 403 },
      ),
    );
    const client = new TossLoginClient({ baseUrl, fetchFn });

    const error = await client
      .exchange({ authorizationCode: "single-use-code", referrer: "DEFAULT" })
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      code: "TOSS_LOGIN_UNAVAILABLE",
      retryable: false,
    });
    expect(String(error)).not.toContain(secret);
  });

  it("uses only the CreatorX access token to revoke the local session", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new TossLoginClient({ baseUrl, fetchFn });

    await expect(client.unlink("creatorx-access-token")).resolves.toBeUndefined();
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/toss/unlink",
      {
        method: "POST",
        headers: { authorization: "Bearer creatorx-access-token" },
        credentials: "same-origin",
        redirect: "error",
      },
    );
  });
});
