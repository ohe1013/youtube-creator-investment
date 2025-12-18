interface YouTubeChannelStats {
  subscriberCount: string;
  viewCount: string;
  videoCount: string;
}

interface YouTubeChannel {
  id: string;
  snippet: {
    title: string;
    description: string;
    thumbnails: {
      default: { url: string };
      medium: { url: string };
      high: { url: string };
    };
    country?: string;
  };
  statistics: YouTubeChannelStats;
}

export interface ChannelData {
  channelId: string;
  name: string;
  thumbnailUrl: string;
  country?: string;
  subs: number;
  views: number;
  videos: number;
}

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const BASE_URL = "https://www.googleapis.com/youtube/v3";

export async function getChannelStats(
  channelId: string
): Promise<ChannelData | null> {
  if (!YOUTUBE_API_KEY) {
    throw new Error("YOUTUBE_API_KEY is not configured");
  }

  try {
    const url = `${BASE_URL}/channels?part=snippet,statistics&id=${channelId}&key=${YOUTUBE_API_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(
        `YouTube API error: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      console.error(`Channel not found: ${channelId}`);
      return null;
    }

    const channel: YouTubeChannel = data.items[0];

    return {
      channelId: channel.id,
      name: channel.snippet.title,
      thumbnailUrl: channel.snippet.thumbnails.high.url,
      country: channel.snippet.country,
      subs: parseInt(channel.statistics.subscriberCount, 10),
      views: parseInt(channel.statistics.viewCount, 10),
      videos: parseInt(channel.statistics.videoCount, 10),
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
  if (!YOUTUBE_API_KEY) {
    throw new Error("YOUTUBE_API_KEY is not configured");
  }

  const { maxResults = 10, order = "relevance" } = options;

  try {
    const url = `${BASE_URL}/search?part=snippet&type=channel&q=${encodeURIComponent(
      query
    )}&maxResults=${maxResults}&order=${order}&key=${YOUTUBE_API_KEY}`;

    const response = await fetch(url);

    if (!response.ok) {
      console.error(
        `YouTube API error: ${response.status} ${response.statusText}`
      );
      return [];
    }

    const data = await response.json();

    return data.items?.map((item: any) => item.snippet.channelId) || [];
  } catch (error) {
    console.error("Error searching YouTube channels:", error);
    return [];
  }
}
