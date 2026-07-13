import "server-only";

import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { Prisma, type IdentityProvider } from "@prisma/client";
import { SignJWT, jwtVerify } from "jose";

import type { CreatorXSessionTokens } from "@/lib/contracts/session";
import { readServerEnv } from "@/lib/config/server-env";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/server/http/api-error";
import type { AuthPrincipal, AuthProvider } from "@/lib/server/auth/types";

export const ACCESS_TOKEN_ISSUER = "creatorx";
export const ACCESS_TOKEN_AUDIENCE = "creatorx-api";
export const ACCESS_TOKEN_TYPE = "creatorx-access";
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 30;

export type AuthSecurity = {
  accessTokenSecret: string;
  identityPepper: string;
};

export type VerifyCreatorXAccessToken = (
  accessToken: string,
) => Promise<AuthPrincipal>;

type TokenPrincipal = Required<Pick<AuthPrincipal, "sessionId">> &
  AuthPrincipal;
export type CreatorXSessionIdentity = {
  id: string;
  userId: string;
  provider: IdentityProvider;
  user: { id: string; role: "USER" | "ADMIN" };
};

export type CreatorXIdentityInput = {
  provider: IdentityProvider;
  subject: string;
};

function configurationError() {
  return new ApiError(
    500,
    "AUTH_CONFIGURATION_ERROR",
    "Authentication is unavailable.",
  );
}

export function readAuthSecurity(): AuthSecurity {
  const env = readServerEnv();
  const accessTokenSecret = env.accessTokenSecret?.trim();
  const identityPepper = env.identityPepper?.trim();

  if (
    !accessTokenSecret ||
    accessTokenSecret.length < 32 ||
    !identityPepper ||
    identityPepper.length < 32
  ) {
    throw configurationError();
  }

  return { accessTokenSecret, identityPepper };
}

function accessTokenKey(security: Pick<AuthSecurity, "accessTokenSecret">) {
  return new TextEncoder().encode(security.accessTokenSecret);
}

function unauthorized() {
  return new ApiError(401, "UNAUTHORIZED", "Authentication is required.");
}

function providerFromIdentity(provider: IdentityProvider): AuthProvider {
  return provider === "GUEST" ? "guest" : "toss";
}

function isAuthProvider(value: unknown): value is AuthProvider {
  return value === "google" || value === "guest" || value === "toss";
}

function isUserRole(value: unknown): value is AuthPrincipal["role"] {
  return value === "USER" || value === "ADMIN";
}

function isTokenPrincipal(principal: AuthPrincipal): principal is TokenPrincipal {
  return typeof principal.sessionId === "string" && principal.sessionId.length > 0;
}

export function createGuestSubject(anonymousKey: string, identityPepper: string) {
  return createHmac("sha256", identityPepper).update(anonymousKey).digest("hex");
}

export function hashRefreshToken(refreshToken: string) {
  return createHash("sha256").update(refreshToken).digest("hex");
}

export function createOpaqueRefreshToken() {
  return randomBytes(32).toString("base64url");
}

export async function issueCreatorXAccessToken(
  principal: TokenPrincipal,
  security: Pick<AuthSecurity, "accessTokenSecret"> = readAuthSecurity(),
) {
  const issuedAt = Math.floor(Date.now() / 1000);

  return new SignJWT({
    type: ACCESS_TOKEN_TYPE,
    sid: principal.sessionId,
    provider: principal.provider,
    role: principal.role,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ACCESS_TOKEN_ISSUER)
    .setAudience(ACCESS_TOKEN_AUDIENCE)
    .setSubject(principal.userId)
    .setJti(randomUUID())
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
    .sign(accessTokenKey(security));
}

export async function verifyCreatorXAccessToken(
  accessToken: string,
  security: Pick<AuthSecurity, "accessTokenSecret"> = readAuthSecurity(),
): Promise<AuthPrincipal> {
  try {
    const { payload } = await jwtVerify(accessToken, accessTokenKey(security), {
      algorithms: ["HS256"],
      issuer: ACCESS_TOKEN_ISSUER,
      audience: ACCESS_TOKEN_AUDIENCE,
    });

    if (
      payload.type !== ACCESS_TOKEN_TYPE ||
      typeof payload.sub !== "string" ||
      payload.sub.length === 0 ||
      typeof payload.sid !== "string" ||
      payload.sid.length === 0 ||
      typeof payload.jti !== "string" ||
      payload.jti.length === 0 ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      !isAuthProvider(payload.provider) ||
      !isUserRole(payload.role)
    ) {
      throw unauthorized();
    }

    return {
      userId: payload.sub,
      sessionId: payload.sid,
      provider: payload.provider,
      role: payload.role,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unauthorized();
  }
}

function toTokenPrincipal(
  identity: CreatorXSessionIdentity,
  sessionId: string,
): TokenPrincipal {
  return {
    userId: identity.userId,
    sessionId,
    provider: providerFromIdentity(identity.provider),
    role: identity.user.role,
  };
}

function expiryDate() {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

async function issueSessionTokens(
  identity: CreatorXSessionIdentity,
  sessionId: string,
  refreshToken: string,
) {
  return {
    accessToken: await issueCreatorXAccessToken(toTokenPrincipal(identity, sessionId)),
    refreshToken,
    tokenType: "Bearer" as const,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  } satisfies CreatorXSessionTokens;
}

async function createSessionForIdentity(
  tx: Prisma.TransactionClient,
  identity: CreatorXSessionIdentity,
  refreshFamilyId: string = randomUUID(),
) {
  const refreshToken = createOpaqueRefreshToken();
  const session = await tx.appSession.create({
    data: {
      userId: identity.userId,
      identityId: identity.id,
      refreshFamilyId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: expiryDate(),
    },
  });

  return { session, refreshToken };
}

async function runSerializable<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const retries = 3;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 10_000,
      });
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";
      if (!retryable || attempt === retries - 1) throw error;
    }
  }

  throw new Error("unreachable serializable transaction state");
}

export async function createGuestSession(
  anonymousKey: string,
): Promise<CreatorXSessionTokens> {
  const security = readAuthSecurity();
  const subject = createGuestSubject(anonymousKey, security.identityPepper);
  return createCreatorXSessionForIdentity({ provider: "GUEST", subject });
}

/**
 * Issues a CreatorX session for a server-verified identity. Provider-specific
 * callers must establish the subject before this function is invoked.
 */
export async function createCreatorXSessionForIdentity(
  input: CreatorXIdentityInput,
): Promise<CreatorXSessionTokens> {
  const created = await runSerializable(async (tx) => {
    const identity = await tx.authIdentity.upsert({
      where: {
        provider_subject: {
          provider: input.provider,
          subject: input.subject,
        },
      },
      update: {},
      create: {
        provider: input.provider,
        subject: input.subject,
        user: {
          create: {
            role: "USER",
            initialBudget: "100000",
            balance: "100000",
          },
        },
      },
      include: { user: { select: { id: true, role: true } } },
    });
    const { session, refreshToken } = await createSessionForIdentity(tx, identity);
    return { identity, sessionId: session.id, refreshToken };
  });

  return issueSessionTokens(
    created.identity,
    created.sessionId,
    created.refreshToken,
  );
}

async function revokeFamily(
  tx: Prisma.TransactionClient,
  refreshFamilyId: string,
  revokedAt: Date,
) {
  await tx.appSession.updateMany({
    where: { refreshFamilyId, revokedAt: null },
    data: { revokedAt },
  });
}

export async function refreshCreatorXSession(
  refreshToken: string,
): Promise<CreatorXSessionTokens> {
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const rotated = await runSerializable(async (tx) => {
    const current = await tx.appSession.findUnique({
      where: { refreshTokenHash },
      include: {
        identity: true,
        user: { select: { id: true, role: true } },
      },
    });
    const now = new Date();

    if (!current) throw unauthorized();
    if (current.replacedById) {
      await revokeFamily(tx, current.refreshFamilyId, now);
      return { reused: true as const };
    }
    if (current.revokedAt || current.expiresAt <= now) throw unauthorized();

    const identity: CreatorXSessionIdentity = {
      id: current.identity.id,
      userId: current.userId,
      provider: current.identity.provider,
      user: current.user,
    };
    const replacement = await createSessionForIdentity(
      tx,
      identity,
      current.refreshFamilyId,
    );
    await tx.appSession.update({
      where: { id: current.id },
      data: {
        revokedAt: now,
        lastUsedAt: now,
        replacedById: replacement.session.id,
      },
    });

    return {
      reused: false as const,
      identity,
      sessionId: replacement.session.id,
      refreshToken: replacement.refreshToken,
    };
  });

  if (rotated.reused) throw unauthorized();
  return issueSessionTokens(rotated.identity, rotated.sessionId, rotated.refreshToken);
}

export async function revokeCreatorXSessionFamily(sessionId: string) {
  await runSerializable(async (tx) => {
    const session = await tx.appSession.findUnique({
      where: { id: sessionId },
      select: { refreshFamilyId: true },
    });
    if (!session) return;
    await revokeFamily(tx, session.refreshFamilyId, new Date());
  });
}

export function hasCreatorXSession(principal: AuthPrincipal): principal is TokenPrincipal {
  return isTokenPrincipal(principal);
}
