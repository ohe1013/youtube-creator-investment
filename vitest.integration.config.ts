import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

loadEnv({ path: fileURLToPath(new URL(".env.test.local", import.meta.url)), quiet: true });

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    globalSetup: ["./tests/integration/setup/global-setup.ts"],
    include: ["tests/integration/**/*.test.ts"],
  },
});
