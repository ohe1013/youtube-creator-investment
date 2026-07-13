import { createHash, createHmac, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { POST as createGuest } from "@/app/api/auth/guest/route";
import { POST as refreshGuest } from "@/app/api/auth/guest/refresh/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as getSession } from "@/app/api/auth/session/route";
import {
  refreshCreatorXSession,
  verifyCreatorXAccessToken,
} from "@/lib/server/auth/guest-session";

const prisma = new PrismaClient();
const createdUserIds: string[] = [];

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds.splice(0) } } });
  }
});

afterAll(() => prisma.$disconnect());

async function createGuestSession(anonymousKey = `guest-${randomUUID()}`) {
  const response = await createGuest(
    new Request("http://localhost/api/auth/guest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        anonymousKey,
        userId: "client-selected-user",
        role: "ADMIN",
        balance: "999999999.0000",
        fill: "999999999.00000000",
        price: "0.0001",
        total: "999999999.0000",
      }),
    }),
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as {
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    expiresIn: number;
  };
  const principal = await verifyCreatorXAccessToken(body.accessToken);
  createdUserIds.push(principal.userId);
  return { anonymousKey, body, principal };
}

async function refresh(refreshToken: string) {
  return refreshGuest(
    new Request("http://localhost/api/auth/guest/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        refreshToken,
        userId: "attacker-user",
        role: "ADMIN",
        balance: "0.0000",
        fill: "0.00000000",
        price: "0.0001",
        total: "0.0000",
      }),
    }),
  );
}

describe.sequential("CreatorX guest session lifecycle", () => {
  it("creates a peppered guest identity, server-owned user, and hash-only refresh session", async () => {
    const { anonymousKey, body, principal } = await createGuestSession();
    const pepper = process.env.CREATORX_IDENTITY_PEPPER;
    if (!pepper) throw new Error("CREATORX_IDENTITY_PEPPER is required");

    expect(body).toMatchObject({ tokenType: "Bearer", expiresIn: 15 * 60 });
    expect(Buffer.from(body.refreshToken, "base64url")).toHaveLength(32);
    expect(principal).toMatchObject({ provider: "guest", role: "USER" });

    const identity = await prisma.authIdentity.findUniqueOrThrow({
      where: {
        provider_subject: {
          provider: "GUEST",
          subject: createHmac("sha256", pepper).update(anonymousKey).digest("hex"),
        },
      },
      include: { user: true, sessions: true },
    });
    const session = identity.sessions.find(
      ({ id }) => id === principal.sessionId,
    );

    expect(identity.subject).not.toContain(anonymousKey);
    expect(identity.user).toMatchObject({
      id: principal.userId,
      role: "USER",
    });
    expect(identity.user.balance.toFixed(4)).toBe("100000.0000");
    expect(session).toMatchObject({
      userId: principal.userId,
      refreshTokenHash: createHash("sha256").update(body.refreshToken).digest("hex"),
      revokedAt: null,
    });
    expect(session?.refreshTokenHash).not.toContain(body.refreshToken);

    const sessionResponse = await getSession(
      new Request("http://localhost/api/auth/session", {
        headers: { authorization: `Bearer ${body.accessToken}` },
      }),
    );
    expect(sessionResponse.status).toBe(200);
    expect(sessionResponse.headers.get("cache-control")).toBe("no-store");
    expect(await sessionResponse.json()).toEqual({ principal });
  });

  it("upserts one guest identity for the same anonymous key while issuing independent sessions", async () => {
    const first = await createGuestSession();
    const second = await createGuestSession(first.anonymousKey);

    expect(second.principal.userId).toBe(first.principal.userId);
    expect(second.principal.sessionId).not.toBe(first.principal.sessionId);
    await expect(
      prisma.authIdentity.count({ where: { userId: first.principal.userId } }),
    ).resolves.toBe(1);
  });

  it("rotates the refresh token and revokes its whole family when a replaced token is reused", async () => {
    const initial = await createGuestSession();
    const rotation = await refresh(initial.body.refreshToken);
    expect(rotation.status).toBe(200);
    const replacement = (await rotation.json()) as {
      accessToken: string;
      refreshToken: string;
    };
    const replacementPrincipal = await verifyCreatorXAccessToken(
      replacement.accessToken,
    );

    expect(replacement.refreshToken).not.toBe(initial.body.refreshToken);
    expect(replacementPrincipal.userId).toBe(initial.principal.userId);
    expect(replacementPrincipal.sessionId).not.toBe(initial.principal.sessionId);

    const oldSession = await prisma.appSession.findUniqueOrThrow({
      where: { id: initial.principal.sessionId },
    });
    const newSession = await prisma.appSession.findUniqueOrThrow({
      where: { id: replacementPrincipal.sessionId },
    });
    expect(oldSession).toMatchObject({
      revokedAt: expect.any(Date),
      replacedById: newSession.id,
      refreshFamilyId: newSession.refreshFamilyId,
    });

    const replay = await refresh(initial.body.refreshToken);
    expect(replay.status).toBe(401);
    expect(await replay.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });

    const family = await prisma.appSession.findMany({
      where: { refreshFamilyId: oldSession.refreshFamilyId },
    });
    expect(family).toHaveLength(2);
    expect(family.every(({ revokedAt }) => revokedAt !== null)).toBe(true);
  });

  it("serializes concurrent refresh attempts so the losing attempt revokes the replacement family", async () => {
    const initial = await createGuestSession();
    const responses = await Promise.all([
      refresh(initial.body.refreshToken),
      refresh(initial.body.refreshToken),
    ]);
    const successful = responses.filter((response) => response.status === 200);
    const rejected = responses.filter((response) => response.status === 401);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 401]);
    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const replacement = (await successful[0].json()) as { refreshToken: string };
    const replacementReplay = await refresh(replacement.refreshToken);
    expect(replacementReplay.status).toBe(401);

    const sessions = await prisma.appSession.findMany({
      where: { userId: initial.principal.userId },
    });
    expect(sessions).toHaveLength(2);
    expect(sessions.every(({ revokedAt }) => revokedAt !== null)).toBe(true);
  });

  it("maps a concurrent serializable loser to an unauthorized refresh rejection", async () => {
    const initial = await createGuestSession();
    const outcomes = await Promise.allSettled([
      refreshCreatorXSession(initial.body.refreshToken),
      refreshCreatorXSession(initial.body.refreshToken),
    ]);
    const summary = outcomes.map((outcome) =>
      outcome.status === "fulfilled"
        ? "fulfilled"
        : (outcome.reason as { code?: string }).code ?? "unknown-error",
    );

    expect(summary.sort()).toEqual(["UNAUTHORIZED", "fulfilled"]);
  });

  it("rejects expired and logged-out refresh sessions", async () => {
    const expired = await createGuestSession();
    await prisma.appSession.update({
      where: { id: expired.principal.sessionId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const expiredResponse = await refresh(expired.body.refreshToken);
    expect(expiredResponse.status).toBe(401);

    const active = await createGuestSession();
    const logoutResponse = await logout(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { authorization: `Bearer ${active.body.accessToken}` },
      }),
    );
    expect(logoutResponse.status).toBe(204);

    const revokedResponse = await refresh(active.body.refreshToken);
    expect(revokedResponse.status).toBe(401);
  });
});
