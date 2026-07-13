import { PrismaClient } from "@prisma/client";
import { afterAll, expect, it } from "vitest";

const prisma = new PrismaClient();

afterAll(() => prisma.$disconnect());

it("runs against the isolated creatorx test database", async () => {
  const result = await prisma.$queryRaw<Array<{ database: string }>>`
    SELECT current_database() AS database
  `;

  expect(result[0]?.database).toBe("creatorx_test");
});
