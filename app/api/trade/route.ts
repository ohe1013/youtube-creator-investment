import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { placeOrder } from "@/lib/matching-engine";
import { z } from "zod";

const tradeSchema = z.object({
  creatorId: z.string(),
  side: z.enum(["BUY", "SELL"]),
  price: z.number().positive(),
  quantity: z.number().positive(),
  orderType: z.enum(["LIMIT", "MARKET"]).optional().default("LIMIT"),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const json = await req.json();
    const { creatorId, side, price, quantity, orderType } =
      tradeSchema.parse(json);

    const order = await placeOrder(
      (session.user as any).id,
      creatorId,
      side,
      price,
      quantity,
      orderType
    );

    return NextResponse.json({ order });
  } catch (error: any) {
    console.error("Trade error:", error);
    return NextResponse.json(
      { error: error.message || "Trade failed" },
      { status: 400 }
    );
  }
}
