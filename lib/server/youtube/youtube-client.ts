import "server-only";

import { z } from "zod";

import { readServerEnv } from "@/lib/config/server-env";
import { ApiError } from "@/lib/server/http/api-error";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

const thumbnailSchema = z.object({ url: z.string().url() });
const thumbnailsSchema = z.object({
  default: thumbnailSchema.optional(),
  medium: thumbnailSchema.optional(),
  high: thumbnailSchema.optional(),
  standard: thumbnailSchema.optional(),
  maxres: thumbnailSchema.optional(),
});
const countSchema = z.coerce.number().finite().nonnegative().optional().default(0);
const channelListResponseSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
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
      }),
    )
    .default([]),
});
const channelSearchResponseSchema = z.object({
  items: z
    .array(z.object({ id: z.object({ channelId: z.string().min(1).optional() }).optional() }))
    .default([]),
});
const playlistResponseSchema = z.object({
  items: z
    .array(z.object({ contentDetails: z.object({ videoId: z.string().min(1) }).optional() }))
    .default([]),
});
const videoDetailsResponseSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        snippet: z.object({
          title: z.string().min(1),
          thumbnails: thumbnailsSchema.optional(),
          publishedAt: z.string().datetime({ offset: true }),
        }),
        statistics: z
          .object({
            viewCount: countSchema,
            likeCount: countSchema,
            commentCount: countSchema,
          })
          .optional(),
        contentDetails: z.object({ duration: z.string().min(1) }),
      }),
    )
    .default([]),
});

export type ChannelData = {
  channelId: string;
  name: string;
  thumbnailUrl?: string;
  country?: string;
  subs: number;
  views: number;
  videos: number;
};

export type RecentVideo = {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  publishedAt: string;
  duration: string;
  type: "LONG" | "SHORTS";
  viewCount: number;
  likeCount: number;
  commentCount: number;
};

export type YouTubeClient = {
  getChannelStats(channelId: string): Promise<ChannelData | null>;
  getChannelsStats(channelIds: string[]): Promise<ChannelData[]>;
  searchChannels(
    query: string,
    options?: { maxResults?: number; order?: "relevance" | "viewCount" | "date" },
  ): Promise<string[]>;
  getRecentVideos(channelId: string, maxResults?: number): Promise<RecentVideo[]>;
};

function pickThumbnail(thumbnails?: z.infer<typeof thumbnailsSchema>): string | undefined {
  return (
    thumbnails?.maxres?.url ??
    thumbnails?.standard?.url ??
    thumbnails?.high?.url ??
    thumbnails?.medium?.url ??
    thumbnails?.default?.url
  );
}

function durationSeconds(duration: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(duration);
  if (!match) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

function endpoint(path: string, key: string, query: Record<string, string>): string {
  const url = new URL(`${YOUTUBE_API_BASE}/${path}`);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  url.searchParams.set("key", key);
  return url.toString();
}

export function createYouTubeClient(input: {
  apiKey: string;
  fetchFn?: typeof fetch;
}): YouTubeClient {
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    throw new ApiError(
      503,
      "YOUTUBE_UNAVAILABLE",
      "YouTube refresh is not configured.",
      undefined,
      true,
    );
  }
  const fetchFn = input.fetchFn ?? fetch;

  const requestJson = async (url: string): Promise<unknown | null> => {
    try {
      const response = await fetchFn(url, { method: "GET", credentials: "omit" });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  };

  return {
    async getChannelStats(channelId) {
      const channels = await this.getChannelsStats([channelId]);
      return channels[0] ?? null;
    },
    async getChannelsStats(channelIds) {
      if (channelIds.length === 0) return [];
      const results: ChannelData[] = [];
      for (let start = 0; start < channelIds.length; start += 50) {
        const body = await requestJson(
          endpoint("channels", apiKey, {
            part: "snippet,statistics",
            id: channelIds.slice(start, start + 50).join(","),
            hl: "ko",
          }),
        );
        const parsed = channelListResponseSchema.safeParse(body);
        if (!parsed.success) continue;
        results.push(
          ...parsed.data.items.map((channel) => ({
            channelId: channel.id,
            name: channel.snippet?.title ?? "",
            thumbnailUrl: pickThumbnail(channel.snippet?.thumbnails),
            country: channel.snippet?.country,
            subs: channel.statistics?.subscriberCount ?? 0,
            views: channel.statistics?.viewCount ?? 0,
            videos: channel.statistics?.videoCount ?? 0,
          })),
        );
      }
      return results;
    },
    async searchChannels(query, options = {}) {
      const body = await requestJson(
        endpoint("search", apiKey, {
          part: "snippet",
          type: "channel",
          q: query,
          maxResults: String(options.maxResults ?? 10),
          order: options.order ?? "relevance",
          relevanceLanguage: "ko",
          regionCode: "KR",
          hl: "ko",
        }),
      );
      const parsed = channelSearchResponseSchema.safeParse(body);
      if (!parsed.success) return [];
      return parsed.data.items.flatMap((item) => item.id?.channelId ? [item.id.channelId] : []);
    },
    async getRecentVideos(channelId, maxResults = 20) {
      const playlist = await requestJson(
        endpoint("playlistItems", apiKey, {
          part: "snippet,contentDetails",
          playlistId: channelId.replace(/^UC/, "UU"),
          maxResults: String(maxResults),
        }),
      );
      const parsedPlaylist = playlistResponseSchema.safeParse(playlist);
      if (!parsedPlaylist.success) return [];
      const ids = parsedPlaylist.data.items.flatMap((item) =>
        item.contentDetails?.videoId ? [item.contentDetails.videoId] : [],
      );
      if (ids.length === 0) return [];
      const details = await requestJson(
        endpoint("videos", apiKey, {
          part: "snippet,statistics,contentDetails",
          id: ids.join(","),
        }),
      );
      const parsedDetails = videoDetailsResponseSchema.safeParse(details);
      if (!parsedDetails.success) return [];
      return parsedDetails.data.items.map((video) => ({
        id: video.id,
        title: video.snippet.title,
        thumbnailUrl: pickThumbnail(video.snippet.thumbnails) ?? null,
        publishedAt: video.snippet.publishedAt,
        duration: video.contentDetails.duration,
        type: durationSeconds(video.contentDetails.duration) <= 60 ? "SHORTS" : "LONG",
        viewCount: video.statistics?.viewCount ?? 0,
        likeCount: video.statistics?.likeCount ?? 0,
        commentCount: video.statistics?.commentCount ?? 0,
      }));
    },
  };
}

export function readYouTubeClient(): YouTubeClient {
  const apiKey = readServerEnv().youtubeApiKey;
  if (!apiKey) {
    throw new ApiError(
      503,
      "YOUTUBE_UNAVAILABLE",
      "YouTube refresh is not configured.",
      undefined,
      true,
    );
  }
  return createYouTubeClient({ apiKey });
}

export async function getChannelStats(channelId: string) {
  return await readYouTubeClient().getChannelStats(channelId);
}

export async function getChannelsStats(channelIds: string[]) {
  return await readYouTubeClient().getChannelsStats(channelIds);
}

export async function searchChannels(
  query: string,
  options?: { maxResults?: number; order?: "relevance" | "viewCount" | "date" },
) {
  return await readYouTubeClient().searchChannels(query, options);
}

export async function getRecentVideos(channelId: string, maxResults?: number) {
  return await readYouTubeClient().getRecentVideos(channelId, maxResults);
}
