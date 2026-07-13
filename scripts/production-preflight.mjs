import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const REQUIRED_PRODUCTION_VARIABLES = [
  "DATABASE_URL",
  "DIRECT_URL",
  "CREATORX_ACCESS_TOKEN_SECRET",
  "CREATORX_IDENTITY_PEPPER",
  "CRON_SECRET",
  "NEXT_PUBLIC_CREATORX_API_BASE_URL",
  "NEXT_PUBLIC_CREATORX_OPERATOR_NAME",
  "NEXT_PUBLIC_CREATORX_SUPPORT_URL",
  "NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT",
  "NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE",
  "NEXT_PUBLIC_CREATORX_ICON_URL",
];

const LEGACY_TOSS_LOGO_URL =
  "https://static.toss.im/icons/png/4x/icon-toss-logo.png";
const SANDBOX_OPERATOR_NAME = "CreatorX \uAC1C\uBC1C\uD300";
const SANDBOX_SUPPORT_URL =
  "https://github.com/ohe1013/youtube-creator-investment/issues";
const SANDBOX_PRIVACY_CONTACT = "GitHub Issues";
const DEFAULT_POSTGRES_PORT = "5432";
const POSTGRES_ENDPOINT_OVERRIDE_PARAMETERS = new Set([
  "host",
  "hostaddr",
  "port",
  "dbname",
  "service",
]);
const LOCAL_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".localdomain",
  ".home.arpa",
];

export class ProductionPreflightError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductionPreflightError";
    this.code = "PRODUCTION_PREFLIGHT_FAILED";
  }
}

function fail(message) {
  throw new ProductionPreflightError(message);
}

function requireValue(env, key) {
  const value = env[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`Missing production variable: ${key}`);
  }
  return value.trim();
}

function canonicalHostname(hostname) {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/g, "");
}

function decodePathname(pathname) {
  let decoded = pathname;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded.normalize("NFKC").toLowerCase();
}

function isTossBrandIcon(value) {
  const url = new URL(value);
  if (value === LEGACY_TOSS_LOGO_URL) return true;
  if (canonicalHostname(url.hostname) !== "static.toss.im") return false;

  const compactPathname = decodePathname(url.pathname).replace(
    /[^a-z0-9]+/g,
    "",
  );
  return compactPathname.includes("tosslogo");
}

function parseIpv4(hostname) {
  const parts = hostname.split(".").map(Number);
  return parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function mappedIpv4(hostname) {
  const match = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(
    hostname,
  );
  if (!match) return null;

  const high = Number.parseInt(match[1], 16);
  const low = Number.parseInt(match[2], 16);
  return [high >>> 8, high & 0xff, low >>> 8, low & 0xff];
}

function isPrivateIpv4(parts) {
  if (!parts) return false;
  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function isRemoteHostname(hostname) {
  const normalized = canonicalHostname(hostname);
  const ipv4 = parseIpv4(normalized);
  const mapped = mappedIpv4(normalized);
  const isPrivateIpv6 =
    normalized === "::" ||
    normalized === "::1" ||
    /^(?:fc|fd|fe[89ab])/i.test(normalized);
  const isLocalNamespace = LOCAL_HOSTNAME_SUFFIXES.some(
    (suffix) => normalized === suffix.slice(1) || normalized.endsWith(suffix),
  );
  return (
    normalized !== "localhost" &&
    !normalized.endsWith(".localhost") &&
    !(!ipv4 && !normalized.includes(".") && !normalized.includes(":")) &&
    !isLocalNamespace &&
    !isPrivateIpv4(ipv4) &&
    !isPrivateIpv4(mapped) &&
    !isPrivateIpv6
  );
}

function readUrl(key, value, { rootOnly = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${key} must be a remote HTTPS URL`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !isRemoteHostname(url.hostname) ||
    (rootOnly && (url.pathname !== "/" || url.search || url.hash))
  ) {
    fail(`${key} must be a remote HTTPS URL`);
  }
  return url;
}

function assertPostgresUrl(key, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${key} must be a PostgreSQL URL`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    fail(`${key} must be a PostgreSQL URL`);
  }
  const hostname = canonicalPostgresHostname(key, url);
  if (!hostname || !isRemoteHostname(hostname)) {
    fail(`${key} must be a remote PostgreSQL URL`);
  }
  return {
    url,
    hostname,
    databasePathname: postgresDatabasePathname(
      key,
      rawPostgresPathname(key, value),
    ),
  };
}

function decodePostgresUriComponent(key, value) {
  try {
    return decodeURIComponent(value);
  } catch {
    fail(`${key} must be a PostgreSQL URL`);
  }
}

function canonicalPostgresHostname(key, url) {
  return canonicalHostname(decodePostgresUriComponent(key, url.hostname));
}

function rawPostgresPathname(key, value) {
  const schemeEnd = value.indexOf(":");
  const authorityStart = schemeEnd + 3;
  if (schemeEnd < 0 || value.slice(schemeEnd + 1, authorityStart) !== "//") {
    fail(`${key} must be a PostgreSQL URL`);
  }

  const authorityAndPath = value.slice(authorityStart);
  const separator = authorityAndPath.search(/[/?#]/);
  if (separator < 0 || authorityAndPath[separator] !== "/") return "";

  const pathnameAndSuffix = authorityAndPath.slice(separator);
  const suffix = pathnameAndSuffix.search(/[?#]/);
  return suffix < 0 ? pathnameAndSuffix : pathnameAndSuffix.slice(0, suffix);
}

function postgresDatabasePathname(key, rawPathname) {
  const pathname = decodePostgresUriComponent(key, rawPathname);
  if (
    !/^\/[^/]+$/.test(pathname) ||
    pathname === "/." ||
    pathname === "/.."
  ) {
    fail(`${key} must use a single PostgreSQL database path segment`);
  }
  return pathname;
}

function assertNoPostgresEndpointOverrides(key, connection) {
  for (const parameter of connection.url.searchParams.keys()) {
    if (POSTGRES_ENDPOINT_OVERRIDE_PARAMETERS.has(parameter.toLowerCase())) {
      fail(`${key} must not override PostgreSQL endpoint via query parameters`);
    }
  }
}

function isPgbouncerUrl(connection) {
  const values = connection.url.searchParams
    .getAll("pgbouncer")
    .map((value) => value.toLowerCase());
  return values.length === 1 && values[0] === "true";
}

function assertPooledRuntimeUrl(connection) {
  if (!isPgbouncerUrl(connection)) {
    fail("DATABASE_URL must be a pooled PostgreSQL URL");
  }
}

function assertDirectMigrationUrl(connection) {
  if (
    connection.url.searchParams
      .getAll("pgbouncer")
      .some((value) => value.toLowerCase() === "true")
  ) {
    fail("DIRECT_URL must be a direct PostgreSQL URL");
  }
}

function hasSamePostgresEndpoint(left, right) {
  return (
    left.hostname === right.hostname &&
    (left.url.port || DEFAULT_POSTGRES_PORT) ===
      (right.url.port || DEFAULT_POSTGRES_PORT)
  );
}

function assertDistinctPostgresEndpoints(databaseConnection, directConnection) {
  if (hasSamePostgresEndpoint(databaseConnection, directConnection)) {
    fail("DATABASE_URL and DIRECT_URL must use different PostgreSQL endpoints");
  }
}

function assertSamePostgresDatabase(databaseConnection, directConnection) {
  if (
    databaseConnection.databasePathname !== directConnection.databasePathname
  ) {
    fail("DATABASE_URL and DIRECT_URL must use the same PostgreSQL database");
  }
}

function assertDate(key, value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    fail(`${key} must be an ISO date`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) {
    fail(`${key} must be an ISO date`);
  }
}

function isSandboxSupportPlaceholder(value) {
  const url = new URL(value);
  const pathname = url.pathname.replace(/\/+$/g, "");
  return (
    url.protocol === "https:" &&
    canonicalHostname(url.hostname) === "github.com" &&
    pathname === new URL(SANDBOX_SUPPORT_URL).pathname
  );
}

function assertPem(key, encoded, marker) {
  const value = requireValue({ [key]: encoded }, key);
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    fail(`${key} must be valid base64 PEM`);
  }

  const decoded = Buffer.from(value, "base64").toString("utf8");
  const pem = new RegExp(
    "^-----BEGIN [A-Z0-9 ]*" +
      marker +
      "-----\\r?\\n[\\s\\S]+\\r?\\n-----END [A-Z0-9 ]*" +
      marker +
      "-----\\r?\\n?$",
  );
  if (!pem.test(decoded)) fail(`${key} must be valid base64 PEM`);
}

/**
 * Validate only production-safe inputs and return a deliberately secret-free
 * summary suitable for CLI output.
 *
 * @param {Record<string, string | undefined>} env
 */
export function validateProductionEnvironment(env = process.env) {
  for (const key of REQUIRED_PRODUCTION_VARIABLES) requireValue(env, key);

  const databaseUrl = requireValue(env, "DATABASE_URL");
  const directUrl = requireValue(env, "DIRECT_URL");
  const databaseConnection = assertPostgresUrl("DATABASE_URL", databaseUrl);
  const directConnection = assertPostgresUrl("DIRECT_URL", directUrl);
  assertNoPostgresEndpointOverrides("DATABASE_URL", databaseConnection);
  assertNoPostgresEndpointOverrides("DIRECT_URL", directConnection);
  if (databaseUrl === directUrl) {
    fail("DATABASE_URL and DIRECT_URL must not be the same URL");
  }
  assertPooledRuntimeUrl(databaseConnection);
  assertDirectMigrationUrl(directConnection);
  assertDistinctPostgresEndpoints(databaseConnection, directConnection);
  assertSamePostgresDatabase(databaseConnection, directConnection);

  if (requireValue(env, "CREATORX_ACCESS_TOKEN_SECRET").length < 32) {
    fail("CREATORX_ACCESS_TOKEN_SECRET must be at least 32 characters");
  }
  if (requireValue(env, "CREATORX_IDENTITY_PEPPER").length < 32) {
    fail("CREATORX_IDENTITY_PEPPER must be at least 32 characters");
  }
  if (
    env.VERCEL !== "1" &&
    env.CREATORX_TRUST_PROXY !== "1"
  ) {
    fail("production requires a trusted proxy attestation");
  }
  if (env.CREATORX_DEV_CORS_ORIGINS?.trim()) {
    fail("production cannot enable development CORS origins");
  }
  if (env.NEXT_PUBLIC_APP_IN_TOSS !== "1") {
    fail("production requires NEXT_PUBLIC_APP_IN_TOSS=1");
  }
  if (env.NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL !== "production") {
    fail("production requires public release channel production");
  }
  if (env.NEXT_PUBLIC_CREATORX_DATA_MODE !== "remote") {
    fail("production requires remote data mode");
  }

  readUrl(
    "NEXT_PUBLIC_CREATORX_API_BASE_URL",
    requireValue(env, "NEXT_PUBLIC_CREATORX_API_BASE_URL"),
    { rootOnly: true },
  );
  const supportUrl = requireValue(env, "NEXT_PUBLIC_CREATORX_SUPPORT_URL");
  readUrl(
    "NEXT_PUBLIC_CREATORX_SUPPORT_URL",
    supportUrl,
  );
  if (isSandboxSupportPlaceholder(supportUrl)) {
    fail("NEXT_PUBLIC_CREATORX_SUPPORT_URL must be a verified support URL");
  }
  const iconUrl = requireValue(env, "NEXT_PUBLIC_CREATORX_ICON_URL");
  readUrl(
    "NEXT_PUBLIC_CREATORX_ICON_URL",
    iconUrl,
  );
  if (isTossBrandIcon(iconUrl)) {
    fail("NEXT_PUBLIC_CREATORX_ICON_URL must be CreatorX-owned, not the Toss logo");
  }
  if (
    requireValue(env, "NEXT_PUBLIC_CREATORX_OPERATOR_NAME") ===
    SANDBOX_OPERATOR_NAME
  ) {
    fail("NEXT_PUBLIC_CREATORX_OPERATOR_NAME must be a verified operator name");
  }
  if (
    requireValue(env, "NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT").toLowerCase() ===
    SANDBOX_PRIVACY_CONTACT.toLowerCase()
  ) {
    fail("NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT must be a verified privacy contact");
  }
  assertDate(
    "NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE",
    requireValue(env, "NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE"),
  );

  const serverTossLogin = env.TOSS_LOGIN_ENABLED ?? "0";
  const publicTossLogin = env.NEXT_PUBLIC_CREATORX_TOSS_LOGIN_ENABLED ?? "0";
  if (
    !["0", "1"].includes(serverTossLogin) ||
    !["0", "1"].includes(publicTossLogin) ||
    serverTossLogin !== publicTossLogin
  ) {
    fail("Toss Login flags must agree");
  }
  if (serverTossLogin === "1") {
    assertPem("TOSS_MTLS_CERT_BASE64", env.TOSS_MTLS_CERT_BASE64, "CERTIFICATE");
    assertPem("TOSS_MTLS_KEY_BASE64", env.TOSS_MTLS_KEY_BASE64, "PRIVATE KEY");
  }

  return {
    releaseChannel: "production",
    tossLoginEnabled: serverTossLogin === "1",
  };
}

export async function runCli(
  argv = process.argv.slice(2),
  { env = process.env, stdout = process.stdout, stderr = process.stderr } = {},
) {
  try {
    if (argv.length !== 0) fail("Usage: node scripts/production-preflight.mjs");
    const summary = validateProductionEnvironment(env);
    stdout.write(`Production preflight passed: ${JSON.stringify(summary)}\n`);
    return 0;
  } catch (error) {
    const message =
      error instanceof ProductionPreflightError
        ? error.message
        : "production preflight failed";
    stderr.write(`PRODUCTION_PREFLIGHT_FAILED: ${message}\n`);
    return 1;
  }
}

function isMainModule() {
  const invokedPath = process.argv[1];
  return Boolean(
    invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url,
  );
}

if (isMainModule()) {
  process.exitCode = await runCli();
}
