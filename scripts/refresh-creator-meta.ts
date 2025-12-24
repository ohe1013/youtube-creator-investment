import { PrismaClient } from "@prisma/client";
import { getChannelStats, searchChannels } from "../lib/youtube";

const prisma = new PrismaClient();

async function main() {
  console.log(
    "🚀 Starting Creator Cleanup: Mock ID Removal & Name Synchronization..."
  );

  // 1. Fetch creators that need updating (either mock ID or missing thumbnail)
  const creators = await prisma.creator.findMany({
    where: {
      isActive: true,
      OR: [
        { youtubeChannelId: { startsWith: "mock-" } },
        { thumbnailUrl: null },
      ],
    },
  });

  console.log(`📊 Total creators found: ${creators.length}`);

  let searchCount = 0;
  let updateCount = 0;
  let failCount = 0;

  for (const creator of creators) {
    try {
      let channelId = creator.youtubeChannelId;
      const isMock = channelId.startsWith("mock-");

      // If it's a mock ID, we MUST find a real one.
      if (isMock) {
        console.log(
          `🔍 [MOCK: ${creator.name}] Searching for real YouTube channel ID...`
        );
        // We use the creator's current name as the search query.
        const searchResults = await searchChannels(creator.name, {
          maxResults: 1,
        });

        if (searchResults && searchResults.length > 0) {
          channelId = searchResults[0];
          console.log(`✨ Found real ID for ${creator.name} -> ${channelId}`);
          searchCount++;
        } else {
          console.error(
            `❌ CRITICAL: Could not find real ID for ${creator.name}.`
          );
          failCount++;
          continue; // Skip if we can't find a real channel for a mock ID
        }
      }

      console.log(
        `📡 [${creator.name}] Syncing with YouTube (ID: ${channelId})...`
      );
      const stats = await getChannelStats(channelId);

      if (!stats) {
        console.error(
          `❌ API Error: Failed to fetch stats for ${creator.name} (${channelId})`
        );
        failCount++;
        continue;
      }

      // Update the creator with real ID and synchronized names
      await prisma.creator.update({
        where: { id: creator.id },
        data: {
          youtubeChannelId: channelId,
          name: stats.name,
          thumbnailUrl: stats.thumbnailUrl || creator.thumbnailUrl,
          currentSubs: stats.subs,
          currentViews: stats.views,
          currentVideos: stats.videos,
          lastSyncedAt: new Date(),
        },
      });

      console.log(
        `✅ [UPDATED] name: ${
          stats.name
        } | subs: ${stats.subs.toLocaleString()}`
      );
      updateCount++;
    } catch (error) {
      console.error(`❌ Unhandled error processing ${creator.name}:`, error);
      failCount++;
    }

    // Delay to respect API limits
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  console.log("\n✨ Cleanup Summary");
  console.log("============================");
  console.log(`🔍 Real IDs recovered: ${searchCount}`);
  console.log(`🚀 Successfully updated: ${updateCount} creators`);
  console.log(`⚠️  Total failures/skips: ${failCount}`);

  const remainingMocks = await prisma.creator.count({
    where: { youtubeChannelId: { startsWith: "mock-" } },
  });
  console.log(`📝 Remaining Mock IDs in DB: ${remainingMocks}`);
}

main()
  .catch((e) => {
    console.error("❌ Fatal Script Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
