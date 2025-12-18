import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import { getChannelStats, searchChannels } from "../lib/youtube";
import { calculateP0, MARKET_CONFIG } from "../lib/market";

dotenv.config();

const prisma = new PrismaClient();

const CATEGORIES = [
  "한국 먹방",
  "한국 브이로그",
  "대한민국 일상",
  "한국 기술 리뷰",
  "한국 게임 방송",
  "한국 요리 레시피",
  "한국 경제 재테크",
  "한국 헬스 운동",
  "한국 교육 학습",
  "한국 여행 채널",
  "K-POP 리액션",
  "한국 토크쇼",
  "한국 패션 뷰티",
];

async function main() {
  console.log("🌱 Starting seed...");

  const existingCount = await prisma.creator.count();
  console.log(`Current creators in database: ${existingCount}`);

  let addedCount = 0;
  const targetCount = 200;
  const processedIds = new Set<string>();

  for (const query of CATEGORIES) {
    if (addedCount >= targetCount) break;

    console.log(`🔍 Searching for category: ${query}...`);
    try {
      const channelIds = await searchChannels(query, { maxResults: 30 });
      console.log(
        `Found ${channelIds.length} candidate channels for "${query}"`
      );

      for (const channelId of channelIds) {
        if (addedCount >= targetCount) break;
        if (processedIds.has(channelId)) continue;
        processedIds.add(channelId);

        try {
          // Check if already exists
          const existing = await prisma.creator.findUnique({
            where: { youtubeChannelId: channelId },
          });

          if (existing) {
            console.log(`⏩ Creator ${channelId} already exists, skipping.`);
            continue;
          }

          // Get stats
          const stats = await getChannelStats(channelId);
          if (!stats) continue;

          // Filter by subscriber count (1k - 1M)
          if (stats.subs < 1000 || stats.subs > 1000000) {
            console.log(
              `⏩ Creator ${stats.name} has ${stats.subs} subs (outside 1k-1M range), skipping.`
            );
            continue;
          }

          // Calculate Initial Price (P0)
          const p0 = calculateP0({
            subs: stats.subs,
            totalViews: stats.views,
            recentViews: stats.views / 2, // Dummy value for seed
            recentShortsViews: stats.views / 4, // Dummy value for seed
          });

          // Add to database
          const creator = await prisma.creator.create({
            data: {
              youtubeChannelId: stats.channelId,
              name: stats.name,
              thumbnailUrl: stats.thumbnailUrl,
              category: query.replace("한국 ", "").split(" ")[0],
              currentSubs: stats.subs,
              currentViews: stats.views,
              currentVideos: stats.videos,
              currentScore: 0,
              initialPrice: p0,
              currentPrice: p0,
              totalSupply: MARKET_CONFIG.DEFAULT_TOTAL_SUPPLY,
              circulatingSupply: MARKET_CONFIG.DEFAULT_CIRCULATING_SUPPLY,
              reserveSupply: MARKET_CONFIG.DEFAULT_TOTAL_SUPPLY - MARKET_CONFIG.DEFAULT_CIRCULATING_SUPPLY,
              liquidity: 100000,
              isActive: true,
              visibility: "PUBLIC",
            },
          });

          // Add initial stat snapshot
          await prisma.creatorStat.create({
            data: {
              creatorId: creator.id,
              date: new Date(),
              period: "DAILY",
              subs: stats.subs,
              views: stats.views,
              videos: stats.videos,
            },
          });

          addedCount++;
          console.log(
            `✅ [${addedCount}/${targetCount}] Added: ${creator.name} (P0: ${p0}, ${stats.subs} subs)`
          );

          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (innerError: any) {
          if (innerError.code === "P2002") {
            console.log(`⏩ Race condition for ${channelId}, skipping.`);
          } else {
            console.error(`Error adding channel ${channelId}:`, innerError);
          }
        }
      }
    } catch (error) {
      console.error(`Error processing category "${query}":`, error);
    }
  }

  console.log(`✨ Seed finished! Added ${addedCount} new creators.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
