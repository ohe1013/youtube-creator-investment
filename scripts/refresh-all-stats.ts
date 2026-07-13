import "dotenv/config";

import { prisma } from "../lib/prisma";
import { refreshCreator } from "../lib/server/youtube/refresh-creator";
import { readYouTubeClient } from "../lib/server/youtube/youtube-client";

async function refreshAllStats() {
  if (process.argv.includes("--basic")) {
    console.warn(
      "--basic uses the authoritative refresh path so daily snapshots remain repeat-safe.",
    );
  }

  const youtube = readYouTubeClient();
  const creators = await prisma.creator.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      youtubeChannelId: true,
      currentSubs: true,
      currentViews: true,
      currentVideos: true,
    },
  });

  let refreshed = 0;
  let skipped = 0;
  for (const creator of creators) {
    try {
      if (await refreshCreator(creator, youtube)) {
        refreshed += 1;
        console.log(`Refreshed ${creator.name} (${creator.id}).`);
      } else {
        skipped += 1;
        console.warn(`Skipped ${creator.name} (${creator.id}): channel unavailable.`);
      }
    } catch {
      skipped += 1;
      console.warn(`Skipped ${creator.name} (${creator.id}): refresh failed.`);
    }
  }

  console.log(`Creator refresh complete: ${refreshed} refreshed, ${skipped} skipped.`);
}

refreshAllStats()
  .catch(() => {
    console.error("Creator refresh failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
