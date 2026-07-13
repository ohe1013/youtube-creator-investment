import "server-only";

import { prisma } from "@/lib/prisma";
import type { YouTubeClient } from "@/lib/server/youtube/youtube-client";

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
      const existing = await tx.video.findUnique({
        where: { id: video.id },
        select: { creatorId: true },
      });
      if (existing && existing.creatorId !== creator.id) continue;
      await tx.video.upsert({
        where: { id: video.id },
        update: {
          title: video.title,
          thumbnailUrl: video.thumbnailUrl,
          publishedAt: new Date(video.publishedAt),
          duration: video.duration,
          type: video.type,
          viewCount: video.viewCount,
          likeCount: video.likeCount,
          commentCount: video.commentCount,
        },
        create: {
          id: video.id,
          creatorId: creator.id,
          title: video.title,
          thumbnailUrl: video.thumbnailUrl,
          publishedAt: new Date(video.publishedAt),
          duration: video.duration,
          type: video.type,
          viewCount: video.viewCount,
          likeCount: video.likeCount,
          commentCount: video.commentCount,
        },
      });
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
