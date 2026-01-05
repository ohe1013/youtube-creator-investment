import { PrismaClient } from "@prisma/client";
import { placeOrder, cancelOrder } from "../lib/matching-engine";

const prisma = new PrismaClient();

async function main() {
  console.log("🧪 Testing Order Cancellation...");

  // 1. Setup User
  let user = await prisma.user.findFirst({
    where: { isBot: false, email: "test@example.com" },
  });
  if (!user) {
    console.log("Creating test user...");
    user = await prisma.user.create({
      data: {
        email: "test@example.com",
        name: "TestUser",
        isBot: false,
        balance: 1000000,
      },
    });
  }

  // 2. Place an order to cancel
  const creator = await prisma.creator.findFirst({ where: { isActive: true } });
  if (!creator) throw new Error("No active creator found");

  const initialBalance = user.balance;
  console.log(`Initial Balance: ${initialBalance}`);

  // Buy Order (Locks Funds)
  console.log(`Placing Buy Order...`);
  const order = await placeOrder(user.id, creator.id, "BUY", 100, 10, "LIMIT"); // 1000 cost

  const userAfterOrder = await prisma.user.findUnique({
    where: { id: user.id },
  });
  console.log(
    `Balance after order: ${userAfterOrder.balance} (Should be -1000)`
  );

  if (Math.abs(initialBalance - 1000 - userAfterOrder.balance) > 0.1) {
    console.error("❌ Balance deduction failed");
  }

  // 3. Cancel Order
  console.log(`Cancelling Order ${order.id}...`);
  await cancelOrder(user.id, order.id);

  // 4. Verify Refund
  const userAfterCancel = await prisma.user.findUnique({
    where: { id: user.id },
  });
  console.log(`Balance after cancel: ${userAfterCancel.balance}`);

  if (Math.abs(userAfterCancel.balance - initialBalance) < 0.1) {
    console.log("✅ SUCCESS: Balance fully refunded.");
  } else {
    console.error("❌ FAILED: Balance not refunded correctly.");
  }

  // 5. Verify Status
  const dbOrder = await prisma.order.findUnique({ where: { id: order.id } });
  if (dbOrder.status === "CANCELLED") {
    console.log("✅ SUCCESS: Order status is CANCELLED.");
  } else {
    console.error(`❌ FAILED: Order status is ${dbOrder.status}`);
  }
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
