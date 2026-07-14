import { lstat, readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  containsSpecificSecretBytes,
  verifyAitArtifact,
} from "./verify-ait-artifact.mjs";

const MAX_CLIENT_FILE_BYTES = 10 * 1024 * 1024;
const specificSecretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9-]{10,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:/@]+:[^\s/@]+@/i,
];
const secretAssignmentPattern =
  /(?:^|[\s,{;])(?:["']?([A-Za-z][A-Za-z0-9_-]{1,127})["']?)\s*[:=]\s*(?:"([^"\r\n]{8,})"|'([^'\r\n]{8,})'|`([^`\r\n]{8,})`|([^\s,;}]{8,}))/gim;

export class ClientSecretScanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ClientSecretScanError";
    this.code = code;
  }
}

function reject(code, message) {
  throw new ClientSecretScanError(code, message);
}

function isSecretBearingKey(key) {
  const normalized = key
    .replaceAll("-", "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase();
  return /(?:API_KEY|CLIENT_SECRET|SECRET_KEY|SERVICE_ROLE_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|DATABASE_URL)$/.test(
    normalized,
  );
}

function isPlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith("process.env.") ||
    normalized.startsWith("import.meta.env.") ||
    normalized.startsWith("${") ||
    normalized.startsWith("<") ||
    normalized.startsWith("your-") ||
    normalized.startsWith("example") ||
    normalized === "undefined" ||
    normalized === "null"
  );
}

function containsClientSecret(text) {
  if (specificSecretPatterns.some((pattern) => pattern.test(text))) return true;

  secretAssignmentPattern.lastIndex = 0;
  for (const match of text.matchAll(secretAssignmentPattern)) {
    const key = match[1] ?? "";
    const literalValue = match[2] ?? match[3] ?? match[4];
    const value = literalValue ?? match[5] ?? "";
    if (literalValue === undefined && !/["'`]/.test(value)) continue;
    if (isSecretBearingKey(key) && !isPlaceholder(value)) return true;
  }
  return false;
}

function readableText(bytes) {
  if (bytes.includes(0)) return null;
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let controlCharacters = 0;
  for (const character of text) {
    const code = character.charCodeAt(0);
    if ((code < 9 || (code > 13 && code < 32)) && code !== 27) {
      controlCharacters += 1;
    }
  }
  return text.length === 0 || controlCharacters / text.length <= 0.02
    ? text
    : null;
}

async function collectClientFiles(root, directory = root, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const label = relative(root, path).replaceAll("\\", "/");
    if (entry.isSymbolicLink()) {
      reject("CLIENT_SCAN_SYMLINK", `Refusing symbolic link in client output: ${label}`);
    }
    if (entry.isDirectory()) {
      await collectClientFiles(root, path, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const stats = await lstat(path);
    if (stats.size > MAX_CLIENT_FILE_BYTES) {
      reject("CLIENT_SCAN_FILE_TOO_LARGE", `Client output file is too large: ${label}`);
    }
    files.push({ path, label });
  }
  return files;
}

/**
 * @param {{ outDir: string; artifactPath?: string }} options
 */
export async function scanClientSecrets({ outDir, artifactPath } = {}) {
  if (!outDir) reject("CLIENT_SCAN_USAGE", "Client output directory is required");
  const root = resolve(outDir);
  let stats;
  try {
    stats = await lstat(root);
  } catch {
    reject("CLIENT_OUTPUT_MISSING", "Client output directory is missing");
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    reject("CLIENT_OUTPUT_INVALID", "Client output directory is invalid");
  }

  const files = await collectClientFiles(root);
  for (const file of files) {
    const bytes = await readFile(file.path);
    if (containsSpecificSecretBytes(bytes)) {
      reject("CLIENT_SECRET_DETECTED", `Suspected secret in client output: ${file.label}`);
    }

    const text = readableText(bytes);
    if (text !== null && containsClientSecret(text)) {
      reject("CLIENT_SECRET_DETECTED", `Suspected secret in client output: ${file.label}`);
    }
  }

  if (artifactPath !== undefined) {
    try {
      await verifyAitArtifact(artifactPath);
    } catch (error) {
      if (error && typeof error === "object" && error.code === "AIT_SECRET_DETECTED") {
        reject("CLIENT_SECRET_DETECTED", "Suspected secret in AIT artifact");
      }
      reject("CLIENT_ARTIFACT_INVALID", "Unable to verify AIT artifact");
    }
  }

  return { filesScanned: files.length };
}

export async function runCli(
  argv = process.argv.slice(2),
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  try {
    if (argv.length !== 0) reject("CLIENT_SCAN_USAGE", "Usage: node scripts/scan-client-secrets.mjs");
    const result = await scanClientSecrets({
      outDir: "out",
      artifactPath: "creatorx.ait",
    });
    stdout.write(`Client secret scan passed: ${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const code =
      error instanceof ClientSecretScanError ? error.code : "CLIENT_SCAN_FAILED";
    const message =
      error instanceof ClientSecretScanError
        ? error.message
        : "Client secret scan failed";
    stderr.write(`${code}: ${message}\n`);
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
