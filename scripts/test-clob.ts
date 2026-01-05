import { PrismaClient } from "@prisma/client";
import { placeOrder } from "../lib/matching-engine";

const prisma = new PrismaClient();

async function main() {
  console.log("🧪 Testing CLOB Standard Logic...");

  // 1. Setup User
  let user = await prisma.user.findFirst({
    where: { isBot: false, email: "test@example.com" },
  });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: "test@example.com",
        name: "TestUser",
        isBot: false,
        balance: 1000000,
      },
    });
  }

  // 2. Pick a Creator
  const creator = await prisma.creator.findFirst({ where: { isActive: true } });
  if (!creator) throw new Error("No active creator found");

  const price = 500000; // Very high price to ensure NO MATCH
  const qty = 1;

  console.log(
    `User ${user.name} placing SELL Order for ${creator.name} at ${price} (High Price -> Should be OPEN)`
  );

  // Ensure user has position
  const pos = await prisma.position.findUnique({
    where: { userId_creatorId: { userId: user.id, creatorId: creator.id } },
  });
  if (!pos || pos.quantity < qty) {
    await prisma.position.upsert({
      where: { userId_creatorId: { userId: user.id, creatorId: creator.id } },
      update: { quantity: { increment: 100 } },
      create: {
        userId: user.id,
        creatorId: creator.id,
        quantity: 100,
        avgPrice: 10,
      },
    });
  }

  // 3. Place Sell Limit Order (High Price)
  const order = await placeOrder(
    user.id,
    creator.id,
    "SELL",
    price,
    qty,
    "LIMIT"
  );

  console.log(`Order Placed: ID=${order.id} Status=${order.status}`);

  if (order.status !== "OPEN") {
    console.error(
      "❌ FAILED: Order matched instantly but it should have been unmatched (Price too high)."
    );
  } else {
    console.log("✅ SUCCESS: Order is OPEN aka 'Registered into Order Book'.");
  }

  // 4. Verify DB
  const dbOrder = await prisma.order.findUnique({ where: { id: order.id } });
  if (dbOrder && dbOrder.status === "OPEN") {
    console.log("✅ SUCCESS: Order confirmed in DB as OPEN.");
  } else {
    console.error(`❌ FAILED: DB Status is ${dbOrder?.status}`);
  }
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
