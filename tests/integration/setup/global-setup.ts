import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(import.meta.url);

function testDatabaseName(variableName: "DATABASE_URL" | "DIRECT_URL") {
  const value = process.env[variableName];

  if (!value) {
    throw new Error(
      `${variableName} must be set in .env.test.local before integration tests run.`,
    );
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(new URL(value).pathname.replace(/^\//, ""));
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }

  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to run integration setup: ${variableName} targets database "${databaseName}", which does not end in "_test".`,
    );
  }

  return databaseName;
}

async function seedDeterministicFixtures() {
  const prisma = new PrismaClient();
  const fixedTime = new Date("2026-01-01T00:00:00.000Z");

  try {
    await prisma.$transaction([
      prisma.user.upsert({
        where: { email: "integration-user@creatorx.test" },
        update: {
          name: "CreatorX Integration User",
          initialBudget: 100_000,
          balance: 100_000,
          isBot: false,
          createdAt: fixedTime,
          updatedAt: fixedTime,
        },
        create: {
          id: "creatorx-integration-user",
          email: "integration-user@creatorx.test",
          name: "CreatorX Integration User",
          initialBudget: 100_000,
          balance: 100_000,
          isBot: false,
          createdAt: fixedTime,
          updatedAt: fixedTime,
        },
      }),
      prisma.creator.upsert({
        where: { youtubeChannelId: "creatorx-integration-channel" },
        update: {
          name: "CreatorX Integration Creator",
          category: "Integration",
          country: "KR",
          currentSubs: 1_000,
          currentViews: 10_000,
          currentVideos: 10,
          currentScore: 1,
          currentPrice: 100,
          initialPrice: 100,
          isActive: true,
          lastSyncedAt: fixedTime,
          createdAt: fixedTime,
          updatedAt: fixedTime,
        },
        create: {
          id: "creatorx-integration-creator",
          youtubeChannelId: "creatorx-integration-channel",
          name: "CreatorX Integration Creator",
          category: "Integration",
          country: "KR",
          currentSubs: 1_000,
          currentViews: 10_000,
          currentVideos: 10,
          currentScore: 1,
          currentPrice: 100,
          initialPrice: 100,
          isActive: true,
          lastSyncedAt: fixedTime,
          createdAt: fixedTime,
          updatedAt: fixedTime,
        },
      }),
    ]);
  } finally {
    await prisma.$disconnect();
  }
}

export default async function globalSetup() {
  loadEnv({
    path: fileURLToPath(new URL("../../../.env.test.local", import.meta.url)),
    quiet: true,
  });

  const databaseName = testDatabaseName("DATABASE_URL");
  const directDatabaseName = testDatabaseName("DIRECT_URL");

  if (databaseName !== directDatabaseName) {
    throw new Error(
      "Refusing to run integration setup: DATABASE_URL and DIRECT_URL target different test databases.",
    );
  }

  execFileSync(process.execPath, [require.resolve("prisma"), "migrate", "deploy"], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });

  await seedDeterministicFixtures();
}
