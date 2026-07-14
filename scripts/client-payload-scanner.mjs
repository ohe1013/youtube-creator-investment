import { Buffer } from "node:buffer";
import { tokenizer } from "acorn";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf16LittleEndianDecoder = new TextDecoder("utf-16le", { fatal: true });
const utf16BigEndianDecoder = new TextDecoder("utf-16be", { fatal: true });

const MAX_BASE64_CANDIDATE_CHARACTERS = 16 * 1024;
const MIN_BASE64_CANDIDATE_CHARACTERS = 32;
const MAX_JWT_SEGMENT_CHARACTERS = 16 * 1024;
const UTF16_PROBE_BYTES = 4 * 1024;
const MAX_ALLOWED_ANON_JWT_LITERAL_RANGES = 128;
const MAX_STATIC_STRING_EXPRESSION_PARTS = 8;
const MAX_STATIC_STRING_EXPRESSION_CHARACTERS = 256;
const MAX_STRUCTURAL_CONTEXT_DEPTH = 32;

const SUPABASE_ANON_KEY = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

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
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9-]{10,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
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
    const policyCode = detectJavaScriptPolicy(view);
    if (policyCode) {
      return {
        detected: true,
        code: policyCode,
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

function detectJavaScriptPolicy(text) {
  const allowedJwtLiteralRanges = new Set();

  try {
    const context = createJavaScriptContext();
    const cursor = createTokenCursor(text, (token) => context.observe(token));

    for (let token = cursor.next(); token; token = cursor.next()) {
      const setterCode = tryReadBuiltinSetterCall(
        cursor,
        token,
        text,
        allowedJwtLiteralRanges,
        context,
      );
      if (setterCode) return setterCode;

      const directCode = tryReadDirectAssignment(
        cursor,
        token,
        text,
        allowedJwtLiteralRanges,
        context.isObjectPropertyStart(),
      );
      if (directCode) return directCode;

      const computedCode = tryReadComputedAssignment(
        cursor,
        token,
        text,
        allowedJwtLiteralRanges,
        context.isObjectPropertyStart(),
      );
      if (computedCode) return computedCode;
    }
  } catch {
    return containsUnapprovedJwtCandidate(text)
      ? ClientPayloadDetectionCode.UNAPPROVED_JWT
      : null;
  }

  return containsUnapprovedJwtCandidate(text, allowedJwtLiteralRanges)
    ? ClientPayloadDetectionCode.UNAPPROVED_JWT
    : null;
}

function* iterateTokens(text) {
  const stream = tokenizer(text, {
    ecmaVersion: "latest",
    sourceType: "script",
    allowHashBang: true,
  });
  for (
    let token = stream.getToken();
    token.type.label !== "eof";
    token = stream.getToken()
  ) {
    yield token;
  }
}

function createTokenCursor(text, onToken) {
  const tokens = iterateTokens(text);
  let first = null;
  let second = null;
  let third = null;

  function fill(count) {
    while (count > 0) {
      if (first === null) {
        const next = tokens.next();
        if (next.done) return;
        first = next.value;
      } else if (second === null) {
        const next = tokens.next();
        if (next.done) return;
        second = next.value;
      } else if (third === null) {
        const next = tokens.next();
        if (next.done) return;
        third = next.value;
      } else {
        return;
      }
      count -= 1;
    }
  }

  return {
    next() {
      fill(1);
      const current = first;
      first = second;
      second = third;
      third = null;
      if (current !== null) onToken(current);
      return current;
    },
    peek(position = 1) {
      fill(position);
      if (position === 1) return first;
      if (position === 2) return second;
      return position === 3 ? third : null;
    },
  };
}

function createJavaScriptContext() {
  let structures = "";
  let overflowDepth = 0;
  let previous = null;
  let beforePrevious = null;

  function pushStructure(value) {
    if (overflowDepth > 0) {
      overflowDepth += 1;
      return;
    }
    if (structures.length >= MAX_STRUCTURAL_CONTEXT_DEPTH) {
      overflowDepth = 1;
      return;
    }
    structures += value;
  }

  function popStructure() {
    if (overflowDepth > 0) {
      overflowDepth -= 1;
      return;
    }
    if (structures.length > 0) structures = structures.slice(0, -1);
  }

  return {
    observe(token) {
      if (token.type.label === "{") {
        pushStructure(isObjectLiteralOpening(previous) ? "o" : "b");
      } else if (token.type.label === "${") {
        pushStructure("t");
      } else if (token.type.label === "}") {
        popStructure();
      }
      beforePrevious = previous;
      previous = token;
    },
    isObjectPropertyStart() {
      const priorLabel = beforePrevious?.type.label;
      return (
        overflowDepth === 0 &&
        structures.endsWith("o") &&
        (priorLabel === "{" || priorLabel === ",")
      );
    },
  };
}

function isObjectLiteralOpening(previous) {
  switch (previous?.type.label) {
    case "=":
    case "(":
    case "[":
    case ",":
    case "return":
    case "?":
      return true;
    default:
      return false;
  }
}

function tryReadBuiltinSetterCall(
  cursor,
  token,
  text,
  allowedRanges,
  context,
) {
  if (token.type.label !== "name") return null;

  const objectName = token.value;
  if (objectName !== "Object" && objectName !== "Reflect") return null;

  const dot = cursor.peek();
  const method = cursor.peek(2);
  const open = cursor.peek(3);
  if (
    dot?.type.label !== "." ||
    method?.type.label !== "name" ||
    open?.type.label !== "("
  ) {
    return null;
  }

  const methodName = method.value;
  const isDefineProperty = methodName === "defineProperty";
  const isReflectSet = objectName === "Reflect" && methodName === "set";
  if (!isDefineProperty && !isReflectSet) return null;

  cursor.next();
  cursor.next();
  cursor.next();
  const firstArgument = skipCallArgument(cursor, context);
  if (firstArgument.code) return firstArgument.code;
  if (firstArgument.delimiter !== ",") return null;

  const key = readStaticStringExpression(cursor);
  if (key === null || cursor.peek()?.type.label !== ",") return null;
  cursor.next();

  if (isSensitivePublicConfigurationKey(key)) {
    return ClientPayloadDetectionCode.PUBLIC_SECRET_ASSIGNMENT;
  }
  if (key !== SUPABASE_ANON_KEY) return null;

  const literal = isReflectSet
    ? readStaticAssignmentLiteral(cursor, text)
    : readDescriptorValueLiteral(cursor, text);
  markAllowedAnonymousJwtRange(allowedRanges, literal);
  return null;
}

function skipCallArgument(cursor, context) {
  let nested = 0;

  for (let token = cursor.next(); token; token = cursor.next()) {
    const assignmentCode = tryReadSensitiveSkippedAssignment(
      cursor,
      token,
      context.isObjectPropertyStart(),
    );
    if (assignmentCode) return { code: assignmentCode };

    const label = token.type.label;
    if (label === "(" || label === "[" || label === "{") {
      nested += 1;
      continue;
    }
    if (label === ")" || label === "]" || label === "}") {
      if (nested === 0) return { code: null, delimiter: label };
      nested -= 1;
      continue;
    }
    if (label === "," && nested === 0) {
      return { code: null, delimiter: label };
    }
  }

  return { code: null, delimiter: null };
}

function tryReadSensitiveSkippedAssignment(
  cursor,
  token,
  isObjectPropertyStart,
) {
  if (isStaticKeyToken(token)) {
    const operator = cursor.peek();
    if (
      (operator?.type.label === "=" ||
        (operator?.type.label === ":" && isObjectPropertyStart)) &&
      isSensitivePublicConfigurationKey(token.value)
    ) {
      return ClientPayloadDetectionCode.PUBLIC_SECRET_ASSIGNMENT;
    }
  }

  if (token.type.label !== "[") return null;

  const key = readStaticStringExpression(cursor);
  const operator = cursor.peek(2);
  if (
    key !== null &&
    cursor.peek()?.type.label === "]" &&
    (operator?.type.label === "=" ||
      (operator?.type.label === ":" && isObjectPropertyStart)) &&
    isSensitivePublicConfigurationKey(key)
  ) {
    return ClientPayloadDetectionCode.PUBLIC_SECRET_ASSIGNMENT;
  }

  return null;
}

function readDescriptorValueLiteral(cursor, text) {
  if (cursor.peek()?.type.label !== "{") return null;
  cursor.next();
  let depth = 1;

  for (let token = cursor.next(); token; token = cursor.next()) {
    const label = token.type.label;
    if (label === "{") {
      depth += 1;
      continue;
    }
    if (label === "}") {
      depth -= 1;
      if (depth === 0) return null;
      continue;
    }
    if (
      depth === 1 &&
      isStaticKeyToken(token) &&
      token.value === "value" &&
      cursor.peek()?.type.label === ":"
    ) {
      cursor.next();
      return readStaticAssignmentLiteral(cursor, text);
    }
  }

  return null;
}

function tryReadDirectAssignment(
  cursor,
  token,
  text,
  allowedRanges,
  isObjectPropertyStart,
) {
  if (!isStaticKeyToken(token)) return null;

  const operator = cursor.peek();
  if (
    operator?.type.label !== "=" &&
    !(operator?.type.label === ":" && isObjectPropertyStart)
  ) {
    return null;
  }

  cursor.next();
  return classifyStaticPublicAssignment(
    cursor,
    token.value,
    text,
    allowedRanges,
  );
}

function tryReadComputedAssignment(
  cursor,
  token,
  text,
  allowedRanges,
  isObjectPropertyStart,
) {
  if (token.type.label !== "[") return null;

  const key = readStaticStringExpression(cursor);
  if (
    key === null ||
    cursor.peek()?.type.label !== "]" ||
    (cursor.peek(2)?.type.label !== "=" &&
      !(cursor.peek(2)?.type.label === ":" && isObjectPropertyStart))
  ) {
    return null;
  }

  cursor.next();
  cursor.next();
  return classifyStaticPublicAssignment(cursor, key, text, allowedRanges);
}

function classifyStaticPublicAssignment(cursor, key, text, allowedRanges) {
  if (isSensitivePublicConfigurationKey(key)) {
    return ClientPayloadDetectionCode.PUBLIC_SECRET_ASSIGNMENT;
  }
  if (key !== SUPABASE_ANON_KEY) return null;

  const literal = readStaticAssignmentLiteral(cursor, text);
  markAllowedAnonymousJwtRange(allowedRanges, literal);
  return null;
}

function isStaticKeyToken(token) {
  return token.type.label === "name" || token.type.label === "string";
}

function readStaticStringExpression(cursor) {
  let parentheses = 0;
  while (cursor.peek()?.type.label === "(") {
    if (parentheses >= MAX_STATIC_STRING_EXPRESSION_PARTS) return null;
    cursor.next();
    parentheses += 1;
  }

  const first = readStaticStringToken(cursor);
  if (first === null) return null;

  let value = first;
  let parts = 1;
  while (isPlusToken(cursor.peek())) {
    if (parts >= MAX_STATIC_STRING_EXPRESSION_PARTS) return null;
    cursor.next();
    const next = readStaticStringToken(cursor);
    if (next === null || value.length + next.length > MAX_STATIC_STRING_EXPRESSION_CHARACTERS) {
      return null;
    }
    value += next;
    parts += 1;
  }

  while (parentheses > 0) {
    if (cursor.peek()?.type.label !== ")") return null;
    cursor.next();
    parentheses -= 1;
  }

  return value;
}

function readStaticStringToken(cursor) {
  const token = cursor.peek();
  if (token?.type.label !== "string" || typeof token.value !== "string") {
    return null;
  }
  if (token.value.length > MAX_STATIC_STRING_EXPRESSION_CHARACTERS) {
    return null;
  }
  cursor.next();
  return token.value;
}

function readStaticAssignmentLiteral(cursor, text) {
  const token = cursor.peek();
  if (token?.type.label !== "string" || typeof token.value !== "string") {
    return null;
  }
  cursor.next();

  if (!isStaticAssignmentLiteralTerminator(cursor.peek())) return null;

  const quote = text.charCodeAt(token.start);
  const rawStart = token.start + 1;
  const rawEnd = token.end - 1;
  if (
    (quote !== 0x22 && quote !== 0x27) ||
    text.charCodeAt(rawEnd) !== quote ||
    text.slice(rawStart, rawEnd) !== token.value
  ) {
    return null;
  }

  return { value: token.value, start: rawStart, end: rawEnd };
}

function isPlusToken(token) {
  return token?.value === "+";
}

function isStaticAssignmentLiteralTerminator(token) {
  if (token === null) return true;
  switch (token.type.label) {
    case ";":
    case ",":
    case ")":
    case "}":
      return true;
    default:
      return false;
  }
}

function markAllowedAnonymousJwtRange(allowedRanges, literal) {
  if (
    literal === null ||
    allowedRanges.size >= MAX_ALLOWED_ANON_JWT_LITERAL_RANGES ||
    !isAnonymousJwtLiteral(literal.value)
  ) {
    return;
  }

  allowedRanges.add(`${literal.start}:${literal.end}`);
}

function isAnonymousJwtLiteral(value) {
  const candidate = readJwtCandidate(value, 0);
  return Boolean(
    candidate &&
      candidate.end === value.length &&
      isJwtHeader(candidate.header) &&
      candidate.claims?.role === "anon",
  );
}

function isSensitivePublicConfigurationKey(value) {
  const normalized = value.replaceAll("-", "_").toUpperCase();
  return (
    normalized.startsWith("NEXT_PUBLIC_") &&
    /(?:API_KEY|CLIENT_SECRET|SECRET_KEY|SERVICE_ROLE_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|DATABASE_URL)$/.test(
      normalized,
    )
  );
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

function containsUnapprovedJwtCandidate(text, allowedRanges = null) {
  for (let index = 0; index < text.length; ) {
    if (
      !isBase64UrlCharacter(text.charCodeAt(index)) ||
      (index > 0 && isBase64UrlCharacter(text.charCodeAt(index - 1)))
    ) {
      index += 1;
      continue;
    }

    const candidate = readJwtCandidate(text, index);
    if (candidate === null) {
      index += 1;
      continue;
    }

    if (
      !allowedRanges?.has(`${index}:${candidate.end}`) &&
      isJwtCandidate(candidate)
    ) {
      return true;
    }

    index = Math.max(index + 1, candidate.end);
  }
  return false;
}

function readJwtCandidate(text, start) {
  const headerEnd = readBase64UrlSegmentEnd(text, start);
  if (text.charCodeAt(headerEnd) !== 0x2e) return null;

  const payloadStart = headerEnd + 1;
  const payloadEnd = readBase64UrlSegmentEnd(text, payloadStart);
  if (payloadStart === payloadEnd || text.charCodeAt(payloadEnd) !== 0x2e) {
    return null;
  }

  const signatureStart = payloadEnd + 1;
  const end = readBase64UrlSegmentEnd(text, signatureStart);
  return {
    end,
    headerLength: headerEnd - start,
    payloadLength: payloadEnd - payloadStart,
    signatureLength: end - signatureStart,
    header: parseBoundedJwtObject(text, start, headerEnd),
    claims: parseBoundedJwtObject(text, payloadStart, payloadEnd),
  };
}

function isJwtCandidate(candidate) {
  return (
    (isJwtHeader(candidate.header) && candidate.payloadLength > 0) ||
    (candidate.headerLength > MAX_JWT_SEGMENT_CHARACTERS &&
      candidate.payloadLength > 0)
  );
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
