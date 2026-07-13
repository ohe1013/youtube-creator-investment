import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

const vercelConfigPath = fileURLToPath(
  new URL("../../vercel.json", import.meta.url),
);

async function loadRunner() {
  return await import("../../scripts/vercel-build.mjs");
}

describe("Vercel build gate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the locked install and delegates Vercel builds to the gate runner", () => {
    const config = JSON.parse(readFileSync(vercelConfigPath, "utf8"));

    expect(config.installCommand).toBe("npm ci");
    expect(config.buildCommand).toBe("node scripts/vercel-build.mjs");
  });

  it("runs production preflight before the normal build without logging environment values", async () => {
    const { runVercelBuild } = await loadRunner();
    const spawn = vi.fn().mockReturnValue({ status: 0 });
    const secret = "do-not-log-this-value";
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = {
      NODE_ENV: "test" as const,
      VERCEL_ENV: "production",
      DATABASE_URL: secret,
    };

    const status = runVercelBuild({
      cwd: "/workspace",
      env,
      platform: "linux",
      spawn,
    });

    expect(status).toBe(0);
    expect(spawn).toHaveBeenNthCalledWith(1, "npm", ["run", "production:preflight"], {
      cwd: "/workspace",
      env,
      stdio: "inherit",
    });
    expect(spawn).toHaveBeenNthCalledWith(2, "npm", ["run", "build"], {
      cwd: "/workspace",
      env,
      stdio: "inherit",
    });
    expect([...log.mock.calls, ...warn.mock.calls, ...error.mock.calls].join(" ")).not.toContain(secret);
  });

  it.each(["preview", "development", undefined])(
    "runs only the normal build for VERCEL_ENV=%s",
    async (vercelEnv) => {
      const { runVercelBuild } = await loadRunner();
      const spawn = vi.fn().mockReturnValue({ status: 0 });

      const status = runVercelBuild({
        cwd: "/workspace",
        env: {
          NODE_ENV: "test",
          ...(vercelEnv === undefined ? {} : { VERCEL_ENV: vercelEnv }),
        },
        platform: "linux",
        spawn,
      });

      expect(status).toBe(0);
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(spawn).toHaveBeenCalledWith("npm", ["run", "build"], expect.any(Object));
    },
  );

  it("stops before the normal build when production preflight fails", async () => {
    const { runVercelBuild } = await loadRunner();
    const spawn = vi.fn().mockReturnValue({ status: 23 });

    const status = runVercelBuild({
      cwd: "/workspace",
      env: { NODE_ENV: "test", VERCEL_ENV: "production" },
      platform: "linux",
      spawn,
    });

    expect(status).toBe(23);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      "npm",
      ["run", "production:preflight"],
      expect.any(Object),
    );
  });

  it("uses the Windows npm executable when requested", async () => {
    const { npmExecutable } = await loadRunner();

    expect(npmExecutable("win32")).toBe("npm.cmd");
    expect(npmExecutable("linux")).toBe("npm");
  });
});
