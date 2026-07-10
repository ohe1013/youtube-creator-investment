import { spawnSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const root = process.cwd();
const apiDir = join(root, "app", "api");
const disabledApiDir = join(root, ".appintoss-api-disabled");
const env = {
  ...process.env,
  APP_IN_TOSS: "1",
  NEXT_PUBLIC_APP_IN_TOSS: "1",
  NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL:
    process.env.NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL ?? "sandbox",
  NEXT_PUBLIC_CREATORX_DATA_MODE:
    process.env.NEXT_PUBLIC_CREATORX_DATA_MODE ?? "demo",
};

let apiHidden = false;

try {
  if (existsSync(disabledApiDir)) {
    throw new Error(`${disabledApiDir} already exists. Restore app/api before building.`);
  }

  if (existsSync(apiDir)) {
    renameSync(apiDir, disabledApiDir);
    apiHidden = true;
  }

  const result = spawnSync(process.execPath, [nextBin, "build"], {
    env,
    stdio: "inherit",
  });

  process.exitCode = result.status ?? 1;
} finally {
  if (apiHidden && existsSync(disabledApiDir)) {
    renameSync(disabledApiDir, apiDir);
  }
}
