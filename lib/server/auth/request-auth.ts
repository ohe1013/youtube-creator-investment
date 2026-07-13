import "server-only";

import { ApiError } from "@/lib/server/http/api-error";
import {
  verifyCreatorXAccessToken,
  type VerifyCreatorXAccessToken,
} from "@/lib/server/auth/guest-session";
import { authenticateNextAuthRequest } from "@/lib/server/auth/providers/nextauth";
import type { AuthPrincipal } from "@/lib/server/auth/types";

export type RequestAuthDependencies = {
  verifyAccessToken?: VerifyCreatorXAccessToken;
  authenticateBrowser?: () => Promise<AuthPrincipal | null>;
};

export function readBearer(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;

  const match = /^Bearer ([^\s]+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

export async function resolveRequestPrincipal(
  request: Request,
  dependencies: RequestAuthDependencies = {},
): Promise<AuthPrincipal> {
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    const bearer = readBearer(request);
    if (!bearer) {
      throw new ApiError(401, "UNAUTHORIZED", "Authentication is required.");
    }
    return (dependencies.verifyAccessToken ?? verifyCreatorXAccessToken)(bearer);
  }

  const browser = await (
    dependencies.authenticateBrowser ?? authenticateNextAuthRequest
  )();
  if (browser) return browser;

  throw new ApiError(401, "UNAUTHORIZED", "Authentication is required.");
}

export function requirePrincipal(request: Request): Promise<AuthPrincipal> {
  return resolveRequestPrincipal(request);
}
