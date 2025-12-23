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
  name: string; // 원본 title
  nameKo?: string; // 한글 포함 시에만 채움
  thumbnailUrl?: string; // best thumbnail, 없을 수 있음
  country?: string;
  subs: number;
  views: number;
  videos: number;
}

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const BASE_URL = "https://www.googleapis.com/youtube/v3";

const hasHangul = (s: string) => /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(s);

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

export async function getChannelStats(
  channelId: string
): Promise<ChannelData | null> {
  if (!YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY is not configured");

  try {
    // hl=ko : 응답 언어 힌트(타이틀이 반드시 한국어로 바뀌는 건 아님)
    const url =
      `${BASE_URL}/channels?part=snippet,statistics&id=${channelId}` +
      `&hl=ko&key=${YOUTUBE_API_KEY}`;

    const response = await fetch(url);

    if (!response.ok) {
      console.error(
        `YouTube API error: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const data = await response.json();
    const channel: YouTubeChannel | undefined = data.items?.[0];

    if (!channel) {
      console.error(`Channel not found: ${channelId}`);
      return null;
    }

    const title = channel.snippet?.title ?? "";
    const thumbnailUrl = pickBestThumbnailUrl(channel.snippet?.thumbnails);

    return {
      channelId: channel.id,
      name: title,
      // ✅ 한글 포함일 때만 nameKo
      nameKo: hasHangul(title) ? title : undefined,
      // ✅ best thumbnail (없을 수 있음)
      thumbnailUrl,
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
      `${BASE_URL}/search?part=snippet&type=channel` +
      `&q=${encodeURIComponent(query)}` +
      `&maxResults=${maxResults}` +
      `&order=${order}` +
      // ✅ 한국 타겟팅(검색결과 품질 개선)
      `&relevanceLanguage=ko&regionCode=KR&hl=ko` +
      `&key=${YOUTUBE_API_KEY}`;

    const response = await fetch(url);

    if (!response.ok) {
      console.error(
        `YouTube API error: ${response.status} ${response.statusText}`
      );
      return [];
    }

    const data = await response.json();

    // ✅ Search API에서 채널ID는 item.id.channelId 가 정석
    return (
      data.items?.map((item: any) => item.id?.channelId).filter(Boolean) || []
    );
  } catch (error) {
    console.error("Error searching YouTube channels:", error);
    return [];
  }
}
