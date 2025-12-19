import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
import { getChannelStats, searchChannels } from "../lib/youtube";
import { calculateP0, MARKET_CONFIG } from "../lib/market";

dotenv.config();

const prisma = new PrismaClient();

const SEARCH_TARGETS = [
  // --- K-POP & Music ---
  {
    category: "K-POP",
    queries: [
      "Official Psy",
      "Blackpink",
      "BTS",
      "BANGTANTV",
      "JYP Entertainment",
      "SMTOWN",
      "HYBE LABELS",
      "1theK",
      "Mnet K-POP",
      "KBS Kpop",
      "SBS Inkigayo",
      "MBCkpop",
    ],
  },
  {
    category: "Music",
    queries: ["Jane ASMR", "Hongyu ASMR", "Essential", "ChilledCow"],
  },

  // --- Entertainment & Vlog ---
  {
    category: "Entertainment",
    queries: [
      "Wassup Man",
      "Workman",
      "Psick Univ",
      "ChimChakMan",
      "Calm Down Man",
      "Running Man",
      "Infinite Challenge",
      "Korea Comedy",
      "Korea Variety",
    ],
  },
  {
    category: "Vlog",
    queries: [
      "Pani Bottle",
      "Kwaktube",
      "Wonji's Day",
      "Korea Travel",
      "Korea Vlog",
      "SeoeunStory",
      "Gonigs",
      "PlanD",
    ],
  },
  {
    category: "Kids",
    queries: [
      "Boram check challenge",
      "ToyPudding",
      "CreamHeroes",
      "Korea Kids",
    ],
  },

  // --- Gaming ---
  {
    category: "Gaming",
    queries: [
      "LCK Global",
      "LCK",
      "T1 Faker",
      "Dotty",
      "Gamst",
      "Kim Blue",
      "Korea Gaming",
    ],
  },

  // --- Sports ---
  {
    category: "Sports",
    queries: [
      "Son Heung-min",
      "Tottenhan Hotspur",
      "Shoot for Love",
      "SPOTV",
      "Korea Physical",
    ],
  },

  // --- Food (Mukbang/Cooking) ---
  {
    category: "Food",
    queries: [
      "Tzuyang",
      "Hamzy",
      "Heopop",
      "Baek Jong-won",
      "Korea Mukbang",
      "Korea Cooking",
      "Korea Street Food",
    ],
  },

  // --- Beauty & Fashion ---
  {
    category: "Beauty",
    queries: [
      "Risabae",
      "Pony Syndrome",
      "Sinnim",
      "Korea Beauty",
      "Korea Fashion",
    ],
  },

  // --- Tech & News ---
  {
    category: "Tech",
    queries: ["ITSub", "Underkg", "Korea Tech", "Samsung", "LG"],
  },
  { category: "News", queries: ["YTN", "JTBC News", "SBS News", "KBS News"] },

  // --- Broad Fallbacks ---
  {
    category: "Education",
    queries: ["Korea Education", "Korea History", "Korea Science"],
  },
  { category: "Economy", queries: ["Korea Stock Investment", "Shuka World"] },
];

async function main() {
  console.log("🌱 Starting seed (Categorized Mode)...");

  // Cleanup Database
  console.log("🧹 Clearing existing data for fresh categorized seed...");
  await prisma.trade.deleteMany({});
  await prisma.position.deleteMany({});
  await prisma.creatorStat.deleteMany({});
  await prisma.creator.deleteMany({});
  console.log("✅ Database cleared.");

  const existingCount = await prisma.creator.count();
  console.log(`Current creators in database: ${existingCount}`);

  let addedCount = 0;
  const targetCount = 350; // Aim high
  const processedIds = new Set<string>();

  for (const group of SEARCH_TARGETS) {
    const { category, queries } = group;
    console.log(`📂 Processing Category: ${category}`);

    for (const query of queries) {
      if (addedCount >= targetCount) break;

      let channelIds: string[] = [];
      console.log(`  🔍 Searching: ${query}...`);
      try {
        channelIds = await searchChannels(query, {
          maxResults: 15, // Smaller batch per query to diversify
          order: "viewCount",
        });

        for (const channelId of channelIds) {
          if (addedCount >= targetCount) break;
          if (processedIds.has(channelId)) continue;
          processedIds.add(channelId);

          try {
            // Get stats
            const stats = await getChannelStats(channelId);
            if (!stats) continue;

            // Filter by subscriber count (e.g. at least 100k for "Top" feel, max 100M)
            // User asked for "based on subscriber count", so we should prioritize high subs.
            // searchChannels 'viewCount' is a proxy for popularity.
            if (stats.subs < 10000) {
              // Skip very small channels
              continue;
            }

            // Calculate Initial Price (P0)
            const p0 = calculateP0({
              subs: stats.subs,
              totalViews: stats.views,
              recentViews: stats.views / 200, // Appx recent (stat not avail via this API call)
              recentShortsViews: 0,
            });

            // Add to database
            const creator = await prisma.creator.create({
              data: {
                youtubeChannelId: stats.channelId,
                name: stats.name,
                thumbnailUrl: stats.thumbnailUrl,
                category: category, // Use the structured category
                currentSubs: stats.subs,
                currentViews: stats.views,
                currentVideos: stats.videos,
                currentScore: 0,
                initialPrice: p0,
                currentPrice: p0,
                totalSupply: MARKET_CONFIG.DEFAULT_TOTAL_SUPPLY,
                circulatingSupply: MARKET_CONFIG.DEFAULT_CIRCULATING_SUPPLY,
                reserveSupply:
                  MARKET_CONFIG.DEFAULT_TOTAL_SUPPLY -
                  MARKET_CONFIG.DEFAULT_CIRCULATING_SUPPLY,
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
              `✅ [${addedCount}/${targetCount}] Added: ${
                creator.name
              } (P0: ${p0}, ${stats.subs.toLocaleString()} subs)`
            );

            await new Promise((resolve) => setTimeout(resolve, 50)); // Tiny delay
          } catch (innerError: any) {
            // Ignore duplicates silently
          }
        }
      } catch (error) {
        console.error(`Error processing category "${query}":`, error);
      }

      // --- MOCK FALLBACK ---
      if (channelIds.length === 0) {
        console.log(
          `⚠️ No results for "${query}" (API Quota?). Creating MOCK creator.`
        );
        const mockId = `mock-${query.replace(/\s+/g, "-")}-${Date.now()}`;

        try {
          const baseSubs = 100000 + Math.floor(Math.random() * 5000000);
          const baseViews = baseSubs * (50 + Math.floor(Math.random() * 500));
          const p0 = calculateP0({
            subs: baseSubs,
            totalViews: baseViews,
            recentViews: baseViews / 200,
            recentShortsViews: 0,
          });

          await prisma.creator.create({
            data: {
              youtubeChannelId: mockId,
              name: query, // Use the query as the name
              thumbnailUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(
                query
              )}&background=random`,
              category: category,
              currentSubs: baseSubs,
              currentViews: baseViews,
              currentVideos: Math.floor(Math.random() * 1000),
              // image removed
              initialPrice: p0,
              currentPrice: p0,
              totalSupply: MARKET_CONFIG.DEFAULT_TOTAL_SUPPLY,
              circulatingSupply: MARKET_CONFIG.DEFAULT_CIRCULATING_SUPPLY,
              reserveSupply:
                MARKET_CONFIG.DEFAULT_TOTAL_SUPPLY -
                MARKET_CONFIG.DEFAULT_CIRCULATING_SUPPLY,
              liquidity: 100000,
              isActive: true,
              visibility: "PUBLIC",
            },
          });

          // Initial Stat
          const created = await prisma.creator.findUnique({
            where: { youtubeChannelId: mockId },
          });
          if (created) {
            await prisma.creatorStat.create({
              data: {
                creatorId: created.id,
                date: new Date(),
                period: "DAILY",
                subs: baseSubs,
                views: baseViews,
                videos: 100,
              },
            });
            addedCount++;
            console.log(
              `✅ [${addedCount}/${targetCount}] Added MOCK: ${query}`
            );
          }
        } catch (e) {
          console.log(`Failed to create mock for ${query}`, e);
        }
      }
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
