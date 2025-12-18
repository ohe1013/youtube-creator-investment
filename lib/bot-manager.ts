import { prisma } from "./prisma";
import { calculateNewPrice } from "./market";

const BOT_CONFIG = {
  MAX_TRADE_AMOUNT_CAP: 2000,   // Hard cap per trade
  TRADE_AMOUNT_PCT: 0.02,       // 2% of balance
  MAX_POSITION_PCT: 0.20,       // Max 20% allocation per stock
  COOLDOWN_MIN: 5,              // Minutes
  COOLDOWN_MAX: 30,             // Minutes
};

/**
 * Bot Manager
 * 
 * Rules:
 * 1. Bots are regular users with isBot=true.
 * 2. Bots participate in the market (0-10 bots randomly per session).
 * 3. Bots follow the same trading constraints as users.
 * 4. Safety Caps applied to prevent market manipulation.
 */

export async function spawnBots(count: number) {
  const bots = [];
  for (let i = 0; i < count; i++) {
    const bot = await prisma.user.create({
      data: {
        name: `MarketBot_${Math.random().toString(36).substring(7)}`,
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
  // Pick a random bot
  const botCount = await prisma.user.count({ where: { isBot: true } });
  if (botCount === 0) {
    await spawnBots(10); // Initial spawn
  }

  const randomBot = await prisma.user.findFirst({
    where: { isBot: true },
    skip: Math.floor(Math.random() * botCount),
    include: { positions: true } // Need positions for portfolio check
  });

  if (!randomBot) return;

  // Pick a random creator
  const creatorCount = await prisma.creator.count({ where: { isActive: true } });
  if (creatorCount === 0) return;

  const creator = await prisma.creator.findFirst({
    where: { isActive: true },
    skip: Math.floor(Math.random() * creatorCount),
  });

  if (!creator) return;

  // --- SAFETY CHECK 1: Cooldown ---
  // Check last trade for this bot-creator pair
  const lastTrade = await prisma.trade.findFirst({
    where: { userId: randomBot.id, creatorId: creator.id },
    orderBy: { createdAt: 'desc' }
  });

  if (lastTrade) {
    const minutesSinceLast = (Date.now() - lastTrade.createdAt.getTime()) / (1000 * 60);
    // Random cooldown requirement between 5 and 30 minutes
    const requiredCooldown = Math.floor(Math.random() * (BOT_CONFIG.COOLDOWN_MAX - BOT_CONFIG.COOLDOWN_MIN + 1)) + BOT_CONFIG.COOLDOWN_MIN;
    
    if (minutesSinceLast < requiredCooldown) {
      console.log(`Bot ${randomBot.name} skipping ${creator.name} (Cooldown: ${minutesSinceLast.toFixed(1)} < ${requiredCooldown}m)`);
      return;
    }
  }

  // --- STRATEGY: Random/Momentum (No FV) ---
  const tradeType = Math.random() < 0.6 ? 'BUY' : 'SELL'; // Slightly bias towards BUY for activity
  
  // Calculate max allowable trade amount
  const maxTradeByBalance = randomBot.balance * BOT_CONFIG.TRADE_AMOUNT_PCT;
  const maxTradeAmount = Math.min(maxTradeByBalance, BOT_CONFIG.MAX_TRADE_AMOUNT_CAP);
  
  // Determine quantity based on price
  // Ensure at least 1 share or min trade unit
  let quantity = Math.floor(maxTradeAmount / creator.currentPrice);
  if (quantity < 1) quantity = 1;

  // Cap quantity randomly to vary trade sizes (1 to calculated max)
  quantity = Math.floor(Math.random() * quantity) + 1;

  try {
    await prisma.$transaction(async (tx: any) => {
      const cost = quantity * creator.currentPrice;

      if (tradeType === 'BUY') {
        if (randomBot.balance < cost) return;

        // --- SAFETY CHECK 2: Portfolio Allocation ---
        // Verify this position won't exceed 20% of total portfolio value
        // Total Value approx = Balance + Sum(Pos * MP)
        // For simplicity, we check if (CurrentPos + NewTrade) > Total * 0.2
        // If strict portfolio calc is expensive, we can just cap Position Value vs InitialBudget or Balance
        
        const currentPos = randomBot.positions.find(p => p.creatorId === creator.id);
        const currentPosValue = (currentPos?.quantity || 0) * creator.currentPrice;
        const projectedPosValue = currentPosValue + cost;
        
        // Approximate Total Value (using initial budget is a safe baseline, or current balance + positions)
        // For speed, let's use a conservative estimate: Balance + CurrentPosValue
        // A better check: projectedPosValue should not be > (Balance + AllPos) * 0.2
        // We will use a simpler proxy: projectedPosValue shouldn't exceed 20% of InitialBudget for now to keep bots safer
        // Or better: shouldn't exceed 20% of current available capital + holdings.
        
        // Let's use: Max Position Value = 20,000 (20% of 100k)
        if (projectedPosValue > (randomBot.initialBudget * BOT_CONFIG.MAX_POSITION_PCT)) {
           console.log(`Bot ${randomBot.name} skipped BUY ${creator.name} (Max Pos Limit)`);
           return;
        }

        // Execute BUY
        const newPrice = calculateNewPrice(creator.currentPrice, cost, 'BUY', creator.liquidity);
        
        await tx.trade.create({
          data: { userId: randomBot.id, creatorId: creator.id, type: 'BUY', quantity, price: creator.currentPrice }
        });

        if (currentPos) {
          await tx.position.update({
            where: { id: currentPos.id },
            data: { 
              quantity: currentPos.quantity + quantity,
              avgPrice: (currentPos.avgPrice * currentPos.quantity + cost) / (currentPos.quantity + quantity)
            }
          });
        } else {
          await tx.position.create({
            data: { userId: randomBot.id, creatorId: creator.id, quantity, avgPrice: creator.currentPrice }
          });
        }

        await tx.user.update({
          where: { id: randomBot.id },
          data: { balance: randomBot.balance - cost }
        });

        await tx.creator.update({
          where: { id: creator.id },
          data: { currentPrice: newPrice }
        });
        
        console.log(`Bot ${randomBot.name} BUY ${creator.name}: ${quantity} @ ${creator.currentPrice} -> ${newPrice}`);

      } else {
        // SELL
        const currentPos = randomBot.positions.find(p => p.creatorId === creator.id);
        if (!currentPos || currentPos.quantity < quantity) return;

        const proceeds = quantity * creator.currentPrice;
        const newPrice = calculateNewPrice(creator.currentPrice, proceeds, 'SELL', creator.liquidity);

        await tx.trade.create({
          data: { userId: randomBot.id, creatorId: creator.id, type: 'SELL', quantity, price: creator.currentPrice }
        });

        if (currentPos.quantity === quantity) {
          await tx.position.delete({ where: { id: currentPos.id } });
        } else {
          await tx.position.update({
            where: { id: currentPos.id },
            data: { quantity: currentPos.quantity - quantity }
          });
        }

        await tx.user.update({
          where: { id: randomBot.id },
          data: { balance: randomBot.balance + proceeds }
        });

        await tx.creator.update({
          where: { id: creator.id },
          data: { currentPrice: newPrice }
        });
        
        console.log(`Bot ${randomBot.name} SELL ${creator.name}: ${quantity} @ ${creator.currentPrice} -> ${newPrice}`);
      }
    });
  } catch (error) {
    console.error(`Bot trade error:`, error);
  }
}
