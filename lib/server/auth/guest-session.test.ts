import { createHmac } from "node:crypto";
import { decodeJwt, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";

import {
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  ACCESS_TOKEN_TTL_SECONDS,
  ACCESS_TOKEN_TYPE,
  createGuestSubject,
  issueCreatorXAccessToken,
  verifyCreatorXAccessToken,
} from "@/lib/server/auth/guest-session";
import { resolveRequestPrincipal } from "@/lib/server/auth/request-auth";

const security = {
  accessTokenSecret: "unit-test-access-secret-with-at-least-thirty-two-bytes",
  identityPepper: "unit-test-identity-pepper-with-at-least-thirty-two-bytes",
};

describe("CreatorX guest-session token security", () => {
  it("derives the guest subject with the server pepper and never returns the anonymous key", () => {
    const anonymousKey = "anonymous-device-key";

    const subject = createGuestSubject(anonymousKey, security.identityPepper);

    expect(subject).toBe(
      createHmac("sha256", security.identityPepper)
        .update(anonymousKey)
        .digest("hex"),
    );
    expect(subject).not.toContain(anonymousKey);
    expect(subject).toHaveLength(64);
  });

  it("issues a 15-minute CreatorX access JWT with server-owned identity claims", async () => {
    vi.useFakeTimers();
    const issuedAt = new Date("2026-07-13T00:00:00.000Z");
    vi.setSystemTime(issuedAt);

    try {
      const accessToken = await issueCreatorXAccessToken(
        {
          userId: "user-1",
          sessionId: "session-1",
          provider: "guest",
          role: "USER",
        },
        security,
      );
      const payload = decodeJwt(accessToken);

      expect(payload).toMatchObject({
        iss: ACCESS_TOKEN_ISSUER,
        aud: ACCESS_TOKEN_AUDIENCE,
        type: ACCESS_TOKEN_TYPE,
        sub: "user-1",
        sid: "session-1",
        provider: "guest",
        role: "USER",
        iat: Math.floor(issuedAt.getTime() / 1000),
        exp:
          Math.floor(issuedAt.getTime() / 1000) + ACCESS_TOKEN_TTL_SECONDS,
      });
      expect(payload.jti).toEqual(expect.any(String));

      await expect(verifyCreatorXAccessToken(accessToken, security)).resolves.toEqual({
        userId: "user-1",
        sessionId: "session-1",
        provider: "guest",
        role: "USER",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects expired or wrong-type access tokens", async () => {
    const secret = new TextEncoder().encode(security.accessTokenSecret);
    const expiredAt = Math.floor(
      new Date("2026-07-13T00:00:00.000Z").getTime() / 1000,
    );
    const expired = await new SignJWT({
      type: ACCESS_TOKEN_TYPE,
      sid: "session-1",
      provider: "guest",
      role: "USER",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setSubject("user-1")
      .setJti("expired-token")
      .setIssuedAt(expiredAt)
      .setExpirationTime(expiredAt + ACCESS_TOKEN_TTL_SECONDS - 1)
      .sign(secret);
    const wrongType = await new SignJWT({
      type: "refresh",
      sid: "session-1",
      provider: "guest",
      role: "USER",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setSubject("user-1")
      .setJti("wrong-type-token")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(secret);

    await expect(verifyCreatorXAccessToken(expired, security)).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
    await expect(
      verifyCreatorXAccessToken(wrongType, security),
    ).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
  });
});

describe("unified request principal resolution", () => {
  it("falls back to a browser NextAuth session only when no bearer token is supplied", async () => {
    const authenticateBrowser = vi.fn().mockResolvedValue({
      userId: "browser-user",
      provider: "google" as const,
      role: "ADMIN" as const,
    });

    await expect(
      resolveRequestPrincipal(new Request("https://creatorx.test/api/auth/session"), {
        authenticateBrowser,
      }),
    ).resolves.toEqual({
      userId: "browser-user",
      provider: "google",
      role: "ADMIN",
    });
    expect(authenticateBrowser).toHaveBeenCalledTimes(1);
  });

  it("prefers a verified bearer principal over the browser session", async () => {
    const authenticateBrowser = vi.fn();
    const verifyAccessToken = vi.fn().mockResolvedValue({
      userId: "guest-user",
      sessionId: "guest-session",
      provider: "guest" as const,
      role: "USER" as const,
    });

    await expect(
      resolveRequestPrincipal(
        new Request("https://creatorx.test/api/auth/session", {
          headers: { authorization: "Bearer verified-access-token" },
        }),
        { authenticateBrowser, verifyAccessToken },
      ),
    ).resolves.toEqual({
      userId: "guest-user",
      sessionId: "guest-session",
      provider: "guest",
      role: "USER",
    });
    expect(verifyAccessToken).toHaveBeenCalledWith("verified-access-token");
    expect(authenticateBrowser).not.toHaveBeenCalled();
  });

  it("does not fall back to a browser session when an Authorization header is malformed", async () => {
    const authenticateBrowser = vi.fn().mockResolvedValue({
      userId: "browser-user",
      provider: "google" as const,
      role: "USER" as const,
    });

    await expect(
      resolveRequestPrincipal(
        new Request("https://creatorx.test/api/auth/session", {
          headers: { authorization: "Basic browser-credentials" },
        }),
        { authenticateBrowser },
      ),
    ).rejects.toMatchObject({ status: 401, code: "UNAUTHORIZED" });
    expect(authenticateBrowser).not.toHaveBeenCalled();
  });
});
