import "server-only";

import { Agent, fetch, type Dispatcher } from "undici";

export const TOSS_LOGIN_BASE_URL = "https://apps-in-toss-api.toss.im";
const GENERATE_TOKEN_PATH =
  "/api-partner/v1/apps-in-toss/user/oauth2/generate-token";
const REFRESH_TOKEN_PATH =
  "/api-partner/v1/apps-in-toss/user/oauth2/refresh-token";
const LOGIN_ME_PATH = "/api-partner/v1/apps-in-toss/user/oauth2/login-me";
const MAX_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

export type TossTokens = {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
};

export interface TossLoginGateway {
  exchangeCode(input: {
    authorizationCode: string;
    referrer: "DEFAULT" | "SANDBOX";
  }): Promise<TossTokens>;
  refresh(refreshToken: string): Promise<TossTokens>;
  loginMe(accessToken: string): Promise<{ userKey: string }>;
}

/** A request-scoped gateway with explicit mTLS connection cleanup. */
export interface ManagedTossLoginGateway extends TossLoginGateway {
  close(): Promise<void>;
}

export type TossLoginGatewayConfig = {
  enabled: boolean;
  certificateBase64: string | null | undefined;
  privateKeyBase64: string | null | undefined;
};

type TossFetch = (
  input: string,
  init: {
    method: "GET" | "POST";
    headers: Record<string, string>;
    body?: string;
    dispatcher: Dispatcher;
    redirect: "error";
  },
) => Promise<Pick<Response, "ok" | "json">>;

export type TossLoginGatewayDependencies = {
  createAgent(options: { connect: { cert: string; key: string } }): Dispatcher;
  fetch: TossFetch;
};

const defaultDependencies: TossLoginGatewayDependencies = {
  createAgent: (options) => new Agent(options),
  fetch,
};

export class TossLoginGatewayError extends Error {
  readonly code: "TOSS_LOGIN_UNAVAILABLE" | "TOSS_LOGIN_UPSTREAM_ERROR";

  constructor(code: TossLoginGatewayError["code"]) {
    super(
      code === "TOSS_LOGIN_UNAVAILABLE"
        ? "Toss Login is not enabled for this service."
        : "Toss Login is temporarily unavailable.",
    );
    this.name = "TossLoginGatewayError";
    this.code = code;
  }
}

function unavailable(): never {
  throw new TossLoginGatewayError("TOSS_LOGIN_UNAVAILABLE");
}

function upstreamError(): never {
  throw new TossLoginGatewayError("TOSS_LOGIN_UPSTREAM_ERROR");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function decodePem(
  encoded: string | null | undefined,
  expectedMarker: "CERTIFICATE" | "PRIVATE KEY",
) {
  const value = encoded?.trim();
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    return unavailable();
  }

  let decoded: string;
  try {
    decoded = Buffer.from(value, "base64").toString("utf8");
  } catch {
    return unavailable();
  }

  const pem = new RegExp(
    "^-----BEGIN [A-Z0-9 ]*" +
      expectedMarker +
      "-----\\r?\\n[\\s\\S]+\\r?\\n-----END [A-Z0-9 ]*" +
      expectedMarker +
      "-----\\r?\\n?$",
  );
  if (!pem.test(decoded)) return unavailable();
  return decoded;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) return upstreamError();
  return value;
}

function readAccessTokenLifetime(value: unknown) {
  const expiresIn =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^(?:[1-9][0-9]*)$/.test(value)
        ? Number(value)
        : null;
  if (
    expiresIn === null ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn <= 0 ||
    expiresIn > MAX_ACCESS_TOKEN_TTL_SECONDS
  ) {
    return upstreamError();
  }
  return expiresIn;
}

function readTokens(value: unknown): TossTokens {
  if (!isRecord(value)) return upstreamError();

  const tokenType = requiredString(value.tokenType);
  const accessToken = requiredString(value.accessToken);
  const refreshToken = requiredString(value.refreshToken);
  const expiresIn = readAccessTokenLifetime(value.expiresIn);
  if (
    tokenType.toLowerCase() !== "bearer"
  ) {
    return upstreamError();
  }

  return { accessToken, refreshToken, tokenType: "Bearer", expiresIn };
}

function readUserKey(value: unknown) {
  if (!isRecord(value)) return upstreamError();
  const userKey = value.userKey;
  if (
    typeof userKey !== "number" ||
    !Number.isSafeInteger(userKey) ||
    userKey <= 0
  ) {
    return upstreamError();
  }
  return { userKey: String(userKey) };
}

async function readSuccess(
  response: Pick<Response, "ok" | "json">,
): Promise<unknown> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return upstreamError();
  }

  if (!response.ok || !isRecord(payload) || payload.resultType !== "SUCCESS") {
    return upstreamError();
  }
  return payload.success;
}

function createRequest(
  dispatcher: Dispatcher,
  path: string,
  init: Omit<Parameters<TossFetch>[1], "dispatcher">,
) {
  return {
    url: TOSS_LOGIN_BASE_URL + path,
    init: { ...init, dispatcher },
  };
}

/**
 * Creates a server-only mTLS client. Toss access/refresh tokens returned by this
 * gateway are deliberately request-local; callers must not persist or return them.
 */
export function createTossLoginGateway(
  config: TossLoginGatewayConfig,
  dependencies: TossLoginGatewayDependencies = defaultDependencies,
): ManagedTossLoginGateway {
  if (!config.enabled) return unavailable();

  const cert = decodePem(config.certificateBase64, "CERTIFICATE");
  const key = decodePem(config.privateKeyBase64, "PRIVATE KEY");
  const dispatcher = dependencies.createAgent({ connect: { cert, key } });
  let closed = false;

  return {
    async exchangeCode({ authorizationCode, referrer }) {
      const request = createRequest(dispatcher, GENERATE_TOKEN_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorizationCode, referrer }),
        redirect: "error",
      });
      try {
        return readTokens(await readSuccess(await dependencies.fetch(request.url, request.init)));
      } catch (error) {
        if (error instanceof TossLoginGatewayError) throw error;
        return upstreamError();
      }
    },
    async refresh(refreshToken) {
      const request = createRequest(dispatcher, REFRESH_TOKEN_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        redirect: "error",
      });
      try {
        return readTokens(await readSuccess(await dependencies.fetch(request.url, request.init)));
      } catch (error) {
        if (error instanceof TossLoginGatewayError) throw error;
        return upstreamError();
      }
    },
    async loginMe(accessToken) {
      const request = createRequest(dispatcher, LOGIN_ME_PATH, {
        method: "GET",
        headers: { authorization: "Bearer " + accessToken },
        redirect: "error",
      });
      try {
        return readUserKey(await readSuccess(await dependencies.fetch(request.url, request.init)));
      } catch (error) {
        if (error instanceof TossLoginGatewayError) throw error;
        return upstreamError();
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await dispatcher.close();
    },
  };
}
