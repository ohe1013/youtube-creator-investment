import { spawnSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { createRequire } from "node:module";

import { runAppInTossBuild } from "./appintoss-build-runner.mjs";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const root = process.cwd();
const env = {
  ...process.env,
  APP_IN_TOSS: "1",
  NEXT_PUBLIC_APP_IN_TOSS: "1",
  NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL:
    process.env.NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL ?? "sandbox",
  NEXT_PUBLIC_CREATORX_DATA_MODE:
    process.env.NEXT_PUBLIC_CREATORX_DATA_MODE ?? "demo",
};

try {
  process.exitCode = await runAppInTossBuild({
    root,
    nextBin,
    env,
    exists: existsSync,
    rename: renameSync,
    spawn: spawnSync,
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
