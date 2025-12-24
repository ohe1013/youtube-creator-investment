import * as dotenv from "dotenv";

dotenv.config();

interface YouTubeChannelStats {
  subscriberCount?: string;
  viewCount?: string;
  videoCount?: string;
}

type Thumbnail = { url: string; width?: number; height?: number };
type Thumbnails = {
  default?: Thumbnail;
  medium?: Thumbnail;
  high?: Thumbnail;
  standard?: Thumbnail;
  maxres?: Thumbnail;
};

interface YouTubeChannel {
  id: string;
  snippet: {
    title: string;
    description?: string;
    thumbnails?: Thumbnails;
    country?: string;
  };
  statistics: YouTubeChannelStats;
}

export interface ChannelData {
  channelId: string;
  name: string;
  thumbnailUrl?: string;
  country?: string;
  subs: number;
  views: number;
  videos: number;
}

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
  if (!YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY is not configured");

  try {
    const url =
      `${BASE_URL}/channels?part=snippet,statistics&id=${channelId}` +
      `&hl=ko&key=${YOUTUBE_API_KEY}`;

    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const channel: YouTubeChannel | undefined = data.items?.[0];

    if (!channel) return null;

    return {
      channelId: channel.id,
      name: channel.snippet?.title ?? "",
      thumbnailUrl: pickBestThumbnailUrl(channel.snippet?.thumbnails),
      country: channel.snippet?.country,
      subs: Number(channel.statistics?.subscriberCount ?? 0),
      views: Number(channel.statistics?.viewCount ?? 0),
      videos: Number(channel.statistics?.videoCount ?? 0),
    };
  } catch (error) {
    console.error("Error fetching YouTube channel stats:", error);
    return null;
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
    const data = await response.json();
    return (
      data.items?.map((item: any) => item.id?.channelId).filter(Boolean) || []
    );
  } catch (error) {
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
): Promise<any[]> {
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

    const plData = await plResponse.json();
    const videoIds = plData.items
      ?.map((item: any) => item.contentDetails.videoId)
      .join(",");

    if (!videoIds) return [];

    // 3. Fetch Full Details to get Statistics & Duration (Cheap: 1 unit)
    const detailsUrl = `${BASE_URL}/videos?part=snippet,statistics,contentDetails&id=${videoIds}&key=${YOUTUBE_API_KEY}`;

    const detailsResponse = await fetch(detailsUrl);
    if (!detailsResponse.ok) return [];

    const detailsData = await detailsResponse.json();

    return (
      detailsData.items?.map((video: any) => {
        const durationStr = video.contentDetails.duration;
        const durationSec = parseDurationInSeconds(durationStr);

        return {
          id: video.id,
          title: video.snippet.title,
          thumbnailUrl: pickBestThumbnailUrl(video.snippet.thumbnails),
          publishedAt: video.snippet.publishedAt,
          viewCount: Number(video.statistics.viewCount || 0),
          likeCount: Number(video.statistics.likeCount || 0),
          commentCount: Number(video.statistics.commentCount || 0),
          duration: durationStr,
          type: durationSec <= 60 ? "SHORTS" : "LONG",
        };
      }) || []
    );
  } catch (error) {
    console.error("Error fetching recent videos:", error);
    return [];
  }
}
