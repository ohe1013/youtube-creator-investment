import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTossSession: vi.fn(),
}));

vi.mock("@/lib/server/auth/providers/toss", () => ({
  createTossSession: mocks.createTossSession,
}));

import { POST } from "@/app/api/auth/toss/exchange/route";

beforeEach(() => mocks.createTossSession.mockReset());

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
    expect(mocks.createTossSession).not.toHaveBeenCalled();
  });

  it("passes only the authorization code and referrer to the server provider and returns CreatorX tokens", async () => {
    mocks.createTossSession.mockResolvedValue({
      accessToken: "creatorx-access-token",
      refreshToken: "creatorx-refresh-token",
      tokenType: "Bearer",
      expiresIn: 900,
    });

    const response = await POST(
      new Request("http://localhost/api/auth/toss/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          authorizationCode: "single-use-code",
          referrer: "SANDBOX",
          userId: "client-controlled",
          accessToken: "forbidden-toss-access-token",
          refreshToken: "forbidden-toss-refresh-token",
        }),
      }),
    );

    expect(mocks.createTossSession).toHaveBeenCalledWith({
      authorizationCode: "single-use-code",
      referrer: "SANDBOX",
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      accessToken: "creatorx-access-token",
      refreshToken: "creatorx-refresh-token",
      tokenType: "Bearer",
      expiresIn: 900,
    });
  });
});
