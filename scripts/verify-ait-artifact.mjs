import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";

import { AITReader } from "@apps-in-toss/ait-format";

export const MAX_AIT_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

const EXPECTED_APP_NAME = "creatorx";
const EXPECTED_FORMAT_VERSION = 1;
const WEB_ENTRYPOINT = "web/index.html";
const MAX_AIT_UNCOMPRESSED_BYTES_BIGINT = BigInt(MAX_AIT_UNCOMPRESSED_BYTES);
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const zipLegacyNameDecoder = new TextDecoder("latin1", { fatal: true });
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP_EOCD_BYTES = 22;
const ZIP_MAX_COMMENT_BYTES = 65_535;
const ZIP_SUPPORTED_FLAGS = 0x080e;

/** @typedef {string | URL | ArrayBuffer | Uint8Array} ArtifactSource */

/**
 * @typedef {object} ZipMember
 * @property {string} rawName
 * @property {number} flags
 * @property {number} compression
 * @property {number} crc32
 * @property {number} compressedSize
 * @property {number} uncompressedSize
 * @property {number} localHeaderOffset
 * @property {number | undefined} dataOffset
 */

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
  /(["']?(NEXT_PUBLIC_[A-Z0-9_]+)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[^\s,;}]+)/gi;

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
    /^[A-Za-z]:/.test(normalizedName)
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

function rejectMalformedZip(message, cause) {
  rejectArtifact("AIT_ZIP_MALFORMED", message, cause);
}

function assertZipRange(start, length, upperBound, label) {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(length) ||
    start < 0 ||
    length < 0 ||
    start > upperBound ||
    length > upperBound - start
  ) {
    rejectMalformedZip(`ZIP ${label} is out of bounds`);
  }
}

function decodeZipEntryName(bytes, useUtf8) {
  try {
    return (useUtf8 ? utf8Decoder : zipLegacyNameDecoder).decode(bytes);
  } catch (error) {
    rejectMalformedZip("ZIP entry name is not valid text", error);
  }
}

function findZipEocdOffset(zipBlob, view) {
  if (zipBlob.byteLength < ZIP_EOCD_BYTES) {
    rejectMalformedZip("ZIP end-of-central-directory record is missing");
  }

  const minimumOffset = Math.max(
    0,
    zipBlob.byteLength - ZIP_EOCD_BYTES - ZIP_MAX_COMMENT_BYTES,
  );
  for (
    let offset = zipBlob.byteLength - ZIP_EOCD_BYTES;
    offset >= minimumOffset;
    offset -= 1
  ) {
    if (view.getUint32(offset, true) !== ZIP_EOCD_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + ZIP_EOCD_BYTES + commentLength === zipBlob.byteLength) {
      return offset;
    }
  }

  rejectMalformedZip("ZIP end-of-central-directory record is malformed");
}

function validateLocalZipMembers(zipBlob, view, members, centralOffset) {
  const membersByOffset = [...members].sort(
    (left, right) => left.localHeaderOffset - right.localHeaderOffset,
  );
  let expectedOffset = 0;

  for (let index = 0; index < membersByOffset.length; index += 1) {
    const member = membersByOffset[index];
    const localOffset = member.localHeaderOffset;
    const nextOffset =
      membersByOffset[index + 1]?.localHeaderOffset ?? centralOffset;

    if (localOffset !== expectedOffset || nextOffset <= localOffset) {
      rejectArtifact(
        "AIT_ZIP_LOCAL_MISMATCH",
        "ZIP local members are missing, extra, duplicated, or out of order",
      );
    }

    assertZipRange(localOffset, 30, centralOffset, "local header");
    if (view.getUint32(localOffset, true) !== ZIP_LOCAL_SIGNATURE) {
      rejectArtifact(
        "AIT_ZIP_LOCAL_MISMATCH",
        `ZIP local header is missing for ${formatErrorLabel(member.rawName)}`,
      );
    }

    const localFlags = view.getUint16(localOffset + 6, true);
    const localCompression = view.getUint16(localOffset + 8, true);
    const localCrc32 = view.getUint32(localOffset + 14, true);
    const localCompressedSize = view.getUint32(localOffset + 18, true);
    const localUncompressedSize = view.getUint32(localOffset + 22, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localNameOffset = localOffset + 30;
    const localDataOffset =
      localNameOffset + localNameLength + localExtraLength;
    assertZipRange(
      localNameOffset,
      localNameLength + localExtraLength,
      centralOffset,
      "local name and extra fields",
    );

    const localName = decodeZipEntryName(
      zipBlob.subarray(localNameOffset, localNameOffset + localNameLength),
      (localFlags & 0x0800) !== 0,
    );
    if (
      localName !== member.rawName ||
      localFlags !== member.flags ||
      localCompression !== member.compression
    ) {
      rejectArtifact(
        "AIT_ZIP_LOCAL_MISMATCH",
        `ZIP local header disagrees with the central directory for ${formatErrorLabel(member.rawName)}`,
      );
    }

    const dataEnd = localDataOffset + member.compressedSize;
    assertZipRange(
      localDataOffset,
      member.compressedSize,
      centralOffset,
      "compressed member data",
    );
    member.dataOffset = localDataOffset;

    if ((localFlags & 0x0008) === 0) {
      if (
        localCrc32 !== member.crc32 ||
        localCompressedSize !== member.compressedSize ||
        localUncompressedSize !== member.uncompressedSize ||
        dataEnd !== nextOffset
      ) {
        rejectArtifact(
          "AIT_ZIP_LOCAL_MISMATCH",
          `ZIP local sizes disagree with the central directory for ${formatErrorLabel(member.rawName)}`,
        );
      }
    } else {
      let descriptorOffset = dataEnd;
      if (
        descriptorOffset + 4 <= nextOffset &&
        view.getUint32(descriptorOffset, true) === ZIP_DATA_DESCRIPTOR_SIGNATURE
      ) {
        descriptorOffset += 4;
      }
      if (descriptorOffset + 12 !== nextOffset) {
        rejectArtifact(
          "AIT_ZIP_LOCAL_MISMATCH",
          `ZIP data descriptor has an invalid size for ${formatErrorLabel(member.rawName)}`,
        );
      }
      assertZipRange(descriptorOffset, 12, centralOffset, "data descriptor");
      if (
        view.getUint32(descriptorOffset, true) !== member.crc32 ||
        view.getUint32(descriptorOffset + 4, true) !== member.compressedSize ||
        view.getUint32(descriptorOffset + 8, true) !== member.uncompressedSize
      ) {
        rejectArtifact(
          "AIT_ZIP_LOCAL_MISMATCH",
          `ZIP data descriptor disagrees with the central directory for ${formatErrorLabel(member.rawName)}`,
        );
      }
    }

    expectedOffset = nextOffset;
  }

  if (expectedOffset !== centralOffset) {
    rejectArtifact(
      "AIT_ZIP_LOCAL_MISMATCH",
      "ZIP local and central member inventories do not align",
    );
  }
}

function readZipMembers(zipBlob) {
  const view = new DataView(
    zipBlob.buffer,
    zipBlob.byteOffset,
    zipBlob.byteLength,
  );

  try {
    const eocdOffset = findZipEocdOffset(zipBlob, view);
    const diskNumber = view.getUint16(eocdOffset + 4, true);
    const centralDiskNumber = view.getUint16(eocdOffset + 6, true);
    const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
    const entryCount = view.getUint16(eocdOffset + 10, true);
    const centralSize = view.getUint32(eocdOffset + 12, true);
    const centralOffset = view.getUint32(eocdOffset + 16, true);

    if (
      diskNumber !== 0 ||
      centralDiskNumber !== 0 ||
      entriesOnDisk !== entryCount
    ) {
      rejectMalformedZip("Multi-disk ZIP artifacts are not supported");
    }
    if (
      entryCount === 0xffff ||
      centralSize === 0xffffffff ||
      centralOffset === 0xffffffff
    ) {
      rejectMalformedZip("ZIP64 artifacts are not supported");
    }
    assertZipRange(
      centralOffset,
      centralSize,
      eocdOffset,
      "central directory",
    );
    if (centralOffset + centralSize !== eocdOffset) {
      rejectMalformedZip("ZIP central-directory bounds are inconsistent");
    }

    /** @type {ZipMember[]} */
    const members = [];
    const rawNames = new Set();
    let cursor = centralOffset;
    const centralEnd = centralOffset + centralSize;

    for (let index = 0; index < entryCount; index += 1) {
      assertZipRange(cursor, 46, centralEnd, "central member header");
      if (view.getUint32(cursor, true) !== ZIP_CENTRAL_SIGNATURE) {
        rejectMalformedZip("ZIP central member signature is invalid");
      }

      const flags = view.getUint16(cursor + 8, true);
      const compression = view.getUint16(cursor + 10, true);
      const crc32 = view.getUint32(cursor + 16, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const uncompressedSize = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const startDisk = view.getUint16(cursor + 34, true);
      const localHeaderOffset = view.getUint32(cursor + 42, true);
      const recordLength = 46 + nameLength + extraLength + commentLength;
      assertZipRange(cursor, recordLength, centralEnd, "central member record");

      if (
        startDisk !== 0 ||
        compressedSize === 0xffffffff ||
        uncompressedSize === 0xffffffff ||
        localHeaderOffset === 0xffffffff
      ) {
        rejectMalformedZip("ZIP64 member metadata is not supported");
      }
      if (compression !== 0 && compression !== 8) {
        rejectMalformedZip(`ZIP compression method ${compression} is unsupported`);
      }
      if ((flags & ~ZIP_SUPPORTED_FLAGS) !== 0) {
        rejectMalformedZip(`ZIP general-purpose flags ${flags} are unsupported`);
      }

      const nameOffset = cursor + 46;
      const rawName = decodeZipEntryName(
        zipBlob.subarray(nameOffset, nameOffset + nameLength),
        (flags & 0x0800) !== 0,
      );
      if (rawNames.has(rawName)) {
        rejectArtifact(
          "AIT_DUPLICATE_ZIP_ENTRY",
          `Duplicate raw ZIP entry: ${formatErrorLabel(rawName)}`,
        );
      }
      rawNames.add(rawName);
      members.push({
        rawName,
        flags,
        compression,
        crc32,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        dataOffset: undefined,
      });
      cursor += recordLength;
    }

    if (cursor !== centralEnd) {
      rejectMalformedZip("ZIP central-directory entry count is inconsistent");
    }
    validateLocalZipMembers(zipBlob, view, members, centralOffset);
    return members;
  } catch (error) {
    if (error instanceof AitArtifactVerificationError) throw error;
    rejectMalformedZip("Malformed ZIP inventory", error);
  }
}

function readZipMemberPayload(zipBlob, member) {
  if (member.dataOffset === undefined) {
    rejectMalformedZip(
      `ZIP member data offset is missing for ${formatErrorLabel(member.rawName)}`,
    );
  }

  const compressedPayload = zipBlob.subarray(
    member.dataOffset,
    member.dataOffset + member.compressedSize,
  );
  try {
    if (member.compression === 0) return compressedPayload;
    return inflateRawSync(compressedPayload, {
      maxOutputLength: member.uncompressedSize + 1,
    });
  } catch (error) {
    rejectArtifact(
      "AIT_ENTRY_READ",
      `Unable to read artifact entry: ${formatErrorLabel(member.rawName)}`,
      error,
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

function isDynamicRuntimeExpression(value) {
  const normalized = value.trim();
  return (
    !/["'`]/.test(normalized) &&
    !/^[A-Za-z_$][\w$]*\(\s*(?:[-+]?\d|true\b|false\b|null\b|undefined\b)/.test(
      normalized,
    ) &&
    /^(?:[A-Za-z_$][\w$]*)(?:\??\.[A-Za-z_$][\w$]*|\[[^\]\r\n]+\]|\([^()\r\n]*\))*$/.test(
      normalized,
    ) &&
    /[.\[(]/.test(normalized)
  );
}

function isSensitiveConfigurationKey(key) {
  const normalized = key.replaceAll("-", "_");
  if (normalized.toUpperCase().startsWith("NEXT_PUBLIC_")) {
    return /(?:API_KEY|CLIENT_SECRET|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|DATABASE_URL)$/.test(
      normalized.toUpperCase(),
    );
  }

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

function scrubPublicConfiguration(text) {
  return text.replace(
    nextPublicAssignmentPattern,
    (assignment, prefix, key) =>
      isSensitiveConfigurationKey(key)
        ? assignment
        : `${prefix}"<public-config>"`,
  );
}

function containsLikelySecret(text) {
  const scrubbed = scrubPublicConfiguration(text);
  if (specificSecretPatterns.some((pattern) => pattern.test(scrubbed))) {
    return true;
  }

  genericSecretAssignmentPattern.lastIndex = 0;
  for (const match of scrubbed.matchAll(genericSecretAssignmentPattern)) {
    const key = match[1] ?? match[2] ?? "";
    const quotedOrTemplateValue = match[3] ?? match[4] ?? match[5];
    const value = quotedOrTemplateValue ?? match[6] ?? "";
    const isUnquotedValue = quotedOrTemplateValue === undefined;
    if (
      isSensitiveConfigurationKey(key) &&
      !isPlaceholderValue(value) &&
      (!isUnquotedValue || !isDynamicRuntimeExpression(value))
    ) {
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

  const zipBlob = reader.readZipBlob();
  const zipMembers = readZipMembers(zipBlob);
  const indexByRawName = new Map();

  for (const indexEntry of reader.bundle.index) {
    if (indexByRawName.has(indexEntry.name)) {
      rejectArtifact(
        "AIT_ZIP_INDEX_MISMATCH",
        "AIT index contains a duplicate raw member name",
      );
    }
    indexByRawName.set(indexEntry.name, indexEntry);
  }

  if (
    zipMembers.length !== reader.bundle.index.length ||
    zipMembers.some((member) => !indexByRawName.has(member.rawName))
  ) {
    rejectArtifact(
      "AIT_ZIP_INDEX_MISMATCH",
      "AIT index and ZIP inventory must contain identical raw member names",
    );
  }

  const normalizedZipNames = new Set();
  let zipUncompressedBytes = 0n;

  for (const member of zipMembers) {
    const normalizedName = normalizeEntryName(member.rawName);
    assertSafeEntryPath(member.rawName, normalizedName);
    if (normalizedZipNames.has(normalizedName)) {
      rejectArtifact(
        "AIT_DUPLICATE_ENTRY",
        `Duplicate normalized artifact entry: ${normalizedName}`,
      );
    }
    normalizedZipNames.add(normalizedName);
    zipUncompressedBytes += BigInt(member.uncompressedSize);
    if (zipUncompressedBytes >= MAX_AIT_UNCOMPRESSED_BYTES_BIGINT) {
      rejectArtifact(
        "AIT_SIZE_LIMIT",
        `AIT uncompressed size must be less than ${MAX_AIT_UNCOMPRESSED_BYTES} bytes`,
      );
    }
  }

  const normalizedIndexNames = new Set();
  let indexedUncompressedBytes = 0n;

  for (const indexEntry of reader.bundle.index) {
    const rawName = indexEntry.name;
    const normalizedName = normalizeEntryName(rawName);
    assertSafeEntryPath(rawName, normalizedName);
    if (normalizedIndexNames.has(normalizedName)) {
      rejectArtifact(
        "AIT_DUPLICATE_ENTRY",
        `Duplicate normalized artifact entry: ${normalizedName}`,
      );
    }
    if (
      typeof indexEntry.uncompressedSize !== "bigint" ||
      indexEntry.uncompressedSize < 0n
    ) {
      rejectArtifact(
        "AIT_MALFORMED",
        `Invalid size for artifact entry: ${normalizedName}`,
      );
    }

    normalizedIndexNames.add(normalizedName);
    indexedUncompressedBytes += indexEntry.uncompressedSize;
    if (indexedUncompressedBytes >= MAX_AIT_UNCOMPRESSED_BYTES_BIGINT) {
      rejectArtifact(
        "AIT_SIZE_LIMIT",
        `AIT uncompressed size must be less than ${MAX_AIT_UNCOMPRESSED_BYTES} bytes`,
      );
    }
  }

  for (const member of zipMembers) {
    const indexEntry = indexByRawName.get(member.rawName);
    if (BigInt(member.uncompressedSize) !== indexEntry.uncompressedSize) {
      rejectArtifact(
        "AIT_ENTRY_SIZE",
        `Artifact entry size mismatch: ${normalizeEntryName(member.rawName)}`,
      );
    }
  }

  const hasWebIndex = normalizedZipNames.has(WEB_ENTRYPOINT);
  if (!hasWebIndex) {
    rejectArtifact("AIT_WEB_INDEX", `AIT entry is required: ${WEB_ENTRYPOINT}`);
  }

  for (const member of zipMembers) {
    const rawName = member.rawName;
    const normalizedName = normalizeEntryName(rawName);
    const payload = readZipMemberPayload(zipBlob, member);

    if (payload.byteLength !== member.uncompressedSize) {
      rejectArtifact(
        "AIT_ENTRY_SIZE",
        `Artifact entry size mismatch: ${normalizedName}`,
      );
    }

    const expectedSha256 = indexByRawName.get(rawName).sha256Hex;
    if (
      typeof expectedSha256 !== "string" ||
      !/^[0-9a-f]{64}$/i.test(expectedSha256)
    ) {
      rejectArtifact(
        "AIT_MALFORMED",
        `Invalid SHA-256 for artifact entry: ${normalizedName}`,
      );
    }
    const actualSha256 = createHash("sha256").update(payload).digest("hex");
    if (actualSha256 !== expectedSha256.toLowerCase()) {
      rejectArtifact(
        "AIT_ENTRY_HASH",
        `Artifact entry hash mismatch: ${normalizedName}`,
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
    uncompressedBytes: Number(zipUncompressedBytes),
    maxBytes: MAX_AIT_UNCOMPRESSED_BYTES,
    entryCount: zipMembers.length,
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
