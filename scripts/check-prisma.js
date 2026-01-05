const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function check() {
  console.log("Checking Prisma Client...");
  if (!prisma.order) {
    console.error("ERROR: prisma.order is undefined!");
  } else {
    console.log("SUCCESS: prisma.order exists.");

    const count = await prisma.order.count();
    console.log(`Total Orders in DB: ${count}`);

    const openOrders = await prisma.order.count({ where: { status: "OPEN" } });
    console.log(`Total OPEN Orders: ${openOrders}`);

    if (openOrders > 0) {
      const sample = await prisma.order.findFirst({
        where: { status: "OPEN" },
      });
      console.log(`Sample Open Order CreatorID: ${sample.creatorId}`);
    }
  }
}

check()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
