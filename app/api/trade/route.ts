import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { placeOrder } from "@/lib/matching-engine";
import { placeOrderInputSchema } from "@/lib/data/contracts";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const json: unknown = await req.json();
    const tradeResult = placeOrderInputSchema.safeParse(json);

    if (!tradeResult.success) {
      return NextResponse.json(
        { error: tradeResult.error.message },
        { status: 400 }
      );
    }

    const { creatorId, side, price, quantity, orderType } = tradeResult.data;

    const order = await placeOrder(
      session.user.id,
      creatorId,
      side,
      price,
      quantity,
      orderType
    );

    return NextResponse.json({ order });
  } catch (error) {
    console.error("Trade error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Trade failed" },
      { status: 400 }
    );
  }
}
