import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);

const legacyTossLogoUrl =
  "https://static.toss.im/icons/png/4x/icon-toss-logo.png";
const sandboxOperatorName = "CreatorX 개발팀";
const sandboxSupportUrl =
  "https://github.com/ohe1013/youtube-creator-investment/issues";
const sandboxPrivacyContact = "GitHub Issues";
const localHostnameSuffixes = [
  ".local",
  ".internal",
  ".lan",
  ".localdomain",
  ".home.arpa",
] as const;

function canonicalHostname(url: URL) {
  return url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/g, "");
}

function decodePathname(pathname: string) {
  let decoded = pathname;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded.normalize("NFKC").toLowerCase();
}

function isTossBrandIcon(value: string) {
  const url = new URL(value);
  if (value === legacyTossLogoUrl) return true;
  if (canonicalHostname(url) !== "static.toss.im") return false;

  const compactPathname = decodePathname(url.pathname).replace(
    /[^a-z0-9]+/g,
    "",
  );
  return compactPathname.includes("tosslogo");
}

function parseIpv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  return parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function isAmbiguousIpv4Literal(hostname: string) {
  return (
    /^(?:0x[0-9a-f]+|\d+)(?:\.(?:0x[0-9a-f]+|\d+))*$/i.test(hostname) &&
    !parseIpv4(hostname)
  );
}

function mappedIpv4(hostname: string) {
  const match = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(
    hostname,
  );
  if (!match) return null;

  const high = Number.parseInt(match[1], 16);
  const low = Number.parseInt(match[2], 16);
  return [high >>> 8, high & 0xff, low >>> 8, low & 0xff];
}

function isPrivateIpv4(parts: number[] | null) {
  if (!parts) return false;
  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function isSandboxSupportPlaceholder(value: string) {
  const url = new URL(value);
  const pathname = decodePathname(url.pathname).replace(/\/+$/g, "");
  const sandboxPathname = decodePathname(
    new URL(sandboxSupportUrl).pathname,
  ).replace(/\/+$/g, "");
  return (
    url.protocol === "https:" &&
    canonicalHostname(url) === "github.com" &&
    pathname === sandboxPathname
  );
}

function isRemoteDnsHostname(hostname: string) {
  return (
    hostname.includes(".") &&
    !hostname.includes(":") &&
    !parseIpv4(hostname) &&
    !isAmbiguousIpv4Literal(hostname)
  );
}

function isRemoteHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    const hostname = canonicalHostname(url);
    const ipv4 = parseIpv4(hostname);
    const mapped = mappedIpv4(hostname);
    const isPrivateIpv6 =
      hostname === "::" ||
      hostname === "::1" ||
      /^(?:fc|fd|fe[89ab])/i.test(hostname);
    const isLocalNamespace = localHostnameSuffixes.some(
      (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
    );
    const isLocal =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      (!ipv4 && !hostname.includes(".") && !hostname.includes(":")) ||
      isLocalNamespace ||
      isPrivateIpv4(ipv4) ||
      isPrivateIpv4(mapped) ||
      isPrivateIpv6;

    return (
      url.protocol === "https:" &&
      !isLocal &&
      isRemoteDnsHostname(hostname)
    );
  } catch {
    return false;
  }
}

function isRootRemoteHttpsOrigin(value: string) {
  if (!isRemoteHttpsUrl(value)) return false;
  const url = new URL(value);
  return url.pathname === "/" && !url.search && !url.hash;
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
    NEXT_PUBLIC_CREATORX_TOSS_LOGIN_ENABLED: z.enum(["0", "1"]).default("0"),
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
      !isRootRemoteHttpsOrigin(value.NEXT_PUBLIC_CREATORX_API_BASE_URL)
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
    if (value.NEXT_PUBLIC_CREATORX_OPERATOR_NAME === sandboxOperatorName) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_CREATORX_OPERATOR_NAME"],
        message: "production requires a verified operator name",
      });
    }
    if (
      value.NEXT_PUBLIC_CREATORX_SUPPORT_URL &&
      isSandboxSupportPlaceholder(value.NEXT_PUBLIC_CREATORX_SUPPORT_URL)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_CREATORX_SUPPORT_URL"],
        message: "production requires a verified support URL",
      });
    }
    if (
      value.NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT?.toLowerCase() ===
      sandboxPrivacyContact.toLowerCase()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT"],
        message: "production requires a verified privacy contact",
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
  tossLoginEnabled: boolean;
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
    tossLoginEnabled: value.NEXT_PUBLIC_CREATORX_TOSS_LOGIN_ENABLED === "1",
    apiBaseUrl: value.NEXT_PUBLIC_CREATORX_API_BASE_URL
      ? new URL(value.NEXT_PUBLIC_CREATORX_API_BASE_URL)
      : null,
    allowBrowserStorageFallback:
      value.NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL !== "production",
    brandIconUrl: value.NEXT_PUBLIC_CREATORX_ICON_URL ?? null,
    legal: {
      operatorName:
        value.NEXT_PUBLIC_CREATORX_OPERATOR_NAME ?? sandboxOperatorName,
      supportUrl:
        value.NEXT_PUBLIC_CREATORX_SUPPORT_URL ?? sandboxSupportUrl,
      privacyContact:
        value.NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT ?? sandboxPrivacyContact,
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
    NEXT_PUBLIC_CREATORX_TOSS_LOGIN_ENABLED:
      process.env.NEXT_PUBLIC_CREATORX_TOSS_LOGIN_ENABLED,
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
