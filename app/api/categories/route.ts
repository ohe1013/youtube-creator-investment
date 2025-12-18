import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
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
      .map((c) => c.category)
      .filter((c): c is string => !!c)
      .sort();

    return NextResponse.json({ categories: ["전체", ...uniqueCategories] });
  } catch (error) {
    console.error("Error fetching categories:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
