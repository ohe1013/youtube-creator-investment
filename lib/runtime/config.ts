import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);

const schema = z
  .object({
    NEXT_PUBLIC_APP_IN_TOSS: z.enum(["0", "1"]).default("0"),
    NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL: z
      .enum(["development", "sandbox", "production"])
      .default("development"),
    NEXT_PUBLIC_CREATORX_DATA_MODE: z
      .enum(["demo", "remote"])
      .default("remote"),
    NEXT_PUBLIC_CREATORX_API_BASE_URL: z.string().trim().optional(),
    NEXT_PUBLIC_CREATORX_OPERATOR_NAME: z.string().trim().optional(),
    NEXT_PUBLIC_CREATORX_SUPPORT_URL: z.string().url().optional(),
    NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT: z.string().trim().optional(),
    NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE: z.string().date().optional(),
    NEXT_PUBLIC_CREATORX_ICON_URL: optionalUrl,
  })
  .superRefine((value, ctx) => {
    if (value.NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL !== "production") return;
    if (value.NEXT_PUBLIC_CREATORX_DATA_MODE !== "remote") {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_CREATORX_DATA_MODE"],
        message: "production requires remote data mode",
      });
    }
    if (!value.NEXT_PUBLIC_CREATORX_API_BASE_URL?.startsWith("https://")) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_CREATORX_API_BASE_URL"],
        message: "production requires an HTTPS API URL",
      });
    }
    for (const key of [
      "NEXT_PUBLIC_CREATORX_OPERATOR_NAME",
      "NEXT_PUBLIC_CREATORX_SUPPORT_URL",
      "NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT",
      "NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE",
      "NEXT_PUBLIC_CREATORX_ICON_URL",
    ] as const) {
      if (!value[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: key + " is required for production",
        });
      }
    }
  });

export type CreatorXRuntimeConfig = {
  appInToss: boolean;
  releaseChannel: "development" | "sandbox" | "production";
  dataMode: "demo" | "remote";
  apiBaseUrl: URL | null;
  allowBrowserStorageFallback: boolean;
  brandIconUrl: string | null;
  legal: {
    operatorName: string;
    supportUrl: string;
    privacyContact: string;
    effectiveDate: string;
  };
};

export function parseRuntimeConfig(
  env: Record<string, string | undefined>,
): CreatorXRuntimeConfig {
  const value = schema.parse(env);
  return {
    appInToss: value.NEXT_PUBLIC_APP_IN_TOSS === "1",
    releaseChannel: value.NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL,
    dataMode: value.NEXT_PUBLIC_CREATORX_DATA_MODE,
    apiBaseUrl: value.NEXT_PUBLIC_CREATORX_API_BASE_URL
      ? new URL(value.NEXT_PUBLIC_CREATORX_API_BASE_URL)
      : null,
    allowBrowserStorageFallback:
      value.NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL !== "production",
    brandIconUrl: value.NEXT_PUBLIC_CREATORX_ICON_URL ?? null,
    legal: {
      operatorName:
        value.NEXT_PUBLIC_CREATORX_OPERATOR_NAME ?? "CreatorX 개발팀",
      supportUrl:
        value.NEXT_PUBLIC_CREATORX_SUPPORT_URL ??
        "https://github.com/ohe1013/youtube-creator-investment/issues",
      privacyContact:
        value.NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT ?? "GitHub Issues",
      effectiveDate:
        value.NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE ?? "2026-07-10",
    },
  };
}
