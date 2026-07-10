import * as dotenv from "dotenv";
import { z } from "zod";

import type { CreatorVideo } from "@/lib/data/contracts";

dotenv.config();

const thumbnailSchema = z.object({
  url: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const thumbnailsSchema = z.object({
  default: thumbnailSchema.optional(),
  medium: thumbnailSchema.optional(),
  high: thumbnailSchema.optional(),
  standard: thumbnailSchema.optional(),
  maxres: thumbnailSchema.optional(),
});

type Thumbnails = z.infer<typeof thumbnailsSchema>;

const countSchema = z.coerce
  .number()
  .finite()
  .nonnegative()
  .optional()
  .default(0);

const channelListResponseSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z
          .object({
            title: z.string().optional(),
            thumbnails: thumbnailsSchema.optional(),
            country: z.string().optional(),
          })
          .optional(),
        statistics: z
          .object({
            subscriberCount: countSchema,
            viewCount: countSchema,
            videoCount: countSchema,
          })
          .optional(),
      })
    )
    .optional(),
});

const channelSearchResponseSchema = z.object({
  items: z
    .array(
      z.object({
        id: z
          .object({
            channelId: z.string().optional(),
          })
          .optional(),
      })
    )
    .optional(),
});

const playlistResponseSchema = z.object({
  items: z
    .array(
      z.object({
        contentDetails: z
          .object({
            videoId: z.string(),
          })
          .optional(),
      })
    )
    .optional(),
});

const videoDetailsResponseSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z.object({
          title: z.string(),
          thumbnails: thumbnailsSchema.optional(),
          publishedAt: z.string(),
        }),
        statistics: z
          .object({
            viewCount: countSchema,
            likeCount: countSchema,
            commentCount: countSchema,
          })
          .optional(),
        contentDetails: z.object({
          duration: z.string(),
        }),
      })
    )
    .optional(),
});

export interface ChannelData {
  channelId: string;
  name: string;
  thumbnailUrl?: string;
  country?: string;
  subs: number;
  views: number;
  videos: number;
}

export type RecentVideo = Pick<
  CreatorVideo,
  | "id"
  | "title"
  | "thumbnailUrl"
  | "publishedAt"
  | "viewCount"
  | "likeCount"
  | "commentCount"
  | "duration"
  | "type"
>;

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const BASE_URL = "https://www.googleapis.com/youtube/v3";

const pickBestThumbnailUrl = (thumbnails?: Thumbnails) => {
  return (
    thumbnails?.maxres?.url ||
    thumbnails?.standard?.url ||
    thumbnails?.high?.url ||
    thumbnails?.medium?.url ||
    thumbnails?.default?.url ||
    undefined
  );
};

// Helper: Parse Duration to Seconds
const parseDurationInSeconds = (duration: string) => {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || "0");
  const minutes = parseInt(match[2] || "0");
  const seconds = parseInt(match[3] || "0");
  return hours * 3600 + minutes * 60 + seconds;
};

export async function getChannelStats(
  channelId: string
): Promise<ChannelData | null> {
  const results = await getChannelsStats([channelId]);
  return results[0] || null;
}

export async function getChannelsStats(
  channelIds: string[]
): Promise<ChannelData[]> {
  if (!YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY is not configured");
  if (channelIds.length === 0) return [];

  try {
    // YouTube API allows up to 50 IDs per call
    const chunks = [];
    for (let i = 0; i < channelIds.length; i += 50) {
      chunks.push(channelIds.slice(i, i + 50));
    }

    const allResults: ChannelData[] = [];

    for (const chunk of chunks) {
      const url =
        `${BASE_URL}/channels?part=snippet,statistics&id=${chunk.join(",")}` +
        `&hl=ko&key=${YOUTUBE_API_KEY}`;

      const response = await fetch(url);
      if (!response.ok) continue;

      const data: unknown = await response.json();
      const parsed = channelListResponseSchema.safeParse(data);
      if (!parsed.success) continue;

      const mapped = (parsed.data.items ?? []).map((channel) => ({
        channelId: channel.id,
        name: channel.snippet?.title ?? "",
        thumbnailUrl: pickBestThumbnailUrl(channel.snippet?.thumbnails),
        country: channel.snippet?.country,
        subs: channel.statistics?.subscriberCount ?? 0,
        views: channel.statistics?.viewCount ?? 0,
        videos: channel.statistics?.videoCount ?? 0,
      }));

      allResults.push(...mapped);
    }

    return allResults;
  } catch (error) {
    console.error("Error fetching batched YouTube channel stats:", error);
    return [];
  }
}

export async function searchChannels(
  query: string,
  options: {
    maxResults?: number;
    order?: "relevance" | "viewCount" | "date";
  } = {}
): Promise<string[]> {
  if (!YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY is not configured");
  const { maxResults = 10, order = "relevance" } = options;
  try {
    const url =
      `${BASE_URL}/search?part=snippet&type=channel&q=${encodeURIComponent(
        query
      )}` +
      `&maxResults=${maxResults}&order=${order}&relevanceLanguage=ko&regionCode=KR&hl=ko&key=${YOUTUBE_API_KEY}`;

    const response = await fetch(url);
    if (!response.ok) return [];
    const data: unknown = await response.json();
    const parsed = channelSearchResponseSchema.safeParse(data);
    if (!parsed.success) return [];

    return (parsed.data.items ?? []).flatMap((item) =>
      item.id?.channelId ? [item.id.channelId] : []
    );
  } catch {
    return [];
  }
}

/**
 * Optimized Video Sync: Uses PlaylistItems (UC... -> UU...)
 * This is 100x cheaper than Search API.
 */
export async function getRecentVideos(
  channelId: string,
  maxResults: number = 20
): Promise<RecentVideo[]> {
  if (!YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY is not configured");

  try {
    // 1. Convert Channel ID to Uploads Playlist ID (UC... -> UU...)
    const uploadsPlaylistId = channelId.replace(/^UC/, "UU");

    // 2. Fetch Playlist Items (Cheap: 1 unit)
    const playlistUrl =
      `${BASE_URL}/playlistItems?part=snippet,contentDetails&playlistId=${uploadsPlaylistId}` +
      `&maxResults=${maxResults}&key=${YOUTUBE_API_KEY}`;

    const plResponse = await fetch(playlistUrl);
    if (!plResponse.ok) return [];

    const playlistData: unknown = await plResponse.json();
    const parsedPlaylist = playlistResponseSchema.safeParse(playlistData);
    if (!parsedPlaylist.success) return [];

    const videoIds = (parsedPlaylist.data.items ?? [])
      .flatMap((item) =>
        item.contentDetails?.videoId ? [item.contentDetails.videoId] : []
      )
      .join(",");

    if (!videoIds) return [];

    // 3. Fetch Full Details to get Statistics & Duration (Cheap: 1 unit)
    const detailsUrl = `${BASE_URL}/videos?part=snippet,statistics,contentDetails&id=${videoIds}&key=${YOUTUBE_API_KEY}`;

    const detailsResponse = await fetch(detailsUrl);
    if (!detailsResponse.ok) return [];

    const detailsData: unknown = await detailsResponse.json();
    const parsedDetails = videoDetailsResponseSchema.safeParse(detailsData);
    if (!parsedDetails.success) return [];

    return (parsedDetails.data.items ?? []).map((video) => {
      const durationStr = video.contentDetails.duration;
      const durationSec = parseDurationInSeconds(durationStr);

      return {
        id: video.id,
        title: video.snippet.title,
        thumbnailUrl: pickBestThumbnailUrl(video.snippet.thumbnails) ?? null,
        publishedAt: video.snippet.publishedAt,
        viewCount: video.statistics?.viewCount ?? 0,
        likeCount: video.statistics?.likeCount ?? 0,
        commentCount: video.statistics?.commentCount ?? 0,
        duration: durationStr,
        type: durationSec <= 60 ? "SHORTS" : "LONG",
      };
    });
  } catch (error) {
    console.error("Error fetching recent videos:", error);
    return [];
  }
}
