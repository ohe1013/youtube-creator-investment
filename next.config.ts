import type { NextConfig } from "next";
const appInTossBuild = process.env.APP_IN_TOSS === "1";


const nextConfig: NextConfig = {
  reactCompiler: true,
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
