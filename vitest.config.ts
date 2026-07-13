import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "tests/integration/**"],
    setupFiles: ["./tests/setup.ts"],
    coverage: { reporter: ["text", "html"] },
  },
});
