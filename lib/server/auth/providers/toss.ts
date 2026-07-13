import "server-only";

import type { CreatorXSessionTokens } from "@/lib/contracts/session";
import { readServerEnv } from "@/lib/config/server-env";
import {
  createCreatorXSessionForIdentity,
  revokeCreatorXSessionFamily,
} from "@/lib/server/auth/guest-session";
import type { AuthPrincipal } from "@/lib/server/auth/types";
import { ApiError } from "@/lib/server/http/api-error";
import {
  createTossLoginGateway,
  type ManagedTossLoginGateway,
  TossLoginGatewayError,
} from "@/lib/server/toss/login-gateway";

export type TossLoginInput = {
  authorizationCode: string;
  referrer: "DEFAULT" | "SANDBOX";
};

export type TossLoginProviderDependencies = {
  createGateway?: () => ManagedTossLoginGateway;
  createCreatorXSession?: (subject: string) => Promise<CreatorXSessionTokens>;
};

function createConfiguredGateway(): ManagedTossLoginGateway {
  const env = readServerEnv();
  return createTossLoginGateway({
    enabled: env.tossLoginEnabled,
    certificateBase64: env.tossMtlsCertificateBase64,
    privateKeyBase64: env.tossMtlsPrivateKeyBase64,
  });
}

async function createTossIdentitySession(subject: string) {
  return createCreatorXSessionForIdentity({ provider: "TOSS", subject });
}

function normalizeProviderError(error: unknown): never {
  if (error instanceof TossLoginGatewayError) {
    if (error.code === "TOSS_LOGIN_UNAVAILABLE") {
      throw new ApiError(403, "TOSS_LOGIN_UNAVAILABLE", "Toss Login is not enabled.");
    }
    throw new ApiError(401, "TOSS_LOGIN_FAILED", "Toss Login could not be completed.");
  }
  throw error;
}

async function closeGateway(gateway: ManagedTossLoginGateway) {
  try {
    await gateway.close();
  } catch {
    // Cleanup must not replace an authenticated result or expose connection detail.
  }
}

/**
 * Exchanges the one-use Toss authorization code, resolves only userKey, then
 * creates a CreatorX session. Toss access/refresh tokens stay request-local.
 */
export async function createTossSession(
  input: TossLoginInput,
  dependencies: TossLoginProviderDependencies = {},
): Promise<CreatorXSessionTokens> {
  let gateway: ManagedTossLoginGateway;
  try {
    gateway = (dependencies.createGateway ?? createConfiguredGateway)();
  } catch (error) {
    return normalizeProviderError(error);
  }

  try {
    const { accessToken } = await gateway.exchangeCode(input);
    const { userKey } = await gateway.loginMe(accessToken);
    return await (dependencies.createCreatorXSession ?? createTossIdentitySession)(
      String(userKey),
    );
  } catch (error) {
    return normalizeProviderError(error);
  } finally {
    await closeGateway(gateway);
  }
}

/**
 * This endpoint revokes CreatorX sessions only. It intentionally does not call
 * Toss' partner unlink API because CreatorX never persists Toss access tokens.
 */
export async function unlinkCurrentTossSession(principal: AuthPrincipal) {
  if (principal.provider !== "toss" || !principal.sessionId) {
    throw new ApiError(403, "TOSS_SESSION_REQUIRED", "Toss Login is required.");
  }
  await revokeCreatorXSessionFamily(principal.sessionId);
}
