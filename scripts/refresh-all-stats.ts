import { PrismaClient } from "@prisma/client";
import {
  getChannelStats,
  getChannelsStats,
  getRecentVideos,
} from "../lib/youtube";

const prisma = new PrismaClient();

async function refreshAllStats() {
  const args = process.argv.slice(2);
  const isBasicMode = args.includes("--basic");

  console.log(
    `🚀 Starting ${isBasicMode ? "BASIC" : "FULL"} Creator Stats Refresh...`
  );

  const creators = await prisma.creator.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      youtubeChannelId: true,
      currentSubs: true,
      currentViews: true,
      currentVideos: true,
      engagementRate: true,
      viewsPerSubs: true,
      avgLikes: true,
      avgComments: true,
      thumbnailUrl: true,
    },
  });

  console.log(`📊 Found ${creators.length} active creators.`);

  // 1. Batch Fetch Basic Stats (Extremely Quota Efficient)
  const channelIds = creators.map((c) => c.youtubeChannelId);
  console.log(`📡 Fetching basic stats in batches (50 per call)...`);
  const latestStatsList = await getChannelsStats(channelIds);
  const statsMap = new Map(latestStatsList.map((s) => [s.channelId, s]));

  for (const creator of creators) {
    try {
      const stats = statsMap.get(creator.youtubeChannelId);
      if (!stats) {
        console.error(`❌ No data found for ${creator.name} (${creator.id})`);
        continue;
      }

      console.log(`\n📡 [${creator.name}] Processing...`);

      // Calculate daily changes for the snapshot
      const dailySubsChange = stats.subs - creator.currentSubs;
      const dailyViewsChange = stats.views - creator.currentViews;

      let engagementRate = (creator as any).engagementRate || 0;
      let viewsPerSubs = (creator as any).viewsPerSubs || 0;
      let avgLikes = (creator as any).avgLikes || 0;
      let avgComments = (creator as any).avgComments || 0;

      // 2. Fetch Recent Videos & Calculate Engagement (Only in FULL mode)
      if (!isBasicMode) {
        const ytVideos = await getRecentVideos(creator.youtubeChannelId);
        if (ytVideos.length > 0) {
          console.log(`📹 Processing ${ytVideos.length} videos...`);

          // Persist videos to DB
          await Promise.all(
            ytVideos.map((v) =>
              prisma.video.upsert({
                where: { id: v.id },
                update: {
                  viewCount: v.viewCount,
                  likeCount: v.likeCount,
                  commentCount: v.commentCount,
                  title: v.title,
                  thumbnailUrl: v.thumbnailUrl,
                },
                create: {
                  id: v.id,
                  creatorId: creator.id,
                  title: v.title,
                  thumbnailUrl: v.thumbnailUrl,
                  publishedAt: new Date(v.publishedAt),
                  duration: v.duration,
                  type: v.type,
                  viewCount: v.viewCount,
                  likeCount: v.likeCount,
                  commentCount: v.commentCount,
                },
              })
            )
          );

          // Calculate Aggregate Metrics
          const totalViews = ytVideos.reduce((sum, v) => sum + v.viewCount, 0);
          const totalLikes = ytVideos.reduce((sum, v) => sum + v.likeCount, 0);
          const totalComments = ytVideos.reduce(
            (sum, v) => sum + v.commentCount,
            0
          );
          const videoCount = ytVideos.length;

          avgLikes = totalLikes / videoCount;
          avgComments = totalComments / videoCount;
          engagementRate =
            totalViews > 0
              ? ((totalLikes + totalComments) / totalViews) * 100
              : 0;
          viewsPerSubs =
            stats.subs > 0 ? (totalViews / videoCount / stats.subs) * 100 : 0;
        }
      }

      // 3. Create Stat Snapshot
      await prisma.creatorStat.create({
        data: {
          creatorId: creator.id,
          date: new Date(),
          period: "DAILY",
          subs: stats.subs,
          views: stats.views,
          videos: stats.videos,
          dailySubsChange,
          dailyViewsChange,
          avgLikes,
          avgComments,
        },
      });

      // 4. Update Creator Record
      await prisma.creator.update({
        where: { id: creator.id },
        data: {
          currentSubs: stats.subs,
          currentViews: stats.views,
          currentVideos: stats.videos,
          thumbnailUrl: stats.thumbnailUrl || creator.thumbnailUrl,
          name: stats.name,
          avgLikes,
          avgComments,
          engagementRate,
          viewsPerSubs,
          lastSyncedAt: new Date(),
        },
      });

      console.log(`✅ [${creator.name}] Updated successfully.`);
      if (!isBasicMode) {
        console.log(`   - Subs: ${stats.subs.toLocaleString()}`);
        console.log(`   - Engagement: ${engagementRate.toFixed(2)}%`);
      }
    } catch (error) {
      console.error(`❌ Error processing ${creator.name}:`, error);
    }

    // Delay if in FULL mode to respect rate limits, otherwise skip or use very small delay
    if (!isBasicMode) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  console.log(`\n✨ ${isBasicMode ? "BASIC" : "FULL"} refresh complete!`);
}

refreshAllStats()
  .catch((e) => {
    console.error("❌ Fatal Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
