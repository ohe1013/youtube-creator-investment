import { z } from "zod";
import { parsePublicEnv } from "@/lib/config/public-env";
import { parseDevelopmentOrigins } from "@/lib/server/http/cors";

const optionalNonempty = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().min(1).optional(),
);

const optionalPostgresUrl = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z
    .string()
    .url()
    .refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === "postgres:" || protocol === "postgresql:";
    }, "database URL must use PostgreSQL")
    .optional(),
);

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: optionalPostgresUrl,
  DIRECT_URL: optionalPostgresUrl,
  CREATORX_ACCESS_TOKEN_SECRET: optionalNonempty,
  CREATORX_IDENTITY_PEPPER: optionalNonempty,
  CRON_SECRET: optionalNonempty,
  CREATORX_DEV_CORS_ORIGINS: z.string().optional(),
  CREATORX_TRUST_PROXY: z.enum(["0", "1"]).default("0"),
  VERCEL: z.literal("1").optional(),
});

export type CreatorXServerEnv = {
  nodeEnv: "development" | "test" | "production";
  isProduction: boolean;
  databaseUrl: string | null;
  directUrl: string | null;
  accessTokenSecret: string | null;
  identityPepper: string | null;
  cronSecret: string | null;
  developmentCorsOrigins: string[];
  trustForwardedProto: boolean;
};

export function parseServerEnv(
  env: Record<string, string | undefined>,
): CreatorXServerEnv {
  const value = schema.parse(env);
  const publicEnv = parsePublicEnv(env);
  const trustForwardedProto =
    value.VERCEL === "1" || value.CREATORX_TRUST_PROXY === "1";
  const developmentCorsOrigins = parseDevelopmentOrigins(
    value.CREATORX_DEV_CORS_ORIGINS,
  );
  if (value.NODE_ENV === "production" && developmentCorsOrigins.length > 0) {
    throw new Error("production cannot enable development CORS origins");
  }
  if (
    value.NODE_ENV === "production" &&
    publicEnv.releaseChannel !== "production"
  ) {
    throw new Error("production requires public release channel production");
  }
  if (value.NODE_ENV === "production" && !trustForwardedProto) {
    throw new Error("production requires a trusted proxy attestation");
  }
  if (
    value.NODE_ENV === "production" &&
    (!value.CREATORX_IDENTITY_PEPPER ||
      value.CREATORX_IDENTITY_PEPPER.trim().length < 32)
  ) {
    throw new Error("production requires an identity pepper of at least 32 characters");
  }

  return {
    nodeEnv: value.NODE_ENV,
    isProduction: value.NODE_ENV === "production",
    databaseUrl: value.DATABASE_URL ?? null,
    directUrl: value.DIRECT_URL ?? null,
    accessTokenSecret: value.CREATORX_ACCESS_TOKEN_SECRET ?? null,
    identityPepper: value.CREATORX_IDENTITY_PEPPER ?? null,
    cronSecret: value.CRON_SECRET ?? null,
    developmentCorsOrigins,
    trustForwardedProto,
  };
}

export function readServerEnv() {
  return parseServerEnv({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    CREATORX_ACCESS_TOKEN_SECRET: process.env.CREATORX_ACCESS_TOKEN_SECRET,
    CREATORX_IDENTITY_PEPPER: process.env.CREATORX_IDENTITY_PEPPER,
    CRON_SECRET: process.env.CRON_SECRET,
    CREATORX_DEV_CORS_ORIGINS: process.env.CREATORX_DEV_CORS_ORIGINS,
    CREATORX_TRUST_PROXY: process.env.CREATORX_TRUST_PROXY,
    VERCEL: process.env.VERCEL,
    NEXT_PUBLIC_APP_IN_TOSS: process.env.NEXT_PUBLIC_APP_IN_TOSS,
    NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL:
      process.env.NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL,
    NEXT_PUBLIC_CREATORX_DATA_MODE: process.env.NEXT_PUBLIC_CREATORX_DATA_MODE,
    NEXT_PUBLIC_CREATORX_API_BASE_URL:
      process.env.NEXT_PUBLIC_CREATORX_API_BASE_URL,
    NEXT_PUBLIC_CREATORX_OPERATOR_NAME:
      process.env.NEXT_PUBLIC_CREATORX_OPERATOR_NAME,
    NEXT_PUBLIC_CREATORX_SUPPORT_URL:
      process.env.NEXT_PUBLIC_CREATORX_SUPPORT_URL,
    NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT:
      process.env.NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT,
    NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE:
      process.env.NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE,
    NEXT_PUBLIC_CREATORX_ICON_URL:
      process.env.NEXT_PUBLIC_CREATORX_ICON_URL,
  });
}
