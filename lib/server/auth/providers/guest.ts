import "server-only";

import { ApiError } from "@/lib/server/http/api-error";
import { readServerEnv } from "@/lib/config/server-env";
import {
  createGuestSession,
  refreshCreatorXSession,
  revokeCreatorXSessionFamily,
} from "@/lib/server/auth/guest-session";

/**
 * Guest identities are a sandbox/development bridge fallback only. The route
 * boundary calls this before issuing or rotating any guest token in order to
 * keep a production deployment Toss-login-only.
 */
export function assertGuestSessionsAllowed(
  isProduction = readServerEnv().isProduction,
) {
  if (isProduction) {
    throw new ApiError(
      403,
      "GUEST_SESSION_UNAVAILABLE",
      "Guest sessions are not available in production.",
    );
  }
}

export {
  createGuestSession,
  refreshCreatorXSession,
  revokeCreatorXSessionFamily,
};
