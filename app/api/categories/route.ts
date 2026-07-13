import { prisma } from "@/lib/prisma";
import { corsPreflight, withApiRoute } from "@/lib/server/http/route-handler";

export const GET = withApiRoute(async () => {
  const categories = await prisma.creator.findMany({
    where: {
      visibility: "PUBLIC",
      isActive: true,
    },
    select: {
      category: true,
    },
    distinct: ["category"],
  });

  const uniqueCategories = categories
    .map((creator) => creator.category)
    .filter((category): category is string => !!category)
    .sort();

  return Response.json({ categories: ["전체", ...uniqueCategories] });
});

export const OPTIONS = corsPreflight;
