import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);

const legacyTossLogoUrl =
  "https://static.toss.im/icons/png/4x/icon-toss-logo.png";

function isTossBrandIcon(value: string) {
  const url = new URL(value);
  return (
    value === legacyTossLogoUrl ||
    (url.hostname.toLowerCase() === "static.toss.im" &&
      url.pathname.toLowerCase().includes("toss-logo"))
  );
}

function isRemoteHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const normalizedHostname = hostname.replace(/^\[|\]$/g, "");
    const ipv4 = normalizedHostname.split(".").map(Number);
    const isIpv4 =
      ipv4.length === 4 &&
      ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
    const isPrivateIpv4 =
      isIpv4 &&
      (ipv4[0] === 0 ||
        ipv4[0] === 10 ||
        ipv4[0] === 127 ||
        (ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127) ||
        (ipv4[0] === 169 && ipv4[1] === 254) ||
        (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) ||
        (ipv4[0] === 192 && ipv4[1] === 168));
    const isPrivateIpv6 =
      normalizedHostname === "::" ||
      normalizedHostname === "::1" ||
      /^(?:fc|fd|fe[89ab])/i.test(normalizedHostname);
    const isLocal =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      (!isIpv4 &&
        !normalizedHostname.includes(".") &&
        !normalizedHostname.includes(":")) ||
      isPrivateIpv4 ||
      isPrivateIpv6;

    return url.protocol === "https:" && !isLocal;
  } catch {
    return false;
  }
}

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
    if (
      !value.NEXT_PUBLIC_CREATORX_API_BASE_URL ||
      !isRemoteHttpsUrl(value.NEXT_PUBLIC_CREATORX_API_BASE_URL)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_CREATORX_API_BASE_URL"],
        message: "production requires a remote HTTPS API URL",
      });
    }
    if (
      !value.NEXT_PUBLIC_CREATORX_SUPPORT_URL ||
      !isRemoteHttpsUrl(value.NEXT_PUBLIC_CREATORX_SUPPORT_URL)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_CREATORX_SUPPORT_URL"],
        message: "production requires a remote HTTPS support URL",
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

    const iconUrl = value.NEXT_PUBLIC_CREATORX_ICON_URL;
    if (iconUrl && !isRemoteHttpsUrl(iconUrl)) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_CREATORX_ICON_URL"],
        message: "production icon must be a remote HTTPS URL",
      });
    } else if (iconUrl && isTossBrandIcon(iconUrl)) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_CREATORX_ICON_URL"],
        message: "production icon must be CreatorX-owned, not the Toss logo",
      });
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

export function readPublicRuntimeConfig(): CreatorXRuntimeConfig {
  return parseRuntimeConfig({
    NEXT_PUBLIC_APP_IN_TOSS: process.env.NEXT_PUBLIC_APP_IN_TOSS,
    NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL:
      process.env.NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL,
    NEXT_PUBLIC_CREATORX_DATA_MODE:
      process.env.NEXT_PUBLIC_CREATORX_DATA_MODE,
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
    NEXT_PUBLIC_CREATORX_ICON_URL: process.env.NEXT_PUBLIC_CREATORX_ICON_URL,
  });
}
