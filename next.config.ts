import type { NextConfig } from "next";
import { parsePublicEnv } from "./lib/config/public-env";

const appInTossBuild = process.env.APP_IN_TOSS === "1";
parsePublicEnv(process.env);

const nextConfig: NextConfig = {
  reactCompiler: true,
  poweredByHeader: false,
  ...(appInTossBuild
    ? {
        output: "export" as const,
        trailingSlash: true,
        images: {
          unoptimized: true,
        },
      }
    : {}),
};

export default nextConfig;
