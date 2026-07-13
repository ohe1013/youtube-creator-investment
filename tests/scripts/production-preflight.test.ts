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

const SUPABASE_PROJECT_REF = "creatorxprojectref";
const OTHER_SUPABASE_PROJECT_REF = "othercreatorxprojectref";
const SUPABASE_POOLER_HOST = "aws-0-ap-northeast-2.pooler.supabase.com";
const SUPABASE_DIRECT_HOST = `db.${SUPABASE_PROJECT_REF}.supabase.co`;
const SUPABASE_SHARED_RUNTIME_URL =
  `postgresql://postgres.${SUPABASE_PROJECT_REF}:password@${SUPABASE_POOLER_HOST}:6543/postgres?pgbouncer=true`;
const SUPABASE_DIRECT_URL =
  `postgresql://postgres:password@${SUPABASE_DIRECT_HOST}:5432/postgres?sslmode=require`;

const validProductionEnvironment = {
  NODE_ENV: "production",
  VERCEL: "1",
  DATABASE_URL: SUPABASE_SHARED_RUNTIME_URL,
  DIRECT_URL: SUPABASE_DIRECT_URL,
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

async function createOutputFixture(
  content: string | Uint8Array,
  fileName = "runtime.js",
) {
  const root = await mkdtemp(join(tmpdir(), "creatorx-client-secret-scan-"));
  temporaryRoots.push(root);
  const webDir = join(root, "out", "web");
  await mkdir(webDir, { recursive: true });
  await writeFile(join(webDir, fileName), content);
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

  it.each(
    ([
      "NEXT_PUBLIC_CREATORX_API_BASE_URL",
      "NEXT_PUBLIC_CREATORX_SUPPORT_URL",
      "NEXT_PUBLIC_CREATORX_ICON_URL",
    ] as const).flatMap((key) =>
      [
        "https://192.0.2.1",
        "https://198.18.0.1",
        "https://224.0.0.1",
        "https://240.0.0.1",
        "https://[2001:db8::1]",
        "https://[64:ff9b::7f00:1]",
        "https://[::ffff:192.0.2.1]",
      ].map((value) => [key, value] as const),
    ),
  )("rejects a non-DNS public URL in %s: %s", (key, value) => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        [key]: value,
      }),
    ).toThrow(`${key} must be a remote HTTPS URL`);
  });

  it.each(["https://[fec0::1]", "https://[ff02::1]"])(
    "rejects a non-global IPv6 HTTPS API origin without echoing it: %s",
    (apiBaseUrl) => {
      let error: Error | null = null;
      try {
        validateProductionEnvironment({
          ...validProductionEnvironment,
          NEXT_PUBLIC_CREATORX_API_BASE_URL: apiBaseUrl,
        });
      } catch (failure) {
        if (failure instanceof Error) error = failure;
      }

      expect(error).toMatchObject({ name: "ProductionPreflightError" });
      expect(String(error?.message)).toBe(
        "NEXT_PUBLIC_CREATORX_API_BASE_URL must be a remote HTTPS URL",
      );
      expect(String(error?.message)).not.toContain(apiBaseUrl);
    },
  );

  it.each(["6543", "5432"])(
    "accepts a shared Supavisor runtime on port %s for the direct project",
    (runtimePort) => {
      expect(
        validateProductionEnvironment({
          ...validProductionEnvironment,
          DATABASE_URL:
            `postgresql://postgres%2E${SUPABASE_PROJECT_REF}:password@${SUPABASE_POOLER_HOST}:${runtimePort}/postgres?pgbouncer=true`,
        }),
      ).toEqual({ releaseChannel: "production", tossLoginEnabled: false });
    },
  );

  it("accepts the documented regional Supavisor hostname", () => {
    expect(validateProductionEnvironment(validProductionEnvironment)).toEqual({
      releaseChannel: "production",
      tossLoginEnabled: false,
    });
  });

  it("rejects a pooler hostname that is not an AWS regional Supavisor endpoint", () => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        DATABASE_URL:
          `postgresql://postgres.${SUPABASE_PROJECT_REF}:password@not-a-region.pooler.supabase.com:6543/postgres?pgbouncer=true`,
      }),
    ).toThrow("DATABASE_URL must use a supported Supabase runtime PostgreSQL URL");
  });

  it("accepts a dedicated Supabase runtime on port 6543 for the direct project", () => {
    expect(
      validateProductionEnvironment({
        ...validProductionEnvironment,
        DATABASE_URL:
          `postgresql://postgres:password@${SUPABASE_DIRECT_HOST}:6543/postgres?pgbouncer=true`,
      }),
    ).toEqual({ releaseChannel: "production", tossLoginEnabled: false });
  });

  it("rejects the direct Supabase endpoint as DATABASE_URL even with pgbouncer compatibility", () => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        DATABASE_URL:
          `postgresql://postgres:password@${SUPABASE_DIRECT_HOST}:5432/postgres?pgbouncer=true`,
      }),
    ).toThrow("DATABASE_URL must use a supported Supabase runtime PostgreSQL URL");
  });

  it("rejects a Supavisor endpoint as DIRECT_URL", () => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        DIRECT_URL:
          `postgresql://postgres.${SUPABASE_PROJECT_REF}:password@${SUPABASE_POOLER_HOST}:5432/postgres?sslmode=require`,
      }),
    ).toThrow("DIRECT_URL must use a Supabase direct PostgreSQL URL");
  });

  it("rejects a runtime URL for another Supabase project", () => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        DATABASE_URL:
          `postgresql://postgres:password@db.${OTHER_SUPABASE_PROJECT_REF}.supabase.co:6543/postgres?pgbouncer=true`,
      }),
    ).toThrow("DATABASE_URL must target the same Supabase project as DIRECT_URL");
  });

  it.each([
    [
      "no username",
      `postgresql://${SUPABASE_POOLER_HOST}:6543/postgres?pgbouncer=true`,
    ],
    [
      "a different project reference in the username",
      `postgresql://postgres.${OTHER_SUPABASE_PROJECT_REF}:password@${SUPABASE_POOLER_HOST}:6543/postgres?pgbouncer=true`,
    ],
  ])("rejects a shared Supavisor runtime with %s", (_label, databaseUrl) => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        DATABASE_URL: databaseUrl,
      }),
    ).toThrow(
      "DATABASE_URL must use a Supabase pooler username for the DIRECT_URL project",
    );
  });

  it("fails closed for malformed percent escapes in a shared pooler username", () => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        DATABASE_URL:
          `postgresql://postgres%ZZ${SUPABASE_PROJECT_REF}:password@${SUPABASE_POOLER_HOST}:6543/postgres?pgbouncer=true`,
      }),
    ).toThrow("DATABASE_URL must be a PostgreSQL URL");
  });

  it.each([
    [
      "a generic runtime provider URL",
      "DATABASE_URL",
      "postgresql://runtime:password@runtime.creatorx.example:6543/postgres?pgbouncer=true",
      "DATABASE_URL must use a supported Supabase runtime PostgreSQL URL",
    ],
    [
      "a generic direct provider URL",
      "DIRECT_URL",
      "postgresql://migration:password@direct.creatorx.example:5432/postgres?sslmode=require",
      "DIRECT_URL must use a Supabase direct PostgreSQL URL",
    ],
  ])("rejects %s", (_label, key, value, message) => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        [key]: value,
      }),
    ).toThrow(message);
  });

  it("keeps pgbouncer=true as a Prisma runtime compatibility requirement", () => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        DATABASE_URL:
          `postgresql://postgres.${SUPABASE_PROJECT_REF}:password@${SUPABASE_POOLER_HOST}:6543/postgres`,
      }),
    ).toThrow("DATABASE_URL must be a pooled PostgreSQL URL");

    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        DIRECT_URL:
          `postgresql://postgres:password@${SUPABASE_DIRECT_HOST}:5432/postgres?pgbouncer=true`,
      }),
    ).toThrow("DIRECT_URL must be a direct PostgreSQL URL");

    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        DIRECT_URL: validProductionEnvironment.DATABASE_URL,
      }),
    ).toThrow("DATABASE_URL and DIRECT_URL must not be the same URL");
  });

  it.each(["false", "FALSE"]) (
    "rejects a direct URL with pgbouncer=%s",
    (pgbouncer) => {
      expect(() =>
        validateProductionEnvironment({
          ...validProductionEnvironment,
          DIRECT_URL:
            `postgresql://postgres:password@${SUPABASE_DIRECT_HOST}:5432/postgres?sslmode=require&pgbouncer=${pgbouncer}`,
        }),
      ).toThrow("DIRECT_URL must be a direct PostgreSQL URL");
    },
  );

  it("rejects a direct URL on another endpoint when its decoded database name differs", () => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        DIRECT_URL:
          `postgresql://postgres:password@${SUPABASE_DIRECT_HOST}:5432/other-db?sslmode=require`,
      }),
    ).toThrow("DATABASE_URL and DIRECT_URL must use the same PostgreSQL database");
  });

  it("accepts one-decoded equivalent database names on distinct pooled and direct endpoints", () => {
    expect(
      validateProductionEnvironment({
        ...validProductionEnvironment,
        DATABASE_URL:
          `postgresql://postgres.${SUPABASE_PROJECT_REF}:password@${SUPABASE_POOLER_HOST}:6543/%70ostgres?pgbouncer=true`,
      }),
    ).toEqual({ releaseChannel: "production", tossLoginEnabled: false });
  });

  it.each([
    [
      "a hostless DATABASE_URL",
      "DATABASE_URL",
      "postgresql:///postgres?pgbouncer=true",
    ],
    [
      "a localhost DIRECT_URL",
      "DIRECT_URL",
      "postgresql://migration:password@localhost:5432/postgres?sslmode=require",
    ],
    [
      "a loopback DATABASE_URL",
      "DATABASE_URL",
      "postgresql://runtime:password@127.0.0.1:6543/postgres?pgbouncer=true",
    ],
    [
      "a private-network DIRECT_URL",
      "DIRECT_URL",
      "postgresql://migration:password@10.0.0.2:5432/postgres?sslmode=require",
    ],
    [
      "an IPv6 loopback DATABASE_URL",
      "DATABASE_URL",
      "postgresql://runtime:password@[::1]:6543/postgres?pgbouncer=true",
    ],
    [
      "an abbreviated IPv4 loopback DATABASE_URL",
      "DATABASE_URL",
      "postgresql://runtime:password@127.1:6543/postgres?pgbouncer=true",
    ],
    [
      "an octal IPv4 loopback DIRECT_URL",
      "DIRECT_URL",
      "postgresql://migration:password@0177.0.0.1:5432/postgres?sslmode=require",
    ],
    [
      "a literal multi-host DIRECT_URL",
      "DIRECT_URL",
      "postgresql://migration:password@direct.creatorx.example,db.creatorx.example:6543/postgres?sslmode=require",
    ],
    [
      "an encoded multi-host DATABASE_URL",
      "DATABASE_URL",
      "postgresql://runtime:password@db.creatorx.example%2Cdirect.creatorx.example:6543/postgres?pgbouncer=true",
    ],
  ])("rejects %s without exposing connection material", (_label, key, value) => {
    let error: Error | null = null;
    try {
      validateProductionEnvironment({
        ...validProductionEnvironment,
        [key]: value,
      });
    } catch (failure) {
      if (failure instanceof Error) error = failure;
    }

    expect(error).toMatchObject({ name: "ProductionPreflightError" });
    expect(String(error?.message)).toBe(`${key} must be a remote PostgreSQL URL`);
    expect(String(error?.message)).not.toContain("password");
  });

  it("rejects a generic remote numeric runtime host outside the Supabase topology", () => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        DATABASE_URL:
          "postgresql://runtime:password@8.8.8.8:6543/postgres?pgbouncer=true",
      }),
    ).toThrow("DATABASE_URL must use a supported Supabase runtime PostgreSQL URL");
  });

  it.each([
    [
      "host",
      "postgresql://migration:password@direct.creatorx.example:6543/postgres?host=db.creatorx.example",
    ],
    [
      "port",
      "postgresql://migration:password@db.creatorx.example:5432/postgres?port=6543",
    ],
    [
      "dbname",
      "postgresql://migration:password@db.creatorx.example:6543/not-postgres?dbname=postgres",
    ],
  ])(
    "rejects DIRECT_URL query endpoint override %s before role comparison",
    (_parameter, directUrl) => {
      expect(() =>
        validateProductionEnvironment({
          ...validProductionEnvironment,
          DIRECT_URL: directUrl,
        }),
      ).toThrow("DIRECT_URL must not override PostgreSQL endpoint via query parameters");
    },
  );

  it.each([
    [
      "DATABASE_URL",
      "postgresql://runtime:password@db.creatorx.example:6543/postgres?pgbouncer=true&hostaddr=203.0.113.10",
    ],
    [
      "DIRECT_URL",
      "postgresql://migration:password@direct.creatorx.example:5432/postgres?hostaddr=203.0.113.10",
    ],
  ])("rejects a %s hostaddr query override", (key, value) => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        [key]: value,
      }),
    ).toThrow(`${key} must not override PostgreSQL endpoint via query parameters`);
  });

  it.each([
    [
      "DATABASE_URL",
      "postgresql://runtime:password@db.creatorx.example:6543/postgres?pgbouncer=true&service=pool",
    ],
    [
      "DIRECT_URL",
      "postgresql://migration:password@direct.creatorx.example:5432/postgres?sslmode=require&service=migration",
    ],
  ])("rejects a %s service query override", (key, value) => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        [key]: value,
      }),
    ).toThrow(`${key} must not override PostgreSQL endpoint via query parameters`);
  });

  it.each([
    [
      "DATABASE_URL",
      "postgresql://runtime:password@db.creatorx.example:6543/%ZZ?pgbouncer=true",
    ],
    [
      "DIRECT_URL",
      "postgresql://migration:password@direct.creatorx.example:5432/%ZZ?sslmode=require",
    ],
  ])("fails closed for a malformed percent escape in %s database pathname", (key, value) => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        [key]: value,
      }),
    ).toThrow(`${key} must be a PostgreSQL URL`);
  });

  it.each([
    [
      "a literal dot segment",
      "DATABASE_URL",
      "postgresql://runtime:password@db.creatorx.example:6543/foo/../postgres?pgbouncer=true",
    ],
    [
      "an encoded dot segment",
      "DIRECT_URL",
      "postgresql://migration:password@direct.creatorx.example:5432/%2e%2e/postgres?sslmode=require",
    ],
    [
      "an encoded leading slash",
      "DATABASE_URL",
      "postgresql://runtime:password@db.creatorx.example:6543/%2Fpostgres?pgbouncer=true",
    ],
    [
      "an encoded embedded slash",
      "DIRECT_URL",
      "postgresql://migration:password@direct.creatorx.example:5432/post%2Fgres?sslmode=require",
    ],
  ])("rejects %s in a %s database pathname", (_label, key, value) => {
    expect(() =>
      validateProductionEnvironment({
        ...validProductionEnvironment,
        [key]: value,
      }),
    ).toThrow(`${key} must use a single PostgreSQL database path segment`);
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
      "NEXT_PUBLIC_CREATORX_SUPPORT_URL",
      "https://github.com/ohe1013/youtube-creator-investment/%69ssues",
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
  it("forces sandbox demo values for a no-argument build despite inherited production values", () => {
    expect(
      resolveAppInTossBuildEnvironment({
        env: validProductionEnvironment,
      }),
    ).toMatchObject({
      APP_IN_TOSS: "1",
      NEXT_PUBLIC_APP_IN_TOSS: "1",
      NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL: "sandbox",
      NEXT_PUBLIC_CREATORX_DATA_MODE: "demo",
    });
  });

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

  it("runs production preflight for an explicit production build", () => {
    expect(() =>
      resolveAppInTossBuildEnvironment({
        argv: ["--release-channel", "production"],
        env: {},
      }),
    ).toThrow("Missing production variable: DATABASE_URL");
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

  it("rejects a NUL-delimited database URL in opaque binary output without echoing it", async () => {
    const secret =
      "postgresql://creator:committed-password@db.creatorx.example/creatorx";
    const outDir = await createOutputFixture(
      new TextEncoder().encode(`\0${secret}\0`),
      "opaque.bin",
    );
    const failure = await scanClientSecrets({ outDir }).catch((error) => error);

    expect(failure).toMatchObject({ code: "CLIENT_SECRET_DETECTED" });
    expect(String(failure.message)).toContain("web/opaque.bin");
    expect(String(failure.message)).not.toContain(secret);
  });

  it("allows an opaque binary file without a concrete secret", async () => {
    const outDir = await createOutputFixture(
      new Uint8Array([0, 255, 1, 2, 3, 4, 5]),
      "safe-opaque.bin",
    );

    await expect(scanClientSecrets({ outDir })).resolves.toEqual({
      filesScanned: 1,
    });
  });
});
