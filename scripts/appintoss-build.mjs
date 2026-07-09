import { spawnSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const apiDir = join(root, "app", "api");
const disabledApiDir = join(root, ".appintoss-api-disabled");
const env = {
  ...process.env,
  APP_IN_TOSS: "1",
  NEXT_PUBLIC_APP_IN_TOSS: "1",
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

  const result = spawnSync("npx", ["next", "build"], {
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  process.exitCode = result.status ?? 1;
} finally {
  if (apiHidden && existsSync(disabledApiDir)) {
    renameSync(disabledApiDir, apiDir);
  }
}
