import { prisma } from "../lib/prisma";
import { spawnBots, executeBotTrade } from "../lib/bot-manager";

async function main() {
  console.log("--- Bot Verification Script ---");

  // 1. Check for existing bots
  const existingBots = await prisma.user.findMany({
    where: { isBot: true },
  });

  if (existingBots.length < 10) {
    const toSpawn = 10 - existingBots.length;
    console.log(`Spawning ${toSpawn} bots...`);
    await spawnBots(toSpawn);
  } else {
    console.log("10 or more bots already exist.");
  }

  const finalBots = await prisma.user.findMany({
    where: { isBot: true },
  });
  console.log(`Current bot count: ${finalBots.length}`);

  // 2. Simulate activity
  const TRADE_COUNT = 200;
  console.log(`\nSimulating bot activity (${TRADE_COUNT} random trades)...`);

  for (let i = 0; i < TRADE_COUNT; i++) {
    if (i % 10 === 0) {
      console.log(`Progress: ${i}/${TRADE_COUNT}`);
    }
    await executeBotTrade();
    // Small delay to prevent potential lock contention on high volume
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // 3. Verify results
  console.log("\n--- Verification Results ---");

  const totalExecutions = await prisma.tradeExecution.count();
  const botExecutions = await prisma.tradeExecution.count({
    where: {
      OR: [{ buyer: { isBot: true } }, { seller: { isBot: true } }],
    },
  });

  const creatorsWithPriceChange = await prisma.creator.findMany({
    where: {
      currentPrice: { not: 100 }, // Assuming 100 is the common initialPrice, but checking diff is better
    },
    select: { name: true, currentPrice: true, initialPrice: true },
  });

  console.log(`Total trade executions in system: ${totalExecutions}`);
  console.log(`Trade executions involving bots: ${botExecutions}`);

  if (creatorsWithPriceChange.length > 0) {
    console.log("\nCreators with price movements:");
    creatorsWithPriceChange.forEach((c) => {
      console.log(
        `- ${c.name}: ${c.initialPrice} -> ${c.currentPrice.toFixed(2)}`
      );
    });
  } else {
    console.log(
      "\nNo price movements detected (wait for cooldowns or check trade logic)."
    );
  }

  const botPositions = await prisma.position.findMany({
    where: { user: { isBot: true } },
    include: { creator: { select: { name: true } } },
  });

  console.log(`\nActive bot positions: ${botPositions.length}`);
  botPositions.slice(0, 5).forEach((p) => {
    console.log(`- Bot Position: ${p.quantity} shares of ${p.creator.name}`);
  });
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
