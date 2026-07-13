import {
  createGuestSessionRequestSchema,
  creatorXSessionTokensSchema,
  refreshCreatorXSessionRequestSchema,
  type CreatorXSessionTokens,
} from "@/lib/contracts/session";
import { CreatorXClientError } from "@/lib/data/errors";

export type CreatorXSessionClientOptions = {
  baseUrl: URL;
  fetchFn?: typeof fetch;
};

function sessionUnavailable() {
  return new CreatorXClientError(
    "SESSION_UNAVAILABLE",
    "CreatorX session could not be refreshed. Please sign in again.",
    true,
  );
}

function assertRootHttpsOrigin(value: URL): URL {
  const url = new URL(value.toString());
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new CreatorXClientError(
      "CONFIG_INVALID",
      "A root HTTPS CreatorX API origin is required.",
      false,
    );
  }
  return url;
}

/** Typed browser boundary for CreatorX-owned guest-session lifecycle calls. */
export class CreatorXSessionClient {
  private readonly baseUrl: URL;
  private readonly fetchFn: typeof fetch;

  constructor({ baseUrl, fetchFn = fetch }: CreatorXSessionClientOptions) {
    this.baseUrl = assertRootHttpsOrigin(baseUrl);
    this.fetchFn = fetchFn;
  }

  async createGuest(
    input: { anonymousKey: string },
  ): Promise<CreatorXSessionTokens> {
    const parsedInput = createGuestSessionRequestSchema.safeParse(input);
    if (!parsedInput.success) throw sessionUnavailable();
    return await this.requestTokens("/api/auth/guest", parsedInput.data);
  }

  async refresh(input: { refreshToken: string }): Promise<CreatorXSessionTokens> {
    const parsedInput = refreshCreatorXSessionRequestSchema.safeParse(input);
    if (!parsedInput.success) throw sessionUnavailable();
    return await this.requestTokens(
      "/api/auth/guest/refresh",
      parsedInput.data,
    );
  }

  private async requestTokens(
    path: "/api/auth/guest" | "/api/auth/guest/refresh",
    input: Record<string, string>,
  ): Promise<CreatorXSessionTokens> {
    let response: Response;
    try {
      response = await this.fetchFn(
        new URL(path, this.baseUrl).toString(),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
          credentials: "same-origin",
          redirect: "error",
        },
      );
    } catch {
      throw sessionUnavailable();
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw sessionUnavailable();
    const tokens = creatorXSessionTokensSchema.safeParse(body);
    if (!tokens.success) throw sessionUnavailable();
    return tokens.data;
  }
}
