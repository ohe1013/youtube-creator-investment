import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function inspect() {
  console.log("--- Inspecting Orders ---");
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  console.log(`Found ${orders.length} recent orders.`);
  orders.forEach((order) => {
    console.log(
      `Order ${order.id}: ${order.type} ${order.orderType} Qty:${order.quantity} Filled:${order.filled} Price:${order.price} Status:${order.status} Creator:${order.creatorId}`
    );
  });

  console.log("\n--- Inspecting Trades ---");
  const trades = await prisma.legacyTrade.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  console.log(`Found ${trades.length} recent trades.`);
  trades.forEach((trade) => {
    console.log(
      `Trade ${trade.id}: ${trade.type} Qty:${trade.quantity} Price:${trade.price} Creator:${trade.creatorId}`
    );
  });

  console.log("\n--- Inspecting Bots ---");
  const bots = await prisma.user.findMany({
    where: { isBot: true },
    include: { positions: true },
    take: 5,
  });
  console.log(
    `Found ${bots.length} bots. (Total bots: ${await prisma.user.count({
      where: { isBot: true },
    })})`
  );
  bots.forEach((bot) => {
    console.log(
      `Bot ${bot.name}: Balance ${bot.balance}, Positions: ${bot.positions.length}`
    );
  });
}

inspect()
  .catch((error) => console.error(error))
  .finally(async () => await prisma.$disconnect());
