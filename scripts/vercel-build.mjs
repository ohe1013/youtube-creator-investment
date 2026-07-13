import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function npmExecutable(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

function scriptsForVercelEnvironment(vercelEnv) {
  switch (vercelEnv) {
    case "production":
      return ["production:preflight", "build"];
    case "preview":
    case "development":
      return ["build"];
    default:
      return null;
  }
}

export function runVercelBuild({
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
  spawn = spawnSync,
} = {}) {
  const scripts = scriptsForVercelEnvironment(env.VERCEL_ENV);

  if (!scripts) {
    return 1;
  }

  const isWindows = platform === "win32";
  const npm = npmExecutable(platform);

  for (const script of scripts) {
    const result = spawn(
      isWindows ? `${npm} run ${script}` : npm,
      isWindows ? [] : ["run", script],
      {
        cwd,
        env,
        ...(isWindows ? { shell: true } : {}),
        stdio: "inherit",
      },
    );

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
