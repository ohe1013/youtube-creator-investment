import { readServerEnv } from "@/lib/config/server-env";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/server/http/api-error";
import { requireCronSecret } from "@/lib/server/http/cron-auth";
import { corsPreflight, withApiRoute } from "@/lib/server/http/route-handler";
import { refreshCreator } from "@/lib/server/youtube/refresh-creator";
import { readYouTubeClient } from "@/lib/server/youtube/youtube-client";

export const POST = withApiRoute(async (request) => {
  requireCronSecret(request);
  if (!readServerEnv().youtubeApiKey) {
    throw new ApiError(
      503,
      "YOUTUBE_UNAVAILABLE",
      "YouTube refresh is not configured.",
      undefined,
      true,
    );
  }
  const youtube = readYouTubeClient();
  const creators = await prisma.creator.findMany({
    where: { isActive: true },
    select: {
      id: true,
      youtubeChannelId: true,
      name: true,
      currentSubs: true,
      currentViews: true,
      currentVideos: true,
    },
  });

  let refreshed = 0;
  let skipped = 0;
  for (const creator of creators) {
    try {
      if (await refreshCreator(creator, youtube)) refreshed += 1;
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return Response.json({ refreshed, skipped });
});

export const OPTIONS = corsPreflight;
