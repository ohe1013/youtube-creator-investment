import { PrismaClient } from "@prisma/client";
import { calculateP0 } from "../lib/market";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting Market Reset & P0 Calculation...");

  const creators = await prisma.creator.findMany({
    include: {
      stats: {
        orderBy: { date: 'desc' },
        take: 30
      }
    }
  });

  console.log(`Found ${creators.length} creators.`);

  for (const creator of creators) {
    // 1. Calculate P0
    // Try to find historical stats for recentViews fallback
    // simple: use currentViews.
    // better: use stats[0].views - stats[30].views if available.
    
    let recentViews = 0;
    if (creator.stats.length >= 2) {
       // crude approximation if perfect 30d gap isn't there
       // actually definition said: "views_today - views_30d_ago"
       // We'll try to find oldest stat in the window
       const newest = creator.stats[0];
       const oldest = creator.stats[creator.stats.length - 1];
       recentViews = newest.views - oldest.views;
       // Scale manually if window is small? No, just take delta.
    } else {
       // fallback: 1% of total views as recent proxy?
       // or just 0 if no history
       recentViews = Math.floor(creator.currentViews * 0.05); // 5% proxy
    }
    
    // Safety check for negative delta (shouldn't happen but db quirks)
    if (recentViews < 0) recentViews = 0;

    const p0 = calculateP0({
      subs: creator.currentSubs,
      totalViews: creator.currentViews,
      recentViews: recentViews,
      recentShortsViews: 0 // Optional in v1
    });

    console.log(`[${creator.name}] Subs: ${creator.currentSubs}, TotalV: ${creator.currentViews}, RecV: ${recentViews} => P0: ${p0}`);

    // 2. Update DB
    await prisma.creator.update({
      where: { id: creator.id },
      data: {
        initialPrice: p0,
        currentPrice: p0, // RESET to P0
        isActive: true,
        // liquidity: 10000 // Optional reset
      }
    });
  }

  console.log("Market Reset Complete.");
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
