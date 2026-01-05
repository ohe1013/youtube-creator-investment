import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { cancelOrder } from "@/lib/matching-engine";
import { z } from "zod";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const userId = (session.user as any).id;

    await cancelOrder(userId, id);

    return NextResponse.json({ success: true, message: "Order cancelled" });
  } catch (error: any) {
    console.error("Cancel Order Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to cancel order" },
      { status: 400 }
    );
  }
}
