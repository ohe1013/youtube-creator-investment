import { ApiError } from "@/lib/server/http/api-error";

export const CREATORX_TOSS_ORIGINS = [
  "https://creatorx.private-apps.tossmini.com",
  "https://creatorx.apps.tossmini.com",
] as const;

const LOCAL_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home.arpa",
] as const;

function canonicalHostname(url: URL) {
  return url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
}

function parseIpv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  return parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function isPrivateIpv4(parts: number[] | null) {
  if (!parts) return false;
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function isLocalHostname(hostname: string) {
  if (hostname === "localhost") return true;
  if (isPrivateIpv4(parseIpv4(hostname))) return true;
  if (
    hostname === "::1" ||
    /^(?:fc|fd)[0-9a-f:]+$/i.test(hostname) ||
    /^fe[89ab][0-9a-f:]+$/i.test(hostname)
  ) {
    return true;
  }
  return LOCAL_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

export function parseDevelopmentOrigins(value?: string) {
  if (!value?.trim()) return [];

  const entries = value.split(",").map((entry) => entry.trim());
  if (entries.length > 16 || entries.some((entry) => entry.length === 0)) {
    throw new Error(
      "CREATORX_DEV_CORS_ORIGINS must contain explicit local origins",
    );
  }

  const origins = entries.map((entry) => {
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new Error("development CORS entries must be an exact local origin");
    }

    const hostname = canonicalHostname(url);
    const isExactOrigin = entry === url.origin;
    const hasAllowedProtocol =
      url.protocol === "http:" || url.protocol === "https:";
    if (
      entry === "*" ||
      !isExactOrigin ||
      !hasAllowedProtocol ||
      !isLocalHostname(hostname) ||
      url.username ||
      url.password
    ) {
      throw new Error("development CORS entries must be an exact local origin");
    }
    return url.origin;
  });

  return [...new Set(origins)];
}

export function resolveAllowedOrigins(options: {
  isProduction: boolean;
  developmentOrigins: readonly string[];
}) {
  if (options.isProduction && options.developmentOrigins.length > 0) {
    throw new Error("production cannot enable development CORS origins");
  }
  const developmentOrigins = options.isProduction
    ? []
    : parseDevelopmentOrigins(options.developmentOrigins.join(","));
  return new Set<string>([...CREATORX_TOSS_ORIGINS, ...developmentOrigins]);
}

export function assertCorsOriginAllowed(
  request: Request,
  allowedOrigins: ReadonlySet<string>,
) {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  if (!allowedOrigins.has(origin)) {
    throw new ApiError(
      403,
      "CORS_ORIGIN_DENIED",
      "이 출처에서는 요청할 수 없습니다.",
    );
  }
  return origin;
}

function appendVary(headers: Headers, value: string) {
  const existing = headers.get("vary");
  const values = existing
    ? existing.split(",").map((entry) => entry.trim())
    : [];
  if (!values.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
    values.push(value);
  }
  headers.set("vary", values.join(", "));
}

export function withCors(response: Response, allowedOrigin: string | null) {
  if (!allowedOrigin) return response;

  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", allowedOrigin);
  headers.set("access-control-allow-credentials", "true");
  headers.set(
    "access-control-allow-methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  );
  headers.set(
    "access-control-allow-headers",
    "Authorization, Content-Type, Idempotency-Key, X-Request-Id",
  );
  appendVary(headers, "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
