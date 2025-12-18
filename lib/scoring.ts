import { prisma } from "./prisma";

interface GrowthMetrics {
  subsGrowthRate: number;
  viewsGrowthRate: number;
  uploadFrequency: number;
}

/**
 * Calculate growth metrics for a creator over a specified period
 */
export async function getGrowthMetrics(
  creatorId: string,
  days: number = 30
): Promise<GrowthMetrics | null> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const stats = await prisma.creatorStat.findMany({
    where: {
      creatorId,
      date: {
        gte: startDate,
        lte: endDate,
      },
      period: "DAILY",
    },
    orderBy: {
      date: "asc",
    },
  });

  if (stats.length < 2) {
    return null;
  }

  const oldestStat = stats[0];
  const newestStat = stats[stats.length - 1];

  // Calculate growth rates
  const subsGrowthRate =
    oldestStat.subs > 0
      ? (newestStat.subs - oldestStat.subs) / oldestStat.subs
      : 0;

  const viewsGrowthRate =
    oldestStat.views > 0
      ? (newestStat.views - oldestStat.views) / oldestStat.views
      : 0;

  // Calculate upload frequency (videos per day)
  const videosDiff = newestStat.videos - oldestStat.videos;
  const uploadFrequency = videosDiff / days;

  return {
    subsGrowthRate,
    viewsGrowthRate,
    uploadFrequency,
  };
}

/**
 * Calculate growth score based on metrics
 * Score formula: 0.5 * subsGrowth + 0.3 * viewsGrowth + 0.2 * uploadFreq
 */
export function calculateGrowthScore(metrics: GrowthMetrics): number {
  const { subsGrowthRate, viewsGrowthRate, uploadFrequency } = metrics;

  // Normalize upload frequency (assume 1 video per day = 1.0)
  const normalizedUploadFreq = Math.min(uploadFrequency, 1.0);

  const score =
    0.5 * subsGrowthRate + 0.3 * viewsGrowthRate + 0.2 * normalizedUploadFreq;

  return score;
}

/**
 * Calculate virtual price based on score
 * Price formula: max(100, 1000 * score + 100)
 */
export function calculatePrice(score: number): number {
  const basePrice = 100;
  const scoreMultiplier = 1000;

  const price = basePrice + scoreMultiplier * score;

  // Minimum price is 100
  return Math.max(100, Math.round(price * 100) / 100);
}

/**
 * Update creator score and price based on latest stats
 */
export async function updateCreatorScoreAndPrice(
  creatorId: string
): Promise<void> {
  const metrics = await getGrowthMetrics(creatorId, 30);

  if (!metrics) {
    // Not enough data, set default values
    await prisma.creator.update({
      where: { id: creatorId },
      data: {
        currentScore: 0,
        currentPrice: 100,
      },
    });
    return;
  }

  const score = calculateGrowthScore(metrics);
  const price = calculatePrice(score);

  await prisma.creator.update({
    where: { id: creatorId },
    data: {
      currentScore: score,
      currentPrice: price,
    },
  });
}
