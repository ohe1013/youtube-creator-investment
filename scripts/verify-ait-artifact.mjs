import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { AITReader } from "@apps-in-toss/ait-format";

export const MAX_AIT_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

const EXPECTED_APP_NAME = "creatorx";
const EXPECTED_FORMAT_VERSION = 1;
const WEB_ENTRYPOINT = "web/index.html";
const MAX_AIT_UNCOMPRESSED_BYTES_BIGINT = BigInt(MAX_AIT_UNCOMPRESSED_BYTES);
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

/** @typedef {string | URL | ArrayBuffer | Uint8Array} ArtifactSource */

const specificSecretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:/@]+:[^\s/@]+@/i,
];

const genericSecretAssignmentPattern =
  /(?:^|[\s,{;])(?:["']([A-Za-z][A-Za-z0-9_-]{1,63})["']|([A-Za-z][A-Za-z0-9_-]{1,63}))\s*[:=]\s*(?:"([^"\r\n]{8,})"|'([^'\r\n]{8,})'|`([^`\r\n]{8,})`|([^\s,;}]{8,}))/gim;

const nextPublicAssignmentPattern =
  /(["']?NEXT_PUBLIC_[A-Z0-9_]+["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[^\s,;}]+)/gi;

export class AitArtifactVerificationError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "AitArtifactVerificationError";
    this.code = code;
  }
}

function rejectArtifact(code, message, cause) {
  throw new AitArtifactVerificationError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function normalizeEntryName(name) {
  return name.replaceAll("\\", "/");
}

function formatErrorLabel(value) {
  return String(value).replace(/[\0-\x1f\x7f]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function assertSafeEntryPath(rawName, normalizedName) {
  if (
    rawName.length === 0 ||
    /[\0-\x1f\x7f]/.test(rawName) ||
    normalizedName.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalizedName)
  ) {
    rejectArtifact(
      "AIT_ENTRY_PATH",
      `Unsafe artifact entry path: ${formatErrorLabel(rawName)}`,
    );
  }

  const segments = normalizedName.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    rejectArtifact(
      "AIT_ENTRY_PATH",
      `Unsafe artifact entry path: ${formatErrorLabel(rawName)}`,
    );
  }
}

function decodeReadablePayload(payload) {
  try {
    const text = utf8Decoder.decode(payload);
    if (text.includes("\0")) return null;

    let controlCharacters = 0;
    for (const character of text) {
      const code = character.charCodeAt(0);
      if ((code < 9 || (code > 13 && code < 32)) && code !== 27) {
        controlCharacters += 1;
      }
    }

    return text.length > 0 && controlCharacters / text.length > 0.02
      ? null
      : text;
  } catch {
    return null;
  }
}

function scrubPublicConfiguration(text) {
  return text.replace(nextPublicAssignmentPattern, '$1"<public-config>"');
}

function isPlaceholderValue(value) {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith("process.env.") ||
    normalized.startsWith("import.meta.env.") ||
    normalized.startsWith("${") ||
    normalized.startsWith("<") ||
    normalized.startsWith("your-") ||
    normalized.startsWith("your_") ||
    normalized.startsWith("example") ||
    normalized.startsWith("replace") ||
    normalized === "changeme" ||
    normalized === "undefined" ||
    normalized === "null"
  );
}

function isSensitiveConfigurationKey(key) {
  const normalized = key.replaceAll("-", "_");
  if (normalized.toUpperCase().startsWith("NEXT_PUBLIC_")) return false;

  if (/^[A-Z0-9_]+$/.test(normalized)) {
    return (
      /^(?:[A-Z0-9]+_)*API_KEY$/.test(normalized) ||
      /^(?:[A-Z0-9]+_)*(?:CLIENT_SECRET|PASSWORD|PRIVATE_KEY|DATABASE_URL|DB_PASSWORD|SECRET_ACCESS_KEY)$/.test(
        normalized,
      ) ||
      /^(?:JWT|AUTH|API|ACCESS|REFRESH|BOT|SLACK|GITHUB|GITLAB|OAUTH|SESSION)_TOKEN$/.test(
        normalized,
      ) ||
      /^(?:[A-Z0-9]+_)*(?:SECRET|SECRET_KEY)$/.test(normalized) ||
      /^(?:TOKEN|PASSWORD|PRIVATE_KEY|DATABASE_URL)$/.test(normalized)
    );
  }

  return new Set([
    "apiKey",
    "clientSecret",
    "secret",
    "secretKey",
    "token",
    "accessToken",
    "refreshToken",
    "authToken",
    "password",
    "privateKey",
    "databaseUrl",
    "dbPassword",
    "jwtSecret",
    "nextAuthSecret",
    "cronSecret",
    "serviceAccountKey",
  ]).has(normalized);
}

function containsLikelySecret(text) {
  const scrubbed = scrubPublicConfiguration(text);
  if (specificSecretPatterns.some((pattern) => pattern.test(scrubbed))) {
    return true;
  }

  genericSecretAssignmentPattern.lastIndex = 0;
  for (const match of scrubbed.matchAll(genericSecretAssignmentPattern)) {
    const key = match[1] ?? match[2] ?? "";
    const value = match[3] ?? match[4] ?? match[5] ?? match[6] ?? "";
    if (isSensitiveConfigurationKey(key) && !isPlaceholderValue(value)) {
      return true;
    }
  }

  return false;
}

function stringifyManifestMetadata(reader) {
  return JSON.stringify(
    {
      appName: reader.appName,
      deploymentId: reader.deploymentId,
      createdBy: reader.bundle.createdBy,
      permissions: reader.permissions,
      metadata: reader.metadata,
    },
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
  );
}

/**
 * @param {ArtifactSource} source
 * @returns {Promise<Uint8Array>}
 */
async function readArtifactSource(source) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);

  if (typeof source !== "string" && !(source instanceof URL)) {
    rejectArtifact(
      "AIT_SOURCE_INVALID",
      "Artifact source must be a path, URL, ArrayBuffer, or Uint8Array",
    );
  }

  try {
    return await readFile(source);
  } catch (error) {
    const sourceLabel = formatErrorLabel(source);
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      rejectArtifact(
        "AIT_FILE_MISSING",
        `Artifact not found: ${sourceLabel}`,
        error,
      );
    }
    rejectArtifact(
      "AIT_FILE_READ",
      `Unable to read artifact: ${sourceLabel}`,
      error,
    );
  }
}

function createReader(buffer) {
  try {
    return AITReader.fromBuffer(buffer, {
      supportedVersions: [EXPECTED_FORMAT_VERSION],
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AITVersionError"
    ) {
      rejectArtifact(
        "AIT_FORMAT_VERSION",
        `AIT format version must be ${EXPECTED_FORMAT_VERSION}`,
        error,
      );
    }
    rejectArtifact("AIT_MALFORMED", "Malformed AIT artifact", error);
  }
}

/**
 * @param {ArtifactSource} [source]
 */
export async function verifyAitArtifact(source = "creatorx.ait") {
  const artifact = await readArtifactSource(source);
  const reader = createReader(artifact);

  if (
    reader.formatVersion !== EXPECTED_FORMAT_VERSION ||
    reader.bundle.formatVersion !== EXPECTED_FORMAT_VERSION
  ) {
    rejectArtifact(
      "AIT_FORMAT_VERSION",
      `AIT format version must be ${EXPECTED_FORMAT_VERSION}`,
    );
  }

  if (reader.appName !== EXPECTED_APP_NAME) {
    rejectArtifact(
      "AIT_APP_NAME",
      `AIT appName must be ${EXPECTED_APP_NAME}`,
    );
  }

  if (reader.permissions.length !== 0) {
    rejectArtifact("AIT_PERMISSIONS", "AIT permissions must be exactly []");
  }

  const rawEntryNames = reader.listEntries();
  const normalizedEntryNames = [];
  const normalizedEntrySet = new Set();
  let uncompressedBytes = 0n;

  for (let index = 0; index < rawEntryNames.length; index += 1) {
    const rawName = rawEntryNames[index];
    const normalizedName = normalizeEntryName(rawName);
    assertSafeEntryPath(rawName, normalizedName);

    if (normalizedEntrySet.has(normalizedName)) {
      rejectArtifact(
        "AIT_DUPLICATE_ENTRY",
        `Duplicate normalized artifact entry: ${normalizedName}`,
      );
    }

    normalizedEntrySet.add(normalizedName);
    normalizedEntryNames.push(normalizedName);

    const indexedSize = reader.bundle.index[index]?.uncompressedSize;
    if (typeof indexedSize !== "bigint" || indexedSize < 0n) {
      rejectArtifact(
        "AIT_MALFORMED",
        `Invalid size for artifact entry: ${normalizedName}`,
      );
    }
    uncompressedBytes += indexedSize;
    if (uncompressedBytes >= MAX_AIT_UNCOMPRESSED_BYTES_BIGINT) {
      rejectArtifact(
        "AIT_SIZE_LIMIT",
        `AIT uncompressed size must be less than ${MAX_AIT_UNCOMPRESSED_BYTES} bytes`,
      );
    }
  }

  const hasWebIndex = normalizedEntrySet.has(WEB_ENTRYPOINT);
  if (!hasWebIndex) {
    rejectArtifact("AIT_WEB_INDEX", `AIT entry is required: ${WEB_ENTRYPOINT}`);
  }

  for (let index = 0; index < rawEntryNames.length; index += 1) {
    const rawName = rawEntryNames[index];
    const normalizedName = normalizedEntryNames[index];
    let payload;
    try {
      payload = await reader.readEntry(rawName);
    } catch (error) {
      rejectArtifact(
        "AIT_ENTRY_READ",
        `Unable to read artifact entry: ${normalizedName}`,
        error,
      );
    }

    if (BigInt(payload.byteLength) !== reader.bundle.index[index].uncompressedSize) {
      rejectArtifact(
        "AIT_ENTRY_SIZE",
        `Artifact entry size mismatch: ${normalizedName}`,
      );
    }

    const readablePayload = decodeReadablePayload(payload);
    if (readablePayload !== null && containsLikelySecret(readablePayload)) {
      rejectArtifact(
        "AIT_SECRET_DETECTED",
        `Suspected secret in entry ${normalizedName}`,
      );
    }
  }

  if (containsLikelySecret(stringifyManifestMetadata(reader))) {
    rejectArtifact(
      "AIT_SECRET_DETECTED",
      "Suspected secret in manifest metadata",
    );
  }

  const artifactBytes = artifact.byteLength;
  return {
    artifactBytes,
    fileBytes: artifactBytes,
    uncompressedBytes: Number(uncompressedBytes),
    maxBytes: MAX_AIT_UNCOMPRESSED_BYTES,
    entryCount: rawEntryNames.length,
    formatVersion: reader.formatVersion,
    appName: reader.appName,
    deploymentId: reader.deploymentId,
    permissions: [],
    hasWebIndex,
    entrypoint: WEB_ENTRYPOINT,
  };
}

function normalizeCliError(error) {
  if (error instanceof AitArtifactVerificationError) return error;
  return new AitArtifactVerificationError(
    "AIT_VERIFICATION_FAILED",
    "Artifact verification failed",
    { cause: error },
  );
}

export async function runCli(
  argv = process.argv.slice(2),
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  try {
    if (argv.length > 1) {
      rejectArtifact(
        "AIT_USAGE",
        "Usage: node scripts/verify-ait-artifact.mjs [artifact-path]",
      );
    }
    const result = await verifyAitArtifact(argv[0] ?? "creatorx.ait");
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const normalizedError = normalizeCliError(error);
    stderr.write(`${normalizedError.code}: ${normalizedError.message}\n`);
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
