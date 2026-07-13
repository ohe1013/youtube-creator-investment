import { spawnSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { createRequire } from "node:module";

import { runAppInTossBuild } from "./appintoss-build-runner.mjs";
import { resolveAppInTossBuildEnvironment } from "./appintoss-build-options.mjs";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const root = process.cwd();
const env = resolveAppInTossBuildEnvironment({
  argv: process.argv.slice(2),
  env: process.env,
});

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
