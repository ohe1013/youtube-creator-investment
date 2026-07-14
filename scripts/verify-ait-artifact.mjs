import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
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
const latin1Decoder = new TextDecoder("latin1", { fatal: true });
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
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bsb_secret_[A-Za-z0-9_-]+(?=$|[^A-Za-z0-9_-])/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:/@]+:[^\s/@]+@/i,
];

const genericSecretAssignmentPattern =
  /(?:^|[\s,{;])(?:["']([A-Za-z][A-Za-z0-9_-]{1,63})["']|([A-Za-z][A-Za-z0-9_-]{1,63}))\s*[:=]\s*(?:"([^"\r\n]{8,})"|'([^'\r\n]{8,})'|`([^`\r\n]{8,})`|([^\s,;}]{8,}))/gim;
const sensitiveConfigurationKeyHintPattern =
  /(?:api[_-]?key|client[_-]?secret|password|private[_-]?key|database[_-]?url|db[_-]?password|service[_-]?(?:role|account)[_-]?key|secret|token)/i;

const MAX_OPAQUE_MARKER_WINDOWS = 128;
const MAX_OPAQUE_MARKER_GAP_BYTES = 64;
const MAX_OPAQUE_PUBLIC_KEY_CHARACTERS = 512;
const OPAQUE_MARKER_CONTEXT_BEFORE_BYTES = 1_024;
const OPAQUE_MARKER_CONTEXT_AFTER_BYTES = 16 * 1024;
const publicConfigurationMarkerPrefixes = ["NEXT_PUBLIC_"];
const opaqueTransformationMarkerPrefixes = [
  ...publicConfigurationMarkerPrefixes,
  "AKIA",
  "ASIA",
  "AIza",
  "ghp_",
  "gho_",
  "ghu_",
  "ghs_",
  "ghr_",
  "github_pat_",
  "sk-",
  "sk_",
  "sb_secret_",
  "xox",
  "postgres://",
  "postgresql://",
  "mysql://",
  "mongodb://",
  "mongodb+srv://",
  "eyJ",
  "API_KEY",
  "CLIENT_SECRET",
  "SECRET_KEY",
  "SERVICE_ROLE_KEY",
  "PASSWORD",
  "PRIVATE_KEY",
  "DATABASE_URL",
  "TOKEN",
];
const publicConfigurationMarkerStartCodes = new Set(
  publicConfigurationMarkerPrefixes.map((prefix) =>
    prefix[0].toUpperCase().charCodeAt(0),
  ),
);
const opaqueTransformationMarkerStartCodes = new Set(
  opaqueTransformationMarkerPrefixes.map((prefix) =>
    prefix[0].toUpperCase().charCodeAt(0),
  ),
);

function isAsciiLetterDigitUnderscore(character) {
  if (typeof character !== "string" || character.length !== 1) return false;
  const code = character.charCodeAt(0);
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    character === "_"
  );
}

function isBase64UrlCharacter(character) {
  return (
    isAsciiLetterDigitUnderscore(character) ||
    character === "-"
  );
}

function readBase64UrlSegmentEnd(text, startIndex) {
  let cursor = startIndex;
  while (cursor < text.length && isBase64UrlCharacter(text[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function decodeJwtObject(segment) {
  try {
    const parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function containsSupabaseServiceRoleJwt(text) {
  let cursor = 0;
  while (cursor < text.length) {
    if (
      !isBase64UrlCharacter(text[cursor]) ||
      (cursor > 0 && isBase64UrlCharacter(text[cursor - 1]))
    ) {
      cursor += 1;
      continue;
    }

    const headerEnd = readBase64UrlSegmentEnd(text, cursor);
    if (
      text[cursor] !== "e" ||
      text[headerEnd] !== "."
    ) {
      cursor = headerEnd;
      continue;
    }

    const claimsStart = headerEnd + 1;
    if (!isBase64UrlCharacter(text[claimsStart])) {
      cursor = claimsStart;
      continue;
    }
    const claimsEnd = readBase64UrlSegmentEnd(text, claimsStart);
    if (
      text[claimsStart] !== "e" ||
      text[claimsEnd] !== "."
    ) {
      cursor = claimsEnd;
      continue;
    }

    const signatureStart = claimsEnd + 1;
    if (!isBase64UrlCharacter(text[signatureStart])) {
      cursor = signatureStart;
      continue;
    }
    const signatureEnd = readBase64UrlSegmentEnd(text, signatureStart);
    const header = decodeJwtObject(text.slice(cursor, headerEnd));
    const claims = decodeJwtObject(text.slice(claimsStart, claimsEnd));
    if (
      header &&
      typeof header.alg === "string" &&
      claims &&
      claims.role === "service_role"
    ) {
      return true;
    }
    cursor = signatureEnd;
  }
  return false;
}

function containsSpecificSecretText(text) {
  return (
    specificSecretPatterns.some((pattern) => pattern.test(text)) ||
    containsSupabaseServiceRoleJwt(text)
  );
}

function normalizeOpaqueConfigurationText(text) {
  return text.replace(/[\0-\x08\x0e-\x1f\x7f-\uffff]/g, " ");
}

function compactOpaqueText(text) {
  return text.replace(/[\0-\x1f\x7f-\uffff]/g, "");
}

function hasOpaqueTransformationCharacter(text) {
  return /[\\\0-\x08\x0b-\x0c\x0e-\x1f\x7f-\uffff]/.test(text);
}

function decodeJavaScriptEscape(
  text,
  index,
  { preserveEscapedBackslash = false } = {},
) {
  const escape = text[index + 1];
  if (!escape) return null;
  if (escape === "\\") {
    return {
      value: preserveEscapedBackslash ? "\\\\" : "\\",
      nextIndex: index + 2,
    };
  }

  if (escape === "u") {
    if (text[index + 2] === "{") {
      let closingIndex = index + 3;
      while (
        closingIndex < text.length &&
        closingIndex < index + 9 &&
        /[0-9a-fA-F]/.test(text[closingIndex])
      ) {
        closingIndex += 1;
      }
      const hex = text.slice(index + 3, closingIndex);
      if (
        text[closingIndex] === "}" &&
        /^[0-9a-fA-F]{1,6}$/.test(hex)
      ) {
        const codePoint = Number.parseInt(hex, 16);
        if (codePoint <= 0x10ffff) {
          return {
            value: String.fromCodePoint(codePoint),
            nextIndex: closingIndex + 1,
          };
        }
      }
      return null;
    }

    const hex = text.slice(index + 2, index + 6);
    if (/^[0-9a-fA-F]{4}$/.test(hex)) {
      return {
        value: String.fromCharCode(Number.parseInt(hex, 16)),
        nextIndex: index + 6,
      };
    }
    return null;
  }

  if (escape === "x") {
    const hex = text.slice(index + 2, index + 4);
    if (/^[0-9a-fA-F]{2}$/.test(hex)) {
      return {
        value: String.fromCharCode(Number.parseInt(hex, 16)),
        nextIndex: index + 4,
      };
    }
    return null;
  }

  return { value: escape, nextIndex: index + 2 };
}

function decodeJavaScriptEscapes(text) {
  let decoded = "";
  for (let index = 0; index < text.length; ) {
    if (text[index] !== "\\") {
      decoded += text[index];
      index += 1;
      continue;
    }

    const escape = decodeJavaScriptEscape(text, index, {
      preserveEscapedBackslash: true,
    });
    if (!escape) {
      decoded += text[index];
      index += 1;
      continue;
    }
    decoded += escape.value;
    index = escape.nextIndex;
  }
  return decoded;
}

function asciiCharactersEqualIgnoreCase(value, expected) {
  if (value === expected) return true;
  if (typeof value !== "string" || typeof expected !== "string") {
    return false;
  }
  if (value.length !== 1 || expected.length !== 1) return false;
  const valueCode = value.charCodeAt(0);
  const expectedCode = expected.charCodeAt(0);
  return (
    valueCode >= 0x41 &&
    valueCode <= 0x7a &&
    expectedCode >= 0x41 &&
    expectedCode <= 0x7a &&
    (valueCode | 0x20) === (expectedCode | 0x20)
  );
}

function isOpaqueSeparatorCharacter(character) {
  const code = character.charCodeAt(0);
  return code <= 0x1f || code >= 0x7f;
}

function readOpaqueMarkerCharacter(text, index) {
  if (text[index] === "\\") {
    const escape = decodeJavaScriptEscape(text, index);
    if (escape && escape.value.length === 1) return escape;
  }
  return { value: text[index], nextIndex: index + 1 };
}

function peekOpaqueMarkerCharacter(text, index) {
  if (text[index] !== "\\") return text[index];
  const escape = text[index + 1];
  if (!escape) return null;
  if (escape === "\\") return "\\";
  if (
    (escape === "u" &&
      text[index + 2] !== "{" &&
      !/[0-9a-fA-F]/.test(text[index + 2] ?? "")) ||
    (escape === "x" && !/[0-9a-fA-F]/.test(text[index + 2] ?? ""))
  ) {
    return null;
  }
  const decoded = decodeJavaScriptEscape(text, index);
  return decoded?.value.length === 1 ? decoded.value : null;
}

function matchOpaqueMarkerPrefixAt(text, startIndex, prefix) {
  let cursor = startIndex;
  for (const expected of prefix) {
    let separatorCount = 0;
    while (
      cursor < text.length &&
      isOpaqueSeparatorCharacter(text[cursor])
    ) {
      separatorCount += 1;
      if (separatorCount > MAX_OPAQUE_MARKER_GAP_BYTES) return null;
      cursor += 1;
    }

    if (cursor >= text.length) return null;
    const character = readOpaqueMarkerCharacter(text, cursor);
    if (!asciiCharactersEqualIgnoreCase(character.value, expected)) {
      return null;
    }
    cursor = character.nextIndex;
  }
  return { nextIndex: cursor };
}

function skipStaticMarkerWhitespace(text, startIndex, markerStartIndex) {
  let cursor = startIndex;
  while (
    cursor < text.length &&
    cursor - markerStartIndex <= OPAQUE_MARKER_CONTEXT_AFTER_BYTES &&
    /\s/.test(text[cursor])
  ) {
    cursor += 1;
  }
  return cursor;
}

function matchStaticStringConcatenationMarkerAt(text, startIndex, prefix) {
  const firstQuote = text[startIndex];
  if (firstQuote !== '"' && firstQuote !== "'" && firstQuote !== "`") {
    return null;
  }

  const firstCharacter = readOpaqueMarkerCharacter(text, startIndex + 1);
  if (!asciiCharactersEqualIgnoreCase(firstCharacter.value, prefix[0])) {
    return null;
  }

  let cursor = startIndex;
  let matchedLength = 0;
  while (cursor < text.length) {
    const quote = text[cursor];
    if (quote !== '"' && quote !== "'" && quote !== "`") return null;
    cursor += 1;

    while (cursor < text.length) {
      if (cursor - startIndex > OPAQUE_MARKER_CONTEXT_AFTER_BYTES) {
        return null;
      }
      if (matchedLength === prefix.length) return { nextIndex: cursor };
      if (text[cursor] === quote) {
        cursor += 1;
        break;
      }

      if (isOpaqueSeparatorCharacter(text[cursor])) {
        cursor += 1;
        continue;
      }
      const character = readOpaqueMarkerCharacter(text, cursor);
      if (
        matchedLength >= prefix.length ||
        !asciiCharactersEqualIgnoreCase(
          character.value,
          prefix[matchedLength],
        )
      ) {
        return null;
      }
      matchedLength += 1;
      cursor = character.nextIndex;
    }

    if (cursor >= text.length || text[cursor - 1] !== quote) return null;

    cursor = skipStaticMarkerWhitespace(text, cursor, startIndex);
    if (text[cursor] !== "+") return null;
    cursor = skipStaticMarkerWhitespace(text, cursor + 1, startIndex);
  }
  return null;
}

function isKnownOpaqueMarkerStart(character, startCodes) {
  if (typeof character !== "string" || character.length !== 1) return false;
  const code = character.charCodeAt(0);
  const normalizedCode = code >= 0x61 && code <= 0x7a ? code - 0x20 : code;
  return startCodes.has(normalizedCode);
}

function isPotentialOpaqueMarkerStart(
  character,
  startCodes,
  supportsStaticStringConcatenation,
) {
  return (
    character === "\\" ||
    (supportsStaticStringConcatenation &&
      (character === '"' || character === "'" || character === "`")) ||
    isKnownOpaqueMarkerStart(character, startCodes)
  );
}

function findOpaqueMarkerAt(
  text,
  index,
  prefixes,
  startCodes,
  supportsStaticStringConcatenation,
) {
  const character = text[index];
  if (
    !isPotentialOpaqueMarkerStart(
      character,
      startCodes,
      supportsStaticStringConcatenation,
    )
  ) {
    return null;
  }

  if (
    supportsStaticStringConcatenation &&
    (character === '"' || character === "'" || character === "`")
  ) {
    const staticStartCharacter = peekOpaqueMarkerCharacter(text, index + 1);
    for (const prefix of prefixes) {
      if (!asciiCharactersEqualIgnoreCase(staticStartCharacter, prefix[0])) {
        continue;
      }
      const match = matchStaticStringConcatenationMarkerAt(
        text,
        index,
        prefix,
      );
      if (match) return { ...match, prefix };
    }
    return null;
  }

  const markerStartCharacter =
    character === "\\"
      ? peekOpaqueMarkerCharacter(text, index)
      : character;
  if (!isKnownOpaqueMarkerStart(markerStartCharacter, startCodes)) {
    return null;
  }
  for (const prefix of prefixes) {
    if (!asciiCharactersEqualIgnoreCase(markerStartCharacter, prefix[0])) {
      continue;
    }
    const match = matchOpaqueMarkerPrefixAt(text, index, prefix);
    if (match) return { ...match, prefix };
  }
  return null;
}

function hasStaticConcatenationNearOpaqueMarker(text, startIndex, nextIndex) {
  const windowStart = Math.max(startIndex, nextIndex - 512);
  const windowEnd = Math.min(text.length, nextIndex + 512);
  for (let index = windowStart; index < windowEnd; index += 1) {
    if (text[index] === "+") return true;
  }
  return false;
}

function readStaticPublicConfigurationKeyAtMarker(text, startIndex) {
  const windowEnd = Math.min(
    text.length,
    startIndex + OPAQUE_MARKER_CONTEXT_BEFORE_BYTES,
  );
  const tokens = tokenizeJavaScriptLike(text.slice(startIndex, windowEnd));
  return readStaticStringExpression(tokens, 0)?.value ?? null;
}

function hasSensitivePublicConfigurationMarker(text, startIndex, match) {
  if (match.prefix !== "NEXT_PUBLIC_") return true;

  if (
    (text[startIndex] === '"' ||
      text[startIndex] === "'" ||
      text[startIndex] === "`") &&
    hasStaticConcatenationNearOpaqueMarker(
      text,
      startIndex,
      match.nextIndex,
    )
  ) {
    const staticKey = readStaticPublicConfigurationKeyAtMarker(
      text,
      startIndex,
    );
    return Boolean(
      staticKey && isSensitivePublicConfigurationKeyToken(staticKey),
    );
  }

  let value = "NEXT_PUBLIC_";
  let cursor = match.nextIndex;
  while (
    cursor < text.length &&
    value.length < MAX_OPAQUE_PUBLIC_KEY_CHARACTERS
  ) {
    while (
      cursor < text.length &&
      isOpaqueSeparatorCharacter(text[cursor])
    ) {
      cursor += 1;
    }
    if (cursor >= text.length) break;

    const character = readOpaqueMarkerCharacter(text, cursor);
    if (!isAsciiLetterDigitUnderscore(character.value)) break;
    value += character.value;
    cursor = character.nextIndex;
  }
  return isSensitivePublicConfigurationKeyToken(value);
}

function shouldVisitOpaqueMarker(text, index, match) {
  return hasSensitivePublicConfigurationMarker(text, index, match);
}

function isEmbeddedInPublicConfigurationKey(text, markerIndex) {
  const startIndex = Math.max(
    0,
    markerIndex - MAX_OPAQUE_PUBLIC_KEY_CHARACTERS,
  );
  const source = text.slice(startIndex, markerIndex);
  const decoded = source.includes("\\")
    ? decodeJavaScriptEscapes(source)
    : source;
  const compact = /[\0-\x1f\x7f-\uffff]/.test(decoded)
    ? compactOpaqueText(decoded)
    : decoded;
  return /NEXT_PUBLIC_[A-Z0-9_]*$/i.test(compact);
}

function shouldVisitTransformedOpaqueMarker(text, index, match) {
  if (match.prefix === "NEXT_PUBLIC_") return false;
  if (
    match.prefix !== "NEXT_PUBLIC_" &&
    isEmbeddedInPublicConfigurationKey(text, index)
  ) {
    return false;
  }
  return shouldVisitOpaqueMarker(text, index, match);
}

function hasStaticBuiltinBeforeOpaqueMarker(text, startIndex) {
  const lowerBound = Math.max(0, startIndex - 1_024);
  for (let index = lowerBound; index < startIndex; index += 1) {
    if (
      text.startsWith("Object", index) ||
      text.startsWith("Reflect", index)
    ) {
      return true;
    }
  }
  return false;
}

function shouldRejectOpaqueMarkerAfterBudget(text, index, match) {
  return match.prefix !== "NEXT_PUBLIC_";
}

function matchesAsciiLiteralIgnoreCaseAt(text, startIndex, literal) {
  if (startIndex + literal.length > text.length) return false;
  for (let offset = 0; offset < literal.length; offset += 1) {
    const valueCode = text.charCodeAt(startIndex + offset);
    const expectedCode = literal.charCodeAt(offset);
    const normalizedValueCode =
      valueCode >= 0x61 && valueCode <= 0x7a
        ? valueCode - 0x20
        : valueCode;
    if (normalizedValueCode !== expectedCode) return false;
  }
  return true;
}

function readRawPublicConfigurationKeyEnd(text, match) {
  let cursor = match.nextIndex;
  while (
    cursor < text.length &&
    isAsciiLetterDigitUnderscore(text[cursor])
  ) {
    cursor += 1;
  }
  return cursor;
}

function skipRawJavaScriptWhitespace(text, startIndex) {
  let cursor = startIndex;
  while (cursor < text.length && /\s/.test(text[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function hasRawPublicConfigurationAssignmentAt(text, match) {
  const keyEnd = readRawPublicConfigurationKeyEnd(text, match);
  const nextIndex = skipRawJavaScriptWhitespace(text, keyEnd);
  return text[nextIndex] === "=" || text[nextIndex] === ":";
}

function readOpaquePublicConfigurationKeyEnd(text, match) {
  let cursor = match.nextIndex;
  while (cursor < text.length) {
    while (
      cursor < text.length &&
      isOpaqueSeparatorCharacter(text[cursor])
    ) {
      cursor += 1;
    }
    if (cursor >= text.length) break;

    const character = readOpaqueMarkerCharacter(text, cursor);
    if (!isAsciiLetterDigitUnderscore(character.value)) break;
    cursor = character.nextIndex;
  }
  return cursor;
}

function hasOpaqueQuotedPublicConfigurationAssignmentAt(
  text,
  markerIndex,
  match,
  quote,
  stringStart,
) {
  if (markerIndex !== stringStart + 1) return false;
  const keyEnd = readOpaquePublicConfigurationKeyEnd(text, match);
  if (text[keyEnd] !== quote) return false;

  let nextIndex = skipRawJavaScriptWhitespace(text, keyEnd + 1);
  if (text[nextIndex] === ":") return true;
  if (text[nextIndex] !== "]") return false;
  nextIndex = skipRawJavaScriptWhitespace(text, nextIndex + 1);
  return text[nextIndex] === "=" || text[nextIndex] === ":";
}

function visitRawPublicConfigurationMarkerWindows(text, visitor) {
  let parserCandidates = 0;
  let lexicalState = "code";
  let quote = null;
  let stringStart = -1;
  let statementStart = 0;

  for (let index = 0; index < text.length; ) {
    const character = text[index];

    if (lexicalState === "line-comment") {
      if (character === "\n" || character === "\r") {
        lexicalState = "code";
        statementStart = index + 1;
      }
      index += 1;
      continue;
    }

    if (lexicalState === "block-comment") {
      if (character === "*" && text[index + 1] === "/") {
        lexicalState = "code";
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    const isString = lexicalState === "string";
    if (isString && character === quote) {
      lexicalState = "code";
      quote = null;
      stringStart = -1;
      index += 1;
      continue;
    }

    if (!isString && character === "/" && text[index + 1] === "/") {
      lexicalState = "line-comment";
      index += 2;
      continue;
    }
    if (!isString && character === "/" && text[index + 1] === "*") {
      lexicalState = "block-comment";
      index += 2;
      continue;
    }
    if (
      !isString &&
      (character === ";" ||
        character === "\n" ||
        character === "\r" ||
        character === "{" ||
        character === "}")
    ) {
      statementStart = index + 1;
      index += 1;
      continue;
    }

    const match = isPotentialOpaqueMarkerStart(
      character,
      publicConfigurationMarkerStartCodes,
      true,
    )
      ? findOpaqueMarkerAt(
          text,
          index,
          publicConfigurationMarkerPrefixes,
          publicConfigurationMarkerStartCodes,
          true,
        )
      : null;
    if (
      match &&
      !isString &&
      (character === '"' || character === "'" || character === "`") &&
      !hasStaticConcatenationNearOpaqueMarker(text, index, match.nextIndex)
    ) {
      lexicalState = "string";
      quote = character;
      stringStart = index;
      index += 1;
      continue;
    }
    if (match && shouldVisitOpaqueMarker(text, index, match)) {
      const isRawMarker = matchesAsciiLiteralIgnoreCaseAt(
        text,
        index,
        "NEXT_PUBLIC_",
      );
      if (
        (isRawMarker &&
          !isString &&
          hasRawPublicConfigurationAssignmentAt(text, match)) ||
        (isString &&
          hasOpaqueQuotedPublicConfigurationAssignmentAt(
            text,
            index,
            match,
            quote,
            stringStart,
          ))
      ) {
        return true;
      }

      const hasStaticContext =
        isString && hasStaticBuiltinBeforeOpaqueMarker(text, index);
      if (!isString || hasStaticContext) {
        if (
          parserCandidates < MAX_OPAQUE_MARKER_WINDOWS &&
          index - statementStart <= OPAQUE_MARKER_CONTEXT_BEFORE_BYTES
        ) {
          parserCandidates += 1;
          const windowEnd = Math.min(
            text.length,
            match.nextIndex + OPAQUE_MARKER_CONTEXT_AFTER_BYTES,
          );
          if (visitor(text.slice(statementStart, windowEnd))) return true;
        } else if (hasStaticContext) {
          return true;
        }
      }

      if (
        !isString &&
        (character === '"' || character === "'" || character === "`")
      ) {
        lexicalState = "string";
        quote = character;
        stringStart = index;
        index += 1;
        continue;
      }
      index = Math.max(index + 1, match.nextIndex);
      continue;
    }

    if (isString && character === "\\") {
      index += 2;
      continue;
    }
    if (!isString && (character === '"' || character === "'" || character === "`")) {
      lexicalState = "string";
      quote = character;
      stringStart = index;
      index += 1;
      continue;
    }

    index += 1;
  }
  return false;
}

function visitPublicConfigurationMarkerWindows(text, visitor) {
  return visitRawPublicConfigurationMarkerWindows(text, visitor);
}

function visitOpaqueMarkerWindows(
  text,
  prefixes,
  startCodes,
  supportsStaticStringConcatenation,
  visitor,
  shouldVisit = null,
  shouldRejectAfterBudget = null,
) {
  let matches = 0;
  for (let index = 0; index < text.length; index += 1) {
    const match = findOpaqueMarkerAt(
      text,
      index,
      prefixes,
      startCodes,
      supportsStaticStringConcatenation,
    );
    if (!match) continue;

    if (shouldVisit && !shouldVisit(text, index, match)) {
      index = Math.max(index, match.nextIndex - 1);
      continue;
    }

    matches += 1;
    if (
      matches > MAX_OPAQUE_MARKER_WINDOWS &&
      shouldRejectAfterBudget &&
      shouldRejectAfterBudget(text, index, match)
    ) {
      return true;
    }
    if (matches > MAX_OPAQUE_MARKER_WINDOWS) {
      index = Math.max(index, match.nextIndex - 1);
      continue;
    }

    const windowStart = Math.max(0, index - OPAQUE_MARKER_CONTEXT_BEFORE_BYTES);
    const windowEnd = Math.min(
      text.length,
      match.nextIndex + OPAQUE_MARKER_CONTEXT_AFTER_BYTES,
    );
    if (visitor(text.slice(windowStart, windowEnd))) return true;
    index = Math.max(index, match.nextIndex - 1);
  }
  return false;
}

function isJavaScriptIdentifierCharacter(character) {
  return isAsciiLetterDigitUnderscore(character) || character === "$";
}

function readJavaScriptIdentifier(text, startIndex) {
  let value = "";
  let cursor = startIndex;
  while (cursor < text.length) {
    if (isJavaScriptIdentifierCharacter(text[cursor])) {
      value += text[cursor];
      cursor += 1;
      continue;
    }
    if (text[cursor] === "\\") {
      const escape = decodeJavaScriptEscape(text, cursor);
      if (!escape) break;
      value += escape.value;
      cursor = escape.nextIndex;
      continue;
    }
    break;
  }
  return { value, nextIndex: cursor };
}

function readJavaScriptString(text, startIndex) {
  const quote = text[startIndex];
  let value = "";
  let cursor = startIndex + 1;
  while (cursor < text.length) {
    if (text[cursor] === quote) {
      return { value, nextIndex: cursor + 1 };
    }
    if (text[cursor] === "\\") {
      const escape = decodeJavaScriptEscape(text, cursor);
      if (escape) {
        value += escape.value;
        cursor = escape.nextIndex;
        continue;
      }
    }
    value += text[cursor];
    cursor += 1;
  }
  return null;
}

function tokenizeJavaScriptLike(text) {
  const tokens = [];
  for (let cursor = 0; cursor < text.length; ) {
    const character = text[cursor];
    if (/\s/.test(character)) {
      cursor += 1;
      continue;
    }
    if (character === "/" && text[cursor + 1] === "/") {
      const lineEnd = text.indexOf("\n", cursor + 2);
      cursor = lineEnd === -1 ? text.length : lineEnd + 1;
      continue;
    }
    if (character === "/" && text[cursor + 1] === "*") {
      const commentEnd = text.indexOf("*/", cursor + 2);
      cursor = commentEnd === -1 ? text.length : commentEnd + 2;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      const string = readJavaScriptString(text, cursor);
      if (!string) break;
      tokens.push({ type: "string", value: string.value });
      cursor = string.nextIndex;
      continue;
    }
    if (isJavaScriptIdentifierCharacter(character) || character === "\\") {
      const identifier = readJavaScriptIdentifier(text, cursor);
      if (identifier.value.length > 0) {
        tokens.push({ type: "identifier", value: identifier.value });
        cursor = identifier.nextIndex;
        continue;
      }
    }
    tokens.push({ type: "punctuation", value: character });
    cursor += 1;
  }
  return tokens;
}

function readStaticStringExpression(tokens, startIndex) {
  let cursor = startIndex;
  let parenthesisDepth = 0;
  while (tokens[cursor]?.value === "(") {
    parenthesisDepth += 1;
    cursor += 1;
  }
  if (tokens[cursor]?.type !== "string") return null;
  let value = tokens[cursor].value;
  cursor += 1;
  while (
    tokens[cursor]?.value === "+" &&
    tokens[cursor + 1]?.type === "string"
  ) {
    value += tokens[cursor + 1].value;
    cursor += 2;
  }
  while (parenthesisDepth > 0) {
    if (tokens[cursor]?.value !== ")") return null;
    parenthesisDepth -= 1;
    cursor += 1;
  }
  return { value, nextIndex: cursor };
}

function findCallArgumentDelimiter(tokens, startIndex) {
  let nested = 0;
  for (let index = startIndex; index < tokens.length; index += 1) {
    const value = tokens[index].value;
    if (value === "(" || value === "[" || value === "{") {
      nested += 1;
      continue;
    }
    if (value === ")" || value === "]" || value === "}") {
      if (nested === 0) return index;
      nested -= 1;
      continue;
    }
    if (value === "," && nested === 0) return index;
  }
  return -1;
}

function isSensitivePublicConfigurationKeyToken(value) {
  return (
    value.toUpperCase().startsWith("NEXT_PUBLIC_") &&
    isSensitiveConfigurationKey(value)
  );
}

function hasSensitiveStaticSecondArgument(tokens, openIndex) {
  const firstDelimiter = findCallArgumentDelimiter(tokens, openIndex + 1);
  if (tokens[firstDelimiter]?.value !== ",") return false;
  const key = readStaticStringExpression(tokens, firstDelimiter + 1);
  return Boolean(
    key &&
      isSensitivePublicConfigurationKeyToken(key.value) &&
      tokens[key.nextIndex]?.value === ",",
  );
}

function readStaticMemberName(tokens, startIndex) {
  let cursor = startIndex;
  if (tokens[cursor]?.value === "?") cursor += 1;

  if (tokens[cursor]?.value === ".") {
    cursor += 1;
  }

  if (tokens[cursor]?.value === "[") {
    const member = readStaticStringExpression(tokens, cursor + 1);
    if (!member || tokens[member.nextIndex]?.value !== "]") return null;
    return { value: member.value, nextIndex: member.nextIndex + 1 };
  }

  const member = tokens[cursor];
  if (member?.type === "identifier" || member?.type === "string") {
    return { value: member.value, nextIndex: cursor + 1 };
  }
  return null;
}

function findStaticCallOpenIndex(tokens, startIndex) {
  let cursor = startIndex;
  if (tokens[cursor]?.value === "?") cursor += 1;
  if (tokens[cursor]?.value === ".") cursor += 1;
  if (tokens[cursor]?.value === "(") return cursor;

  if (tokens[cursor]?.value !== ")") return -1;
  cursor += 1;
  if (tokens[cursor]?.value === "?") cursor += 1;
  if (tokens[cursor]?.value === ".") cursor += 1;
  return tokens[cursor]?.value === "(" ? cursor : -1;
}

function hasSensitiveStaticBuiltinCall(tokens, index, objectName, methodNames) {
  if (tokens[index]?.value !== objectName) return false;
  const member = readStaticMemberName(tokens, index + 1);
  if (!member || !methodNames.includes(member.value)) return false;
  const openIndex = findStaticCallOpenIndex(tokens, member.nextIndex);
  return openIndex !== -1 && hasSensitiveStaticSecondArgument(tokens, openIndex);
}

function containsSensitivePublicConfigurationAssignmentInWindow(text) {
  const tokens = tokenizeJavaScriptLike(text);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1]?.value;

    if (
      (token.type === "identifier" || token.type === "string") &&
      isSensitivePublicConfigurationKeyToken(token.value)
    ) {
      if (next === "=" || next === ":") {
        return true;
      }
    }

    if (token.value === "[") {
      const key = readStaticStringExpression(tokens, index + 1);
      if (
        key &&
        isSensitivePublicConfigurationKeyToken(key.value) &&
        tokens[key.nextIndex]?.value === "]" &&
        (tokens[key.nextIndex + 1]?.value === "=" ||
          tokens[key.nextIndex + 1]?.value === ":")
      ) {
        return true;
      }
    }

    if (
      hasSensitiveStaticBuiltinCall(
        tokens,
        index,
        "Object",
        ["defineProperty"],
      ) ||
      hasSensitiveStaticBuiltinCall(
        tokens,
        index,
        "Reflect",
        ["set", "defineProperty"],
      )
    ) {
      return true;
    }
  }
  return false;
}

function containsSensitivePublicConfigurationAssignment(text) {
  return visitPublicConfigurationMarkerWindows(
    text,
    containsSensitivePublicConfigurationAssignmentInWindow,
  );
}

function containsSpecificStaticStringConcatenationInWindow(text) {
  const tokens = tokenizeJavaScriptLike(text);
  for (let index = 0; index < tokens.length; index += 1) {
    const value = readStaticStringExpression(tokens, index);
    if (value && containsSpecificSecretText(value.value)) return true;
  }
  return false;
}

function containsSpecificStaticStringConcatenation(text) {
  if (!text.includes("+")) return false;
  return visitOpaqueMarkerWindows(
    text,
    opaqueTransformationMarkerPrefixes,
    opaqueTransformationMarkerStartCodes,
    true,
    containsSpecificStaticStringConcatenationInWindow,
    shouldVisitTransformedOpaqueMarker,
    shouldRejectOpaqueMarkerAfterBudget,
  );
}

function containsCanonicalOpaqueSecretText(text) {
  return (
    containsSpecificSecretText(text) ||
    containsSpecificStaticStringConcatenation(text) ||
    containsSensitivePublicConfigurationAssignment(text) ||
    containsSensitiveConfigurationAssignment(text)
  );
}

function containsCanonicalOpaqueSecretTextInOpaqueWindow(text) {
  if (containsCanonicalOpaqueSecretText(text)) return true;

  const hasEscapes = text.includes("\\");
  const hasOpaqueCharacters = hasOpaqueTransformationCharacter(text);
  let decoded = null;
  if (hasEscapes) {
    decoded = decodeJavaScriptEscapes(text);
    if (decoded !== text && containsCanonicalOpaqueSecretText(decoded)) {
      return true;
    }
  }

  if (!hasOpaqueCharacters) return false;

  const normalized = normalizeOpaqueConfigurationText(text);
  if (
    normalized !== text &&
    containsCanonicalOpaqueSecretText(normalized)
  ) {
    return true;
  }

  const compact = compactOpaqueText(text);
  if (compact !== text && containsCanonicalOpaqueSecretText(compact)) {
    return true;
  }

  if (decoded !== null) {
    const compactDecoded = compactOpaqueText(decoded);
    if (
      compactDecoded !== decoded &&
      containsCanonicalOpaqueSecretText(compactDecoded)
    ) {
      return true;
    }
  }
  return false;
}

function containsTransformedOpaqueSecretText(text) {
  if (!hasOpaqueTransformationCharacter(text)) return false;
  if (
    visitPublicConfigurationMarkerWindows(
      text,
      containsCanonicalOpaqueSecretTextInOpaqueWindow,
    )
  ) {
    return true;
  }
  return visitOpaqueMarkerWindows(
    text,
    opaqueTransformationMarkerPrefixes,
    opaqueTransformationMarkerStartCodes,
    true,
    containsCanonicalOpaqueSecretTextInOpaqueWindow,
    shouldVisitTransformedOpaqueMarker,
    shouldRejectOpaqueMarkerAfterBudget,
  );
}

function containsCanonicalOpaqueSecretTextWithEscapes(text) {
  return (
    containsCanonicalOpaqueSecretText(text) ||
    containsTransformedOpaqueSecretText(text)
  );
}

export function containsSpecificSecretBytes(bytes) {
  const text = latin1Decoder.decode(bytes);
  return containsCanonicalOpaqueSecretTextWithEscapes(text);
}

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
    return /(?:API_KEY|CLIENT_SECRET|SECRET_KEY|SERVICE_ROLE_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|DATABASE_URL)$/.test(
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
      /^(?:[A-Z0-9]+_)*(?:SECRET|SECRET_KEY|SERVICE_ROLE_KEY)$/.test(normalized) ||
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
    "serviceRoleKey",
    "stripeSecretKey",
  ]).has(normalized);
}

function containsLikelySecret(text) {
  return containsCanonicalOpaqueSecretTextWithEscapes(text);
}

function containsSensitiveConfigurationAssignment(text) {
  if (!sensitiveConfigurationKeyHintPattern.test(text)) return false;
  genericSecretAssignmentPattern.lastIndex = 0;
  for (const match of text.matchAll(genericSecretAssignmentPattern)) {
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

    if (containsSpecificSecretBytes(payload)) {
      rejectArtifact(
        "AIT_SECRET_DETECTED",
        `Suspected secret in entry ${normalizedName}`,
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
