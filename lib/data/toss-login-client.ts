import {
  creatorXSessionTokensSchema,
  type CreatorXSessionTokens,
} from "@/lib/contracts/session";
import { CreatorXClientError } from "@/lib/data/errors";

export type TossLoginExchangeInput = {
  authorizationCode: string;
  referrer: "DEFAULT" | "SANDBOX";
};

export type TossLoginClientOptions = {
  baseUrl: URL;
  fetchFn?: typeof fetch;
};

function sessionUnavailable() {
  return new CreatorXClientError(
    "SESSION_UNAVAILABLE",
    "Toss Login could not be completed. Please try again.",
    true,
  );
}

function tossLoginUnavailable() {
  return new CreatorXClientError(
    "TOSS_LOGIN_UNAVAILABLE",
    "Toss Login is not enabled. Complete Toss Business verification and configure the server mTLS certificate before enabling it.",
    false,
    403,
  );
}

function isUnavailableEnvelope(value: unknown) {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "object" &&
    value.error !== null &&
    "code" in value.error &&
    value.error.code === "TOSS_LOGIN_UNAVAILABLE"
  );
}

/** Typed browser boundary for CreatorX's Toss Login endpoints only. */
export class TossLoginClient {
  private readonly baseUrl: URL;
  private readonly fetchFn: typeof fetch;

  constructor({ baseUrl, fetchFn = fetch }: TossLoginClientOptions) {
    this.baseUrl = new URL(baseUrl.toString());
    this.fetchFn = fetchFn;
  }

  async exchange(input: TossLoginExchangeInput): Promise<CreatorXSessionTokens> {
    let response: Response;
    try {
      response = await this.fetchFn(
        new URL("/api/auth/toss/exchange", this.baseUrl).toString(),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            authorizationCode: input.authorizationCode,
            referrer: input.referrer,
          }),
          credentials: "omit",
        },
      );
    } catch {
      throw sessionUnavailable();
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok && isUnavailableEnvelope(body)) throw tossLoginUnavailable();
    if (!response.ok) throw sessionUnavailable();
    const parsed = creatorXSessionTokensSchema.safeParse(body);
    if (!parsed.success) throw sessionUnavailable();
    return parsed.data;
  }

  async unlink(accessToken: string): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchFn(
        new URL("/api/auth/toss/unlink", this.baseUrl).toString(),
        {
          method: "POST",
          headers: { authorization: "Bearer " + accessToken },
          credentials: "omit",
        },
      );
    } catch {
      throw sessionUnavailable();
    }
    if (!response.ok) throw sessionUnavailable();
  }
}
