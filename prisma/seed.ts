import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();
const fixedTime = new Date("2026-01-01T00:00:00.000Z");

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "seed-user@creatorx.local" },
    update: {
      name: "CreatorX Seed User",
      initialBudget: "100000.0000",
      balance: "100000.0000",
      reservedBalance: "0.0000",
      isBot: false,
      createdAt: fixedTime,
      updatedAt: fixedTime,
    },
    create: {
      id: "creatorx-seed-user",
      email: "seed-user@creatorx.local",
      name: "CreatorX Seed User",
      initialBudget: "100000.0000",
      balance: "100000.0000",
      reservedBalance: "0.0000",
      isBot: false,
      createdAt: fixedTime,
      updatedAt: fixedTime,
    },
  });

  const creator = await prisma.creator.upsert({
    where: { youtubeChannelId: "creatorx-seed-channel" },
    update: {
      name: "CreatorX Seed Creator",
      category: "Seed",
      country: "KR",
      currentSubs: 100_000,
      currentViews: 1_000_000,
      currentVideos: 100,
      currentScore: 1,
      currentPrice: "100.0000",
      initialPrice: "100.0000",
      liquidity: "10000.0000",
      isActive: true,
      visibility: "PUBLIC",
      lastSyncedAt: fixedTime,
      createdAt: fixedTime,
      updatedAt: fixedTime,
    },
    create: {
      id: "creatorx-seed-creator",
      youtubeChannelId: "creatorx-seed-channel",
      name: "CreatorX Seed Creator",
      category: "Seed",
      country: "KR",
      currentSubs: 100_000,
      currentViews: 1_000_000,
      currentVideos: 100,
      currentScore: 1,
      currentPrice: "100.0000",
      initialPrice: "100.0000",
      liquidity: "10000.0000",
      isActive: true,
      visibility: "PUBLIC",
      lastSyncedAt: fixedTime,
      createdAt: fixedTime,
      updatedAt: fixedTime,
    },
  });

  await prisma.authIdentity.upsert({
    where: {
      provider_subject: {
        provider: "GUEST",
        subject: "creatorx-deterministic-seed-subject",
      },
    },
    update: { userId: user.id, updatedAt: fixedTime },
    create: {
      id: "creatorx-seed-identity",
      provider: "GUEST",
      subject: "creatorx-deterministic-seed-subject",
      userId: user.id,
      createdAt: fixedTime,
      updatedAt: fixedTime,
    },
  });

  await prisma.position.upsert({
    where: {
      userId_creatorId: { userId: user.id, creatorId: creator.id },
    },
    update: {
      quantity: "10.00000000",
      reservedQuantity: "0.00000000",
      avgPrice: "100.0000",
      createdAt: fixedTime,
      updatedAt: fixedTime,
    },
    create: {
      id: "creatorx-seed-position",
      userId: user.id,
      creatorId: creator.id,
      quantity: "10.00000000",
      reservedQuantity: "0.00000000",
      avgPrice: "100.0000",
      createdAt: fixedTime,
      updatedAt: fixedTime,
    },
  });

  console.log("CreatorX deterministic seed is ready.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
