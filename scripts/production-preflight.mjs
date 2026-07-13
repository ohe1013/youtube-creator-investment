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

const LOCAL_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
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

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function isRemoteHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized !== "localhost" &&
    !isPrivateIpv4(normalized) &&
    !LOCAL_HOSTNAME_SUFFIXES.some(
      (suffix) => normalized === suffix.slice(1) || normalized.endsWith(suffix),
    ) &&
    normalized !== "::1" &&
    !/^(?:fc|fd|fe[89ab])[0-9a-f:]*$/i.test(normalized)
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
}

function assertDate(key, value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    fail(`${key} must be an ISO date`);
  }
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
  assertPostgresUrl("DATABASE_URL", databaseUrl);
  assertPostgresUrl("DIRECT_URL", directUrl);

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
  readUrl(
    "NEXT_PUBLIC_CREATORX_SUPPORT_URL",
    requireValue(env, "NEXT_PUBLIC_CREATORX_SUPPORT_URL"),
  );
  readUrl(
    "NEXT_PUBLIC_CREATORX_ICON_URL",
    requireValue(env, "NEXT_PUBLIC_CREATORX_ICON_URL"),
  );
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
