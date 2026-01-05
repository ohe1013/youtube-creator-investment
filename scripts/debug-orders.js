const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function inspect() {
  console.log("--- Inspecting Orders ---");
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  console.log(`Found ${orders.length} recent orders.`);
  orders.forEach((o) => {
    console.log(
      `Order ${o.id}: ${o.type} ${o.orderType} Qty:${o.quantity} Filled:${o.filled} Price:${o.price} Status:${o.status} Creator:${o.creatorId}`
    );
  });

  console.log("\n--- Inspecting Trades ---");
  const trades = await prisma.trade.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  console.log(`Found ${trades.length} recent trades.`);
  trades.forEach((t) => {
    console.log(
      `Trade ${t.id}: ${t.type} Qty:${t.quantity} Price:${t.price} Creator:${t.creatorId}`
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
  bots.forEach((b) => {
    console.log(
      `Bot ${b.name}: Balance ${b.balance}, Positions: ${b.positions.length}`
    );
  });
}

inspect()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
