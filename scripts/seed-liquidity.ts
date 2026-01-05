import { PrismaClient } from "@prisma/client";
import { placeOrder } from "../lib/matching-engine";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding Liquidity...");

  // 1. Ensure Bots
  const botCount = await prisma.user.count({ where: { isBot: true } });
  if (botCount < 5) {
    console.log("Creating bots...");
    for (let i = 0; i < 5; i++) {
      await prisma.user.create({
        data: {
          name: `MarketBot_${i}`,
          isBot: true,
          balance: 10000000, // Rich bots
          initialBudget: 10000000,
        },
      });
    }
  }
  const bots = await prisma.user.findMany({ where: { isBot: true } });
  console.log(`🤖 Loaded ${bots.length} Bots.`);

  // 2. Load Creators
  const creators = await prisma.creator.findMany({ where: { isActive: true } });
  console.log(`📈 Loaded ${creators.length} Creators.`);

  // 3. Place Orders for each Creator
  for (const creator of creators) {
    console.log(`Processing ${creator.name} (${creator.currentPrice} P)...`);

    const price = creator.currentPrice > 0 ? creator.currentPrice : 100;

    // --- SEED ASKS (SELLS) ---
    // Bots need Shares to sell
    for (let i = 0; i < 5; i++) {
      const bot = bots[i % bots.length];
      const spread = 0.01 + i * 0.01; // 1%, 2%, 3%...
      const askPrice = Math.round(price * (1 + spread));
      const qty = 10 + Math.floor(Math.random() * 90);

      // Give bot shares first
      const pos = await prisma.position.findUnique({
        where: { userId_creatorId: { userId: bot.id, creatorId: creator.id } },
      });
      if (!pos) {
        await prisma.position.create({
          data: {
            userId: bot.id,
            creatorId: creator.id,
            quantity: 10000,
            avgPrice: 10,
          },
        });
      } else {
        await prisma.position.update({
          where: { id: pos.id },
          data: { quantity: { increment: 1000 } },
        });
      }

      try {
        await placeOrder(bot.id, creator.id, "SELL", askPrice, qty, "LIMIT");
        // console.log(`  Deployed ASK: ${qty} @ ${askPrice}`);
      } catch (e) {
        console.error(`  Failed to sell: ${e.message}`);
      }
    }

    // --- SEED BIDS (BUYS) ---
    // Bots need Cash to buy
    for (let i = 0; i < 5; i++) {
      const bot = bots[(i + 1) % bots.length]; // Different bots
      const spread = 0.01 + i * 0.01;
      const bidPrice = Math.round(price * (1 - spread));

      if (bidPrice < 1) continue;

      const qty = 10 + Math.floor(Math.random() * 90);

      // Give bot cash
      await prisma.user.update({
        where: { id: bot.id },
        data: { balance: { increment: bidPrice * qty * 2 } },
      });

      try {
        await placeOrder(bot.id, creator.id, "BUY", bidPrice, qty, "LIMIT");
        // console.log(`  Deployed BID: ${qty} @ ${bidPrice}`);
      } catch (e) {
        console.error(`  Failed to buy: ${e.message}`);
      }
    }
    console.log(`  ✅ Seeded orders for ${creator.name}`);
  }

  console.log("🏁 Liquidity Seeding Complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
