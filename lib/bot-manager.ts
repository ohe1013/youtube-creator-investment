import { prisma } from "./prisma";
import { placeOrder } from "./matching-engine";

const BOT_CONFIG = {
  MAX_TRADE_AMOUNT_CAP: 2000,
  TRADE_AMOUNT_PCT: 0.02,
  MAX_POSITION_PCT: 0.2,
  COOLDOWN_MIN: 1, // Reduced for testing
  COOLDOWN_MAX: 10,
};

export async function spawnBots(count: number) {
  const bots = [];
  for (let i = 0; i < count; i++) {
    const existing = await prisma.user.findFirst({
      where: { name: { startsWith: "MarketBot_" } },
    });
    // To ensure unique names if many exist, though random substring is robust enough usually
    const suffix = Math.random().toString(36).substring(7);
    const bot = await prisma.user.create({
      data: {
        name: `MarketBot_${suffix}`,
        isBot: true,
        balance: 100000,
        initialBudget: 100000,
      },
    });
    bots.push(bot);
  }
  return bots;
}

export async function executeBotTrade() {
  // 1. Pick Bot & Creator
  const botCount = await prisma.user.count({ where: { isBot: true } });
  if (botCount === 0) await spawnBots(10);

  const randomBot = await prisma.user.findFirst({
    where: { isBot: true },
    skip: Math.floor(Math.random() * botCount),
    include: { positions: true },
  });
  if (!randomBot) return;

  const creatorCount = await prisma.creator.count({
    where: { isActive: true },
  });
  if (creatorCount === 0) return;

  const creator = await prisma.creator.findFirst({
    where: { isActive: true },
    skip: Math.floor(Math.random() * creatorCount),
  });
  if (!creator) return;

  // 2. Decide Strategy: Maker (Liquidity) vs Taker (Active)
  const isMaker = Math.random() < 0.7; // 70% chance to place passive limit order

  try {
    const currentPrice = creator.currentPrice;

    if (isMaker) {
      // --- MAKER STRATEGY ---
      // Place orders around the current price to build the book
      // Spread: 1% to 10% away
      const side = Math.random() < 0.5 ? "BUY" : "SELL";
      const spread = 0.01 + Math.random() * 0.09;

      let price =
        side === "BUY"
          ? currentPrice * (1 - spread)
          : currentPrice * (1 + spread);

      price = Math.round(price);
      if (price < 1) price = 1;

      // Quantity logic
      const balanceToUse = randomBot.balance * 0.05; // Use 5% of balance for makers
      const quantity = Math.max(1, Math.floor(balanceToUse / price));

      if (side === "SELL") {
        // Check if bot has shares to sell
        const pos = randomBot.positions.find((p) => p.creatorId === creator.id);
        if (!pos || pos.quantity < 1) {
          // Can't sell what we don't have. Switch to BUY or skip.
          // Let's Skip to avoid error spam
          return;
        }
        // Cap quantity to owned
        const sellQty = Math.min(quantity, pos.quantity);
        await placeOrder(
          randomBot.id,
          creator.id,
          "SELL",
          price,
          sellQty,
          "LIMIT"
        );
        console.log(`Bot ${randomBot.name} MAKER SELL: ${sellQty} @ ${price}`);
      } else {
        // BUY
        await placeOrder(
          randomBot.id,
          creator.id,
          "BUY",
          price,
          quantity,
          "LIMIT"
        );
        console.log(`Bot ${randomBot.name} MAKER BUY: ${quantity} @ ${price}`);
      }
    } else {
      // --- TAKER STRATEGY ---
      // Cross the spread!
      // If we want to BUY, we pay slightly MORE than current price to match existing sells.
      // If we want to SELL, we ask slightly LESS.

      const side = Math.random() < 0.55 ? "BUY" : "SELL"; // Slight buy bias
      const aggro = 0.02; // 2% aggressive crossing

      let price =
        side === "BUY"
          ? currentPrice * (1 + aggro)
          : currentPrice * (1 - aggro);

      price = Math.round(price);
      if (price < 1) price = 1;

      // Quantity
      const maxTradeVal = 2000;
      let quantity = Math.floor(maxTradeVal / price);
      quantity = Math.floor(Math.random() * quantity) + 1;

      if (side === "SELL") {
        const pos = randomBot.positions.find((p) => p.creatorId === creator.id);
        if (!pos || pos.quantity < 1) return;
        const sellQty = Math.min(quantity, pos.quantity);
        await placeOrder(
          randomBot.id,
          creator.id,
          "SELL",
          price,
          sellQty,
          "LIMIT"
        ); // Limit acting as Market if prices match
        console.log(`Bot ${randomBot.name} TAKER SELL: ${sellQty} @ ${price}`);
      } else {
        await placeOrder(
          randomBot.id,
          creator.id,
          "BUY",
          price,
          quantity,
          "LIMIT"
        );
        console.log(`Bot ${randomBot.name} TAKER BUY: ${quantity} @ ${price}`);
      }
    }
  } catch (error) {
    // console.error("Bot trade failed:", error); // Suppress expected errors like "Insufficient balance"
  }
}
