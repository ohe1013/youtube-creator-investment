import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  resolveAppInTossBuildEnvironment,
} from "../../scripts/appintoss-build-options.mjs";
import {
  validateProductionEnvironment,
} from "../../scripts/production-preflight.mjs";
import { scanClientSecrets } from "../../scripts/scan-client-secrets.mjs";

const validProductionEnvironment = {
  NODE_ENV: "production",
  VERCEL: "1",
  DATABASE_URL:
    "postgresql://runtime:password@db.creatorx.example:6543/postgres?pgbouncer=true",
  DIRECT_URL: "postgresql://migration:password@db.creatorx.example:5432/postgres",
  CREATORX_ACCESS_TOKEN_SECRET: "a".repeat(64),
  CREATORX_IDENTITY_PEPPER: "p".repeat(32),
  CRON_SECRET: "c".repeat(48),
  TOSS_LOGIN_ENABLED: "0",
  NEXT_PUBLIC_APP_IN_TOSS: "1",
  NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL: "production",
  NEXT_PUBLIC_CREATORX_DATA_MODE: "remote",
  NEXT_PUBLIC_CREATORX_TOSS_LOGIN_ENABLED: "0",
  NEXT_PUBLIC_CREATORX_API_BASE_URL: "https://api.creatorx.example",
  NEXT_PUBLIC_CREATORX_OPERATOR_NAME: "CreatorX Operations Inc.",
  NEXT_PUBLIC_CREATORX_SUPPORT_URL: "https://support.creatorx.example",
  NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT: "privacy@creatorx.example",
  NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE: "2026-07-13",
  NEXT_PUBLIC_CREATORX_ICON_URL: "https://assets.creatorx.example/icon.png",
};

const requiredProductionVariables = [
  "DATABASE_URL",
  "DIRECT_URL",
  "CREATORX_ACCESS_TOKEN_SECRET",
  "CREATORX_IDENTITY_PEPPER",
  "CRON_SECRET",
  "NEXT_PUBLIC_CREATORX_API_BASE_URL",
  "NEXT_PUBLIC_CREATORX_OPERATOR_NAME",
  "NEXT_PUBLIC_CREATORX_SUPPORT_URL",
  "NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT",
  "NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE",
  "NEXT_PUBLIC_CREATORX_ICON_URL",
] as const;

const temporaryRoots: string[] = [];

async function createOutputFixture(content: string) {
  const root = await mkdtemp(join(tmpdir(), "creatorx-client-secret-scan-"));
  temporaryRoots.push(root);
  const webDir = join(root, "out", "web");
  await mkdir(webDir, { recursive: true });
  await writeFile(join(webDir, "runtime.js"), content, "utf8");
  return join(root, "out");
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("production preflight", () => {
  it("accepts a complete production environment without returning secrets", () => {
    expect(validateProductionEnvironment(validProductionEnvironment)).toEqual({
      releaseChannel: "production",
      tossLoginEnabled: false,
    });
  });

  it.each(requiredProductionVariables)(
    "fails closed when %s is missing",
    (key) => {
      expect(() =>
        validateProductionEnvironment({
          ...validProductionEnvironment,
          [key]: undefined,
        }),
      ).toThrow(`Missing production variable: ${key}`);
    },
  );

  it("rejects a non-HTTPS API origin before a production build", () => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        NEXT_PUBLIC_CREATORX_API_BASE_URL: "http://api.creatorx.example",
      }),
    ).toThrow("remote HTTPS URL");
  });

  it.each([
    "https://localhost",
    "https://127.0.0.1",
    "https://10.0.0.2",
    "https://172.16.0.2",
    "https://192.168.0.2",
    "https://[::1]",
    "https://[::ffff:7f00:1]",
    "https://creatorx-local",
  ])("rejects a private or loopback HTTPS API origin: %s", (apiBaseUrl) => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        NEXT_PUBLIC_CREATORX_API_BASE_URL: apiBaseUrl,
      }),
    ).toThrow("remote HTTPS URL");
  });

  it("requires the pooled runtime and direct migration database URLs to remain separate", () => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        DATABASE_URL:
          "postgresql://runtime:password@direct.creatorx.example:5432/postgres",
      }),
    ).toThrow("DATABASE_URL must be a pooled PostgreSQL URL");

    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        DIRECT_URL:
          "postgresql://migration:password@direct.creatorx.example:6543/postgres?pgbouncer=true",
      }),
    ).toThrow("DIRECT_URL must be a direct PostgreSQL URL");

    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        DIRECT_URL: validProductionEnvironment.DATABASE_URL,
      }),
    ).toThrow("DATABASE_URL and DIRECT_URL must not be the same URL");
  });

  it("rejects direct migration URLs that reuse the pooled database endpoint", () => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        DIRECT_URL:
          "postgres://migration:other-password@DB.CREATORX.EXAMPLE.:6543/postgres?sslmode=require",
      }),
    ).toThrow("DATABASE_URL and DIRECT_URL must use different PostgreSQL endpoints");
  });

  it("requires an actual calendar date for the legal effective date", () => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE: "2026-02-29",
      }),
    ).toThrow("NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE must be an ISO date");
  });

  it.each([
    [
      "NEXT_PUBLIC_CREATORX_OPERATOR_NAME",
      "CreatorX \uAC1C\uBC1C\uD300",
      "verified operator name",
    ],
    [
      "NEXT_PUBLIC_CREATORX_SUPPORT_URL",
      "https://github.com/ohe1013/youtube-creator-investment/issues",
      "verified support URL",
    ],
    [
      "NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT",
      "GitHub Issues",
      "verified privacy contact",
    ],
    [
      "NEXT_PUBLIC_CREATORX_ICON_URL",
      "https://static.toss.im/icons/png/4x/icon-toss-logo.png",
      "CreatorX-owned",
    ],
  ] as const)(
    "rejects the sandbox or Toss placeholder in %s",
    (key, value, message) => {
      expect(() =>
        validateProductionEnvironment({
          ...validProductionEnvironment,
          [key]: value,
        }),
      ).toThrow(message);
    },
  );

  it("requires an access-token signing secret of at least 32 characters", () => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        CREATORX_ACCESS_TOKEN_SECRET: "a".repeat(31),
      }),
    ).toThrow("CREATORX_ACCESS_TOKEN_SECRET must be at least 32 characters");
  });

  it("requires the existing public and server Toss Login flags to agree", () => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        TOSS_LOGIN_ENABLED: "1",
        NEXT_PUBLIC_CREATORX_TOSS_LOGIN_ENABLED: "0",
      }),
    ).toThrow("Toss Login flags must agree");
  });

  it("requires a valid mTLS certificate and private key pair when Toss Login is enabled", () => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        TOSS_LOGIN_ENABLED: "1",
        NEXT_PUBLIC_CREATORX_TOSS_LOGIN_ENABLED: "1",
        TOSS_MTLS_CERT_BASE64: Buffer.from(
          "-----BEGIN CERTIFICATE-----\ncertificate\n-----END CERTIFICATE-----",
        ).toString("base64"),
      }),
    ).toThrow("TOSS_MTLS_KEY_BASE64");

    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        TOSS_LOGIN_ENABLED: "1",
        NEXT_PUBLIC_CREATORX_TOSS_LOGIN_ENABLED: "1",
        TOSS_MTLS_CERT_BASE64: "not base64!",
        TOSS_MTLS_KEY_BASE64: Buffer.from(
          "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----",
        ).toString("base64"),
      }),
    ).toThrow("TOSS_MTLS_CERT_BASE64");
  });

  it("accepts a matching base64 PEM pair when both existing Toss Login flags are enabled", () => {
    expect(
      validateProductionEnvironment({
        ...validProductionEnvironment,
        TOSS_LOGIN_ENABLED: "1",
        NEXT_PUBLIC_CREATORX_TOSS_LOGIN_ENABLED: "1",
        TOSS_MTLS_CERT_BASE64: Buffer.from(
          "-----BEGIN CERTIFICATE-----\ncertificate\n-----END CERTIFICATE-----",
        ).toString("base64"),
        TOSS_MTLS_KEY_BASE64: Buffer.from(
          "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----",
        ).toString("base64"),
      }),
    ).toEqual({ releaseChannel: "production", tossLoginEnabled: true });
  });
});

describe("production App-in-Toss build options", () => {
  it("forces production channel and remote data mode only for the explicit production argument", () => {
    expect(
      resolveAppInTossBuildEnvironment({
        argv: ["--release-channel", "production"],
        env: {
          ...validProductionEnvironment,
          NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL: "sandbox",
          NEXT_PUBLIC_CREATORX_DATA_MODE: "demo",
        },
      }),
    ).toMatchObject({
      APP_IN_TOSS: "1",
      NEXT_PUBLIC_APP_IN_TOSS: "1",
      NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL: "production",
      NEXT_PUBLIC_CREATORX_DATA_MODE: "remote",
    });
  });

  it("rejects unknown or conflicting build-channel arguments", () => {
    expect(() =>
      resolveAppInTossBuildEnvironment({
        argv: ["--release-channel", "production", "--unexpected"],
        env: validProductionEnvironment,
      }),
    ).toThrow("Unsupported App-in-Toss build argument");
  });
});

describe("client secret scan", () => {
  it("allows intended public HTTPS configuration in exported output", async () => {
    const outDir = await createOutputFixture(
      'const config = { NEXT_PUBLIC_CREATORX_API_BASE_URL: "https://api.creatorx.example" };',
    );

    await expect(scanClientSecrets({ outDir })).resolves.toEqual({
      filesScanned: 1,
    });
  });

  it("does not treat a framework identifier containing token as a secret property", async () => {
    const outDir = await createOutputFixture(
      "const config = { BaseDerivedTokenGenerator: factory.create() };",
    );

    await expect(scanClientSecrets({ outDir })).resolves.toEqual({
      filesScanned: 1,
    });
  });

  it.each([
    ["PEM private key", "-----BEGIN PRIVATE KEY-----\\nprivate\\n-----END PRIVATE KEY-----"],
    ["database URL", "postgresql://app:password@db.creatorx.example/creatorx"],
    ["access token", 'const session = { accessToken: "token-secret-0123456789" };'],
    [
      "public API key",
      `const config = { NEXT_PUBLIC_ANALYTICS_API_KEY: "AIza${"A".repeat(35)}" };`,
    ],
  ])("rejects a %s without echoing its value", async (_label, content) => {
    const outDir = await createOutputFixture(content);
    const failure = await scanClientSecrets({ outDir }).catch((error) => error);

    expect(failure).toMatchObject({ code: "CLIENT_SECRET_DETECTED" });
    expect(String(failure.message)).toContain("web/runtime.js");
    expect(String(failure.message)).not.toContain(content);
  });
});
