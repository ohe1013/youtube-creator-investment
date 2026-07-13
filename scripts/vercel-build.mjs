import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function npmExecutable(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

export function runVercelBuild({
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
  spawn = spawnSync,
} = {}) {
  const scripts = env.VERCEL_ENV === "production"
    ? ["production:preflight", "build"]
    : ["build"];

  for (const script of scripts) {
    const result = spawn(npmExecutable(platform), ["run", script], {
      cwd,
      env,
      stdio: "inherit",
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }

  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runVercelBuild();
}
