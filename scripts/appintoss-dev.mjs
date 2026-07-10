import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const env = {
  ...process.env,
  APP_IN_TOSS: "1",
  NEXT_PUBLIC_APP_IN_TOSS: "1",
  NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL:
    process.env.NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL ?? "sandbox",
  NEXT_PUBLIC_CREATORX_DATA_MODE:
    process.env.NEXT_PUBLIC_CREATORX_DATA_MODE ?? "demo",
};

const result = spawnSync(process.execPath, [nextBin, "dev"], {
  env,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
