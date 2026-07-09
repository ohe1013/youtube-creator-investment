import { defineConfig } from "@apps-in-toss/web-framework/config";

export default defineConfig({
  appName: "creatorx",
  brand: {
    displayName: "크리에이터X",
    primaryColor: "#2563EB",
    icon: "https://static.toss.im/icons/png/4x/icon-toss-logo.png",
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
    type: "partner",
    overScrollMode: "never",
    mediaPlaybackRequiresUserAction: true,
  },
});
