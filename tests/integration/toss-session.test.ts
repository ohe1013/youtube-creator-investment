import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { createTossSession } from "@/lib/server/auth/providers/toss";
import { verifyCreatorXAccessToken } from "@/lib/server/auth/guest-session";
import type { ManagedTossLoginGateway } from "@/lib/server/toss/login-gateway";

const prisma = new PrismaClient();
const createdUserIds: string[] = [];

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds.splice(0) } } });
  }
});

afterAll(() => prisma.$disconnect());

describe.sequential("Toss Login CreatorX session provider", () => {
  it("maps only the numeric Toss userKey into a TOSS identity and returns CreatorX tokens", async () => {
    const tossAccessToken = "toss-access-token-must-not-persist";
    const tossRefreshToken = "toss-refresh-token-must-not-persist";
    const gateway = {
      exchangeCode: vi.fn().mockResolvedValue({
        accessToken: tossAccessToken,
        refreshToken: tossRefreshToken,
        tokenType: "Bearer" as const,
        expiresIn: 3599,
      }),
      refresh: vi.fn(),
      loginMe: vi.fn().mockResolvedValue({ userKey: "443731104" }),
      close: vi.fn().mockResolvedValue(undefined),
    } satisfies ManagedTossLoginGateway;

    const tokens = await createTossSession(
      { authorizationCode: "single-use-code", referrer: "SANDBOX" },
      { createGateway: () => gateway },
    );
    const principal = await verifyCreatorXAccessToken(tokens.accessToken);
    createdUserIds.push(principal.userId);

    expect(gateway.exchangeCode).toHaveBeenCalledWith({
      authorizationCode: "single-use-code",
      referrer: "SANDBOX",
    });
    expect(gateway.loginMe).toHaveBeenCalledWith(tossAccessToken);
    expect(gateway.refresh).not.toHaveBeenCalled();
    expect(gateway.close).toHaveBeenCalledTimes(1);
    expect(tokens).toMatchObject({ tokenType: "Bearer", expiresIn: 15 * 60 });
    expect(tokens.accessToken).not.toBe(tossAccessToken);
    expect(tokens.refreshToken).not.toBe(tossRefreshToken);
    expect(principal).toMatchObject({ provider: "toss", role: "USER" });

    const identity = await prisma.authIdentity.findUniqueOrThrow({
      where: { provider_subject: { provider: "TOSS", subject: "443731104" } },
      include: { user: true, sessions: true },
    });
    const session = identity.sessions.find(({ id }) => id === principal.sessionId);

    expect(identity).toMatchObject({ provider: "TOSS", subject: "443731104" });
    expect(identity.user).toMatchObject({
      id: principal.userId,
      role: "USER",
      name: null,
      email: null,
      image: null,
    });
    expect(session?.refreshTokenHash).not.toContain(tossAccessToken);
    expect(session?.refreshTokenHash).not.toContain(tossRefreshToken);
    expect(session?.refreshTokenHash).not.toContain(tokens.refreshToken);
    await expect(prisma.account.count({ where: { userId: principal.userId } })).resolves.toBe(0);
  });
});
