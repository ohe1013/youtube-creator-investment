import { spawnSync } from "node:child_process";

const env = {
  ...process.env,
  APP_IN_TOSS: "1",
  NEXT_PUBLIC_APP_IN_TOSS: "1",
};

const result = spawnSync("npx", ["next", "dev"], {
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
