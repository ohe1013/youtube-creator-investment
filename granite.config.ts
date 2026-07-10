import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@apps-in-toss/web-framework/config";
import { parseRuntimeConfig } from "./lib/runtime/config";

const localIconPath = resolve("public", "brand", "creatorx-icon-512.png");

export function createGraniteConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const runtime = parseRuntimeConfig(env);
  const icon =
    runtime.releaseChannel === "production"
      ? runtime.brandIconUrl!
      : `data:image/png;base64,${readFileSync(localIconPath).toString("base64")}`;

  return defineConfig({
    appName: "creatorx",
    brand: {
      displayName: "크리에이터X",
      primaryColor: "#2563EB",
      icon,
    },
    web: {
      host: "localhost",
      port: 3000,
      commands: {
        dev: "npm run dev:appintoss",
        build: "npm run build:appintoss",
      },
    },
    permissions: [],
    outdir: "out",
    webViewProps: {
      type: "game",
      overScrollMode: "never",
      mediaPlaybackRequiresUserAction: true,
    },
  });
}

export default createGraniteConfig();
