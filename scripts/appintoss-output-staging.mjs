import { promises as nodeFs } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

const TRANSIENT_WINDOWS_MOVE_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 25;

/**
 * @typedef {(milliseconds: number) => Promise<void>} Delay
 * @typedef {{ rename(from: string, to: string): Promise<void> }} RenameFilesystem
 * @typedef {{
 *   mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
 *   readdir(path: string): Promise<string[]>;
 *   rename(from: string, to: string): Promise<void>;
 * }} GeneratedOutputFilesystem
 * @typedef {{
 *   from: string;
 *   to: string;
 *   fs?: RenameFilesystem;
 *   delay?: Delay;
 *   retries?: number;
 *   retryDelayMs?: number;
 * }} GeneratedOutputRenameOptions
 * @typedef {{
 *   outDir: string;
 *   fs?: GeneratedOutputFilesystem;
 *   delay?: Delay;
 *   retries?: number;
 *   retryDelayMs?: number;
 * }} GeneratedOutputStagingOptions
 */

function delay(milliseconds) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds);
  });
}

function isInside(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot !== "" &&
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

function assertTopLevelOutputEntry(entry) {
  if (
    typeof entry !== "string" ||
    entry.length === 0 ||
    entry === "." ||
    entry === ".." ||
    entry !== basename(entry) ||
    entry.includes("/") ||
    entry.includes("\\")
  ) {
    throw new Error("App-in-Toss staging received an unsafe generated output entry");
  }
}

export function isTransientWindowsMoveError(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    TRANSIENT_WINDOWS_MOVE_CODES.has(error.code)
  );
}

/** @param {GeneratedOutputRenameOptions} options */
export async function renameGeneratedOutputWithRetry({
  from,
  to,
  fs = nodeFs,
  delay: wait = delay,
  retries = DEFAULT_RETRIES,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      if (!isTransientWindowsMoveError(error) || attempt >= retries) throw error;
      await wait(retryDelayMs);
    }
  }
}

/** @param {GeneratedOutputStagingOptions} options */
export async function stageAppInTossOutput({
  outDir,
  fs = nodeFs,
  delay: wait = delay,
  retries = DEFAULT_RETRIES,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
}) {
  const generatedOutDir = resolve(outDir);
  const webDir = join(generatedOutDir, "web");
  await fs.mkdir(webDir, { recursive: true });

  const entries = await fs.readdir(generatedOutDir);
  for (const entry of entries) {
    if (entry === "web") continue;
    assertTopLevelOutputEntry(entry);

    const from = join(generatedOutDir, entry);
    const to = join(webDir, entry);
    if (!isInside(generatedOutDir, from) || !isInside(generatedOutDir, to)) {
      throw new Error("App-in-Toss staging attempted to leave generated output");
    }

    await renameGeneratedOutputWithRetry({
      from,
      to,
      fs,
      delay: wait,
      retries,
      retryDelayMs,
    });
  }

  return webDir;
}
