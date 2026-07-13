import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";
import { assertTestDatabaseUrls } from "../../../scripts/test-database-safety.mjs";

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(import.meta.url);

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

  assertTestDatabaseUrls(process.env);

  execFileSync(process.execPath, [require.resolve("prisma"), "migrate", "deploy"], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });

  await seedDeterministicFixtures();
}
