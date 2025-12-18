import { NextRequest, NextResponse } from "next/server";
import { executeBotTrade } from "@/lib/bot-manager";

export async function POST(request: NextRequest) {
  try {
    // Verify secret token
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (token !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Determine how many bot trades to execute (e.g., 1-5 per trigger)
    const tradeCount = Math.floor(Math.random() * 5) + 1;
    
    console.log(`Triggering ${tradeCount} bot trades...`);
    
    for (let i = 0; i < tradeCount; i++) {
      await executeBotTrade();
      // Small delay between bot trades
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return NextResponse.json({
      message: "Bot activity triggered successfully",
      tradeCount
    });
  } catch (error) {
    console.error("Bot activity cron error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
