import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type {
  RecentVideo,
  YouTubeClient,
} from "@/lib/server/youtube/youtube-client";

function utcDay(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

type RefreshableCreator = {
  id: string;
  youtubeChannelId: string;
  name: string;
  currentSubs: number;
  currentViews: number;
  currentVideos: number;
};

type CreatorVideoStore = Pick<Prisma.TransactionClient, "video">;

export async function persistCreatorVideo(
  store: CreatorVideoStore,
  creatorId: string,
  video: RecentVideo,
): Promise<void> {
  const data = {
    title: video.title,
    thumbnailUrl: video.thumbnailUrl,
    publishedAt: new Date(video.publishedAt),
    duration: video.duration,
    type: video.type,
    viewCount: video.viewCount,
    likeCount: video.likeCount,
    commentCount: video.commentCount,
  };

  const ownVideo = await store.video.updateMany({
    where: { id: video.id, creatorId },
    data,
  });
  if (ownVideo.count > 0) return;

  await store.video.createMany({
    data: [{ id: video.id, creatorId, ...data }],
    skipDuplicates: true,
  });
}

export async function refreshCreator(
  creator: RefreshableCreator,
  youtube: YouTubeClient,
): Promise<boolean> {
  const stats = await youtube.getChannelStats(creator.youtubeChannelId);
  if (!stats) return false;

  const videos = await youtube.getRecentVideos(creator.youtubeChannelId);
  const day = utcDay();
  const totalViews = videos.reduce((sum, video) => sum + video.viewCount, 0);
  const totalLikes = videos.reduce((sum, video) => sum + video.likeCount, 0);
  const totalComments = videos.reduce((sum, video) => sum + video.commentCount, 0);
  const avgLikes = videos.length > 0 ? totalLikes / videos.length : 0;
  const avgComments = videos.length > 0 ? totalComments / videos.length : 0;
  const engagementRate = totalViews > 0 ? ((totalLikes + totalComments) / totalViews) * 100 : 0;
  const viewsPerSubs = stats.subs > 0 && videos.length > 0
    ? (totalViews / videos.length / stats.subs) * 100
    : 0;

  await prisma.$transaction(async (tx) => {
    for (const video of videos) {
      await persistCreatorVideo(tx, creator.id, video);
    }

    await tx.creatorStat.upsert({
      where: {
        creatorId_date_period: {
          creatorId: creator.id,
          date: day,
          period: "DAILY",
        },
      },
      update: {
        subs: stats.subs,
        views: stats.views,
        videos: stats.videos,
        dailySubsChange: stats.subs - creator.currentSubs,
        dailyViewsChange: stats.views - creator.currentViews,
        avgLikes,
        avgComments,
        totalLikes,
        totalComments,
      },
      create: {
        creatorId: creator.id,
        date: day,
        period: "DAILY",
        subs: stats.subs,
        views: stats.views,
        videos: stats.videos,
        dailySubsChange: stats.subs - creator.currentSubs,
        dailyViewsChange: stats.views - creator.currentViews,
        avgLikes,
        avgComments,
        totalLikes,
        totalComments,
      },
    });

    await tx.creator.update({
      where: { id: creator.id },
      data: {
        currentSubs: stats.subs,
        currentViews: stats.views,
        currentVideos: stats.videos,
        name: stats.name || creator.name,
        thumbnailUrl: stats.thumbnailUrl,
        avgLikes,
        avgComments,
        engagementRate,
        viewsPerSubs,
        lastSyncedAt: new Date(),
      },
    });
  });
  return true;
}

export { utcDay };
