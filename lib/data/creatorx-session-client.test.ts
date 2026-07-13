import { describe, expect, it, vi } from "vitest";

import { CreatorXSessionClient } from "@/lib/data/creatorx-session-client";

const baseUrl = new URL("https://api.example.com");

describe("CreatorXSessionClient", () => {
  it("creates a server-owned guest session through the typed same-origin boundary", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      Response.json({
        accessToken: "creatorx-access-token-created",
        refreshToken: "creatorx-refresh-token-created",
        tokenType: "Bearer",
        expiresIn: 900,
      }),
    );
    const client = new CreatorXSessionClient({ baseUrl, fetchFn }) as CreatorXSessionClient & {
      createGuest(input: { anonymousKey: string }): Promise<unknown>;
    };

    await expect(
      Promise.resolve().then(() =>
        client.createGuest({ anonymousKey: "sandbox-game-user-key" }),
      ),
    ).resolves.toEqual({
      accessToken: "creatorx-access-token-created",
      refreshToken: "creatorx-refresh-token-created",
      tokenType: "Bearer",
      expiresIn: 900,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/guest",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ anonymousKey: "sandbox-game-user-key" }),
        credentials: "same-origin",
        redirect: "error",
      },
    );
  });

  it("rotates a CreatorX refresh token through the typed same-origin boundary", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      Response.json({
        accessToken: "creatorx-access-token-next",
        refreshToken: "creatorx-refresh-token-next",
        tokenType: "Bearer",
        expiresIn: 900,
      }),
    );
    const client = new CreatorXSessionClient({ baseUrl, fetchFn });

    await expect(
      client.refresh({ refreshToken: "creatorx-refresh-token-current" }),
    ).resolves.toEqual({
      accessToken: "creatorx-access-token-next",
      refreshToken: "creatorx-refresh-token-next",
      tokenType: "Bearer",
      expiresIn: 900,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.example.com/api/auth/guest/refresh",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "creatorx-refresh-token-current" }),
        credentials: "same-origin",
        redirect: "error",
      },
    );
  });

  it("rejects a non-root API URL before it can issue a session request", () => {
    const fetchFn = vi.fn();

    expect(
      () =>
        new CreatorXSessionClient({
          baseUrl: new URL("https://api.example.com/v1"),
          fetchFn,
        }),
    ).toThrow(expect.objectContaining({ code: "CONFIG_INVALID" }));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("normalizes a server failure without retaining its response detail", async () => {
    const secret = "rotation-database-detail";
    const fetchFn = vi.fn().mockResolvedValue(
      Response.json({ error: { message: secret } }, { status: 500 }),
    );
    const client = new CreatorXSessionClient({ baseUrl, fetchFn });

    const error = await client
      .refresh({ refreshToken: "creatorx-refresh-token-current" })
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      code: "SESSION_UNAVAILABLE",
      retryable: true,
    });
    expect(String(error)).not.toContain(secret);
  });
});
