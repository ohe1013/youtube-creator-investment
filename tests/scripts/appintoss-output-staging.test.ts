import { basename, join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  stageAppInTossOutput,
} from "../../scripts/appintoss-output-staging.mjs";

const OUT_DIR = resolve("generated-out");
const WEB_DIR = join(OUT_DIR, "web");

function filesystemFor(
  initialEntries: string[],
  beforeRename: (from: string, to: string) => Promise<void> | void = () => undefined,
) {
  const entries = new Set(initialEntries);
  const moves: Array<{ from: string; to: string }> = [];
  const fs = {
    mkdir: vi.fn(async (path: string) => {
      if (path !== WEB_DIR) throw new Error(`unexpected mkdir: ${path}`);
      entries.add("web");
    }),
    readdir: vi.fn(async (path: string) => {
      if (path !== OUT_DIR) throw new Error(`unexpected readdir: ${path}`);
      return [...entries];
    }),
    rename: vi.fn(async (from: string, to: string) => {
      await beforeRename(from, to);
      if (!from.startsWith(`${OUT_DIR}\\`) || !to.startsWith(`${WEB_DIR}\\`)) {
        throw new Error(`move escaped generated output: ${from} -> ${to}`);
      }
      const name = basename(from);
      if (!entries.has(name)) throw new Error(`missing staged entry: ${name}`);
      entries.delete(name);
      moves.push({ from, to });
    }),
  };
  return { fs, moves };
}

describe("stageAppInTossOutput", () => {
  it("moves each static-export entry under out/web and leaves the staging directory in place", async () => {
    const { fs, moves } = filesystemFor(["_next", "404.html", "index.html"]);

    await stageAppInTossOutput({ outDir: OUT_DIR, fs });

    expect(fs.mkdir).toHaveBeenCalledWith(WEB_DIR, { recursive: true });
    expect(moves).toEqual([
      { from: join(OUT_DIR, "_next"), to: join(WEB_DIR, "_next") },
      { from: join(OUT_DIR, "404.html"), to: join(WEB_DIR, "404.html") },
      { from: join(OUT_DIR, "index.html"), to: join(WEB_DIR, "index.html") },
    ]);
  });

  it("retries one transient Windows rename failure before completing the staged move", async () => {
    let attempts = 0;
    const transient = Object.assign(new Error("output directory is busy"), {
      code: "EPERM",
    });
    const { fs, moves } = filesystemFor(["index.html"], () => {
      attempts += 1;
      if (attempts === 1) throw transient;
    });
    const delay = vi.fn().mockResolvedValue(undefined);

    await stageAppInTossOutput({
      outDir: OUT_DIR,
      fs,
      delay,
      retries: 1,
      retryDelayMs: 1,
    });

    expect(fs.rename).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledWith(1);
    expect(moves).toEqual([
      { from: join(OUT_DIR, "index.html"), to: join(WEB_DIR, "index.html") },
    ]);
  });

  it("propagates a persistent transient error after its bounded retry without moving outside out", async () => {
    const persistent = Object.assign(new Error("output directory remains busy"), {
      code: "EACCES",
    });
    const { fs, moves } = filesystemFor(["index.html"], () => {
      throw persistent;
    });
    const delay = vi.fn().mockResolvedValue(undefined);

    await expect(
      stageAppInTossOutput({
        outDir: OUT_DIR,
        fs,
        delay,
        retries: 1,
        retryDelayMs: 1,
      }),
    ).rejects.toBe(persistent);

    expect(fs.rename).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledWith(1);
    expect(moves).toEqual([]);
  });
});
