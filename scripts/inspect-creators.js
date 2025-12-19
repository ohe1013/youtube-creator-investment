const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const creators = await prisma.creator.findMany({
    select: { id: true, name: true, nameKo: true },
    take: 20,
  });
  console.log(JSON.stringify(creators, null, 2));
}

main().finally(() => prisma.$disconnect());
