import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const npmCliPath = process.env.npm_execpath;

function runDbMigrate(databaseUrl: string, directUrl: string) {
  if (!npmCliPath) {
    throw new Error("npm_execpath is required to exercise the db:migrate script.");
  }

  return spawnSync(process.execPath, [npmCliPath, "run", "db:migrate"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DIRECT_URL: directUrl,
    },
    windowsHide: true,
  });
}

it("refuses a non-test database before Prisma runs", () => {
  const unsafeUrl =
    "postgresql://creatorx:creatorx_local_only@127.0.0.1:1/creatorx?schema=public";
  const result = runDbMigrate(unsafeUrl, unsafeUrl);
  const output = `${result.stdout}${result.stderr}`;

  expect(result.status).not.toBe(0);
  expect(output).toContain(
    'Refusing to run database command: DATABASE_URL targets database "creatorx", which does not end in "_test".',
  );
  expect(output).not.toContain("Prisma schema loaded");
});

it("refuses a non-PostgreSQL URL before Prisma runs", () => {
  const invalidProtocolUrl = "http://127.0.0.1:1/creatorx_test";
  const result = runDbMigrate(invalidProtocolUrl, invalidProtocolUrl);
  const output = `${result.stdout}${result.stderr}`;

  expect(result.status).not.toBe(0);
  expect(output).toContain("DATABASE_URL must be a valid PostgreSQL URL.");
  expect(output).not.toContain("Prisma schema loaded");
});

it("deploys migrations to a valid test database", () => {
  const databaseUrl = process.env.DATABASE_URL;
  const directUrl = process.env.DIRECT_URL;

  expect(databaseUrl).toBeTruthy();
  expect(directUrl).toBeTruthy();

  const result = runDbMigrate(databaseUrl!, directUrl!);
  const output = `${result.stdout}${result.stderr}`;

  expect(result.status).toBe(0);
  expect(output).toContain('PostgreSQL database "creatorx_test"');
  expect(output).toContain("No pending migrations to apply.");
});
