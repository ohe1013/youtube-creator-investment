import { Buffer } from "node:buffer";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf16LittleEndianDecoder = new TextDecoder("utf-16le", { fatal: true });
const utf16BigEndianDecoder = new TextDecoder("utf-16be", { fatal: true });

const MAX_BASE64_CANDIDATE_CHARACTERS = 16 * 1024;
const MIN_BASE64_CANDIDATE_CHARACTERS = 32;
const MAX_JWT_SEGMENT_CHARACTERS = 16 * 1024;
const UTF16_PROBE_BYTES = 4 * 1024;

const POSTGRES_URL_LITERALS = ["postgres://", "postgresql://"];
const POSTGRES_URL_FIRST_CHARACTER = "p".charCodeAt(0);
const PRIVATE_KEY_PEM_LITERALS = [
  "-----BEGIN PRIVATE KEY-----",
  "-----BEGIN ENCRYPTED PRIVATE KEY-----",
  "-----BEGIN RSA PRIVATE KEY-----",
  "-----BEGIN EC PRIVATE KEY-----",
  "-----BEGIN OPENSSH PRIVATE KEY-----",
  "-----BEGIN DSA PRIVATE KEY-----",
];
const PRIVATE_KEY_PEM_FIRST_CHARACTER = "-".charCodeAt(0);
const privateKeyPemPattern =
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/i;
const postgresUrlPattern = /\bpostgres(?:ql)?:\/\//i;
const knownSecretPatterns = [
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bsb_secret_[A-Za-z0-9_-]+(?=$|[^A-Za-z0-9_-])/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\b(?:mysql|mongodb(?:\+srv)?):\/\/[^\s:/@]+:[^\s/@]+@/i,
];

export const ClientPayloadDetectionCode = Object.freeze({
  POSTGRES_URL: "POSTGRES_URL",
  PRIVATE_KEY_PEM: "PRIVATE_KEY_PEM",
  UNAPPROVED_JWT: "UNAPPROVED_JWT",
  PUBLIC_SECRET_ASSIGNMENT: "PUBLIC_SECRET_ASSIGNMENT",
  KNOWN_SECRET: "KNOWN_SECRET",
});

export function scanClientPayload(bytes, options = {}) {
  for (const view of createBoundedTextViews(bytes, options)) {
    const code = detectDirectNonJwtSecret(view);
    if (code) return { detected: true, code };
    if (containsJwtCandidate(view)) {
      return {
        detected: true,
        code: ClientPayloadDetectionCode.UNAPPROVED_JWT,
      };
    }
  }

  return { detected: false };
}

export function containsSpecificSecretBytes(bytes) {
  return scanClientPayload(bytes).detected;
}

function* createBoundedTextViews(bytes, _options) {
  const source = asUint8Array(bytes);
  let utf8 = null;

  try {
    utf8 = utf8Decoder.decode(source);
    yield utf8;
  } catch {
    // A non-UTF-8 payload can still have one high-confidence UTF-16 view.
  }

  const utf16View = detectUtf16View(source);
  if (!utf16View) return;

  try {
    const decoded = utf16View.decoder.decode(source.subarray(utf16View.offset));
    if (decoded !== utf8) yield decoded;
  } catch {
    // Do not create a lossy text view for malformed input.
  }
}

function asUint8Array(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  throw new TypeError("Client payload scanner expects bytes");
}

function detectUtf16View(bytes) {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return { decoder: utf16LittleEndianDecoder, offset: 2 };
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return { decoder: utf16BigEndianDecoder, offset: 2 };
    }
  }

  const sampleLength = Math.min(bytes.length, UTF16_PROBE_BYTES);
  const pairCount = Math.floor(sampleLength / 2);
  if (pairCount < 8) return null;

  let evenNuls = 0;
  let oddNuls = 0;
  let evenAscii = 0;
  let oddAscii = 0;
  for (let index = 0; index < pairCount * 2; index += 2) {
    const even = bytes[index];
    const odd = bytes[index + 1];
    if (even === 0) evenNuls += 1;
    if (odd === 0) oddNuls += 1;
    if (isPrintableAscii(even)) evenAscii += 1;
    if (isPrintableAscii(odd)) oddAscii += 1;
  }

  const confidence = pairCount * 0.6;
  if (oddNuls >= confidence && evenAscii >= confidence) {
    return { decoder: utf16LittleEndianDecoder, offset: 0 };
  }
  if (evenNuls >= confidence && oddAscii >= confidence) {
    return { decoder: utf16BigEndianDecoder, offset: 0 };
  }
  return null;
}

function isPrintableAscii(code) {
  return code >= 0x20 && code <= 0x7e;
}

function detectDirectNonJwtSecret(text) {
  if (containsPostgresUrl(text)) {
    return ClientPayloadDetectionCode.POSTGRES_URL;
  }
  if (containsPrivateKeyPem(text)) {
    return ClientPayloadDetectionCode.PRIVATE_KEY_PEM;
  }

  const base64Code = detectBase64EncodedPrivateKeyPem(text);
  if (base64Code) return base64Code;
  if (knownSecretPatterns.some((pattern) => pattern.test(text))) {
    return ClientPayloadDetectionCode.KNOWN_SECRET;
  }
  return null;
}

function containsPostgresUrl(text) {
  return (
    postgresUrlPattern.test(text) ||
    containsEscapedLiteral(
      text,
      POSTGRES_URL_LITERALS,
      POSTGRES_URL_FIRST_CHARACTER,
    )
  );
}

function containsPrivateKeyPem(text) {
  return (
    privateKeyPemPattern.test(text) ||
    containsEscapedLiteral(
      text,
      PRIVATE_KEY_PEM_LITERALS,
      PRIVATE_KEY_PEM_FIRST_CHARACTER,
    )
  );
}

function containsEscapedLiteral(text, literals, firstCharacter) {
  if (!text.includes("\\")) return false;

  for (let index = 0; index < text.length; index += 1) {
    const current = text.charCodeAt(index);
    if (
      current !== 0x5c &&
      !sameAsciiCharacterIgnoreCase(current, firstCharacter)
    ) {
      continue;
    }
    for (const literal of literals) {
      if (matchesEscapedLiteralAt(text, index, literal)) return true;
    }
  }
  return false;
}

function matchesEscapedLiteralAt(text, startIndex, literal) {
  let cursor = startIndex;
  for (let index = 0; index < literal.length; index += 1) {
    const actual = readEscapedAsciiCharacter(text, cursor);
    if (
      actual < 0 ||
      !sameAsciiCharacterIgnoreCase(actual, literal.charCodeAt(index))
    ) {
      return false;
    }
    cursor = nextEscapedCharacterIndex(text, cursor);
  }
  return true;
}

function sameAsciiCharacterIgnoreCase(actual, expected) {
  if (actual === expected) return true;
  const normalizedActual =
    actual >= 0x41 && actual <= 0x5a ? actual + 0x20 : actual;
  const normalizedExpected =
    expected >= 0x41 && expected <= 0x5a ? expected + 0x20 : expected;
  return normalizedActual === normalizedExpected;
}

function readEscapedAsciiCharacter(text, index) {
  const current = text.charCodeAt(index);
  if (current !== 0x5c) return Number.isNaN(current) ? -1 : current;

  const escapeType = text.charCodeAt(index + 1);
  if (escapeType === 0x78) {
    return readFixedHexEscape(text, index + 2, 2);
  }
  if (escapeType !== 0x75) return -1;

  if (text.charCodeAt(index + 2) !== 0x7b) {
    return readFixedHexEscape(text, index + 2, 4);
  }

  let cursor = index + 3;
  let value = 0;
  let digits = 0;
  while (cursor < text.length && digits < 6) {
    const code = text.charCodeAt(cursor);
    if (code === 0x7d) break;
    const hex = hexValue(code);
    if (hex < 0) return -1;
    value = value * 16 + hex;
    digits += 1;
    cursor += 1;
  }
  if (digits === 0 || text.charCodeAt(cursor) !== 0x7d || value > 0x7f) {
    return -1;
  }
  return value;
}

function nextEscapedCharacterIndex(text, index) {
  if (text.charCodeAt(index) !== 0x5c) return index + 1;
  const escapeType = text.charCodeAt(index + 1);
  if (escapeType === 0x78 && readFixedHexEscape(text, index + 2, 2) >= 0) {
    return index + 4;
  }
  if (escapeType !== 0x75) return index + 1;
  if (text.charCodeAt(index + 2) !== 0x7b) {
    return readFixedHexEscape(text, index + 2, 4) >= 0 ? index + 6 : index + 1;
  }

  let cursor = index + 3;
  let digits = 0;
  while (cursor < text.length && digits < 6) {
    const code = text.charCodeAt(cursor);
    if (code === 0x7d) {
      return digits > 0 ? cursor + 1 : index + 1;
    }
    if (hexValue(code) < 0) return index + 1;
    digits += 1;
    cursor += 1;
  }
  return index + 1;
}

function readFixedHexEscape(text, start, length) {
  let value = 0;
  for (let index = 0; index < length; index += 1) {
    const hex = hexValue(text.charCodeAt(start + index));
    if (hex < 0) return -1;
    value = value * 16 + hex;
  }
  return value <= 0x7f ? value : -1;
}

function hexValue(code) {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  return -1;
}

function detectBase64EncodedPrivateKeyPem(text) {
  let start = -1;
  for (let index = 0; index <= text.length; index += 1) {
    if (index < text.length && isBase64Character(text.charCodeAt(index))) {
      if (start < 0) start = index;
      continue;
    }

    if (start < 0) continue;
    const length = index - start;
    if (length > MAX_BASE64_CANDIDATE_CHARACTERS) {
      return ClientPayloadDetectionCode.KNOWN_SECRET;
    }
    if (
      length >= MIN_BASE64_CANDIDATE_CHARACTERS &&
      isValidBase64Candidate(text, start, index)
    ) {
      const decoded = Buffer.from(text.slice(start, index), "base64").toString(
        "latin1",
      );
      if (privateKeyPemPattern.test(decoded)) {
        return ClientPayloadDetectionCode.PRIVATE_KEY_PEM;
      }
    }
    start = -1;
  }
  return null;
}

function isBase64Character(code) {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x2b ||
    code === 0x2f ||
    code === 0x3d
  );
}

function isValidBase64Candidate(text, start, end) {
  let firstPadding = -1;
  for (let index = start; index < end; index += 1) {
    if (text.charCodeAt(index) === 0x3d) {
      if (firstPadding < 0) firstPadding = index;
      continue;
    }
    if (firstPadding >= 0) return false;
  }

  const padding = firstPadding < 0 ? 0 : end - firstPadding;
  const dataLength = end - start - padding;
  if (padding > 2 || dataLength % 4 === 1) return false;
  return padding === 0 || (end - start) % 4 === 0;
}

function containsJwtCandidate(text) {
  for (let index = 0; index < text.length; ) {
    if (
      !isBase64UrlCharacter(text.charCodeAt(index)) ||
      (index > 0 && isBase64UrlCharacter(text.charCodeAt(index - 1)))
    ) {
      index += 1;
      continue;
    }

    const headerEnd = readBase64UrlSegmentEnd(text, index);
    if (text.charCodeAt(headerEnd) !== 0x2e) {
      index = Math.max(index + 1, headerEnd);
      continue;
    }

    const payloadStart = headerEnd + 1;
    const payloadEnd = readBase64UrlSegmentEnd(text, payloadStart);
    if (
      payloadStart === payloadEnd ||
      text.charCodeAt(payloadEnd) !== 0x2e
    ) {
      index = Math.max(index + 1, payloadEnd);
      continue;
    }

    const signatureStart = payloadEnd + 1;
    const signatureEnd = readBase64UrlSegmentEnd(text, signatureStart);
    const headerLength = headerEnd - index;
    const payloadLength = payloadEnd - payloadStart;
    const signatureLength = signatureEnd - signatureStart;
    const header = parseBoundedJwtObject(text, index, headerEnd);
    const claims = parseBoundedJwtObject(text, payloadStart, payloadEnd);

    if (
      isJwtHeader(header) &&
      (claims !== null ||
        payloadLength > MAX_JWT_SEGMENT_CHARACTERS ||
        signatureLength > MAX_JWT_SEGMENT_CHARACTERS)
    ) {
      return true;
    }
    if (isJwtHeader(header) && payloadLength > 0) {
      return true;
    }
    if (
      headerLength > MAX_JWT_SEGMENT_CHARACTERS &&
      looksLikeJsonObjectBase64Url(text, index, headerEnd) &&
      payloadLength > 0
    ) {
      return true;
    }

    index = Math.max(index + 1, signatureEnd);
  }
  return false;
}

function isBase64UrlCharacter(code) {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x2d ||
    code === 0x5f
  );
}

function readBase64UrlSegmentEnd(text, start) {
  let cursor = start;
  while (
    cursor < text.length &&
    isBase64UrlCharacter(text.charCodeAt(cursor))
  ) {
    cursor += 1;
  }
  return cursor;
}

function parseBoundedJwtObject(text, start, end) {
  const length = end - start;
  if (
    length === 0 ||
    length > MAX_JWT_SEGMENT_CHARACTERS ||
    length % 4 === 1
  ) {
    return null;
  }

  try {
    const decoded = utf8Decoder.decode(
      Buffer.from(text.slice(start, end), "base64url"),
    );
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function isJwtHeader(value) {
  return (
    value !== null &&
    typeof value.alg === "string" &&
    value.alg.length > 0
  );
}

function looksLikeJsonObjectBase64Url(text, start, end) {
  return end - start >= 3 && text.slice(start, start + 3) === "eyJ";
}
