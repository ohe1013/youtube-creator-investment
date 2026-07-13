import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { assertTestDatabaseUrls } from "./test-database-safety.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

loadEnv({
  path: fileURLToPath(new URL("../.env.test.local", import.meta.url)),
  quiet: true,
});

assertTestDatabaseUrls(process.env);

const result = spawnSync(
  process.execPath,
  [require.resolve("prisma"), "migrate", "deploy"],
  {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  },
);

if (result.error) {
  throw result.error;
}

if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  process.exitCode = result.status ?? 1;
}
