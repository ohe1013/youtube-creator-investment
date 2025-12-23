// lib/creatorDisplay.ts
export const getDisplayName = (c: { name: string; nameKo?: string | null }) =>
  c.nameKo && c.nameKo.trim().length > 0 ? c.nameKo : c.name;

export type CreatorDisplay = {
  id: string;
  youtubeChannelId: string;

  name: string; // 원본
  nameKo: string | null; // 한국어 표기(있으면), 없으면 null
  displayName: string; // ✅ UI에서 쓸 최종 이름

  thumbnailUrl: string | null;

  category: string | null;
  country: string | null;

  currentSubs: number;
  currentViews: number;
  currentVideos: number;

  currentPrice: number;
};

export const toCreatorDisplay = (c: any): CreatorDisplay => ({
  id: c.id,
  youtubeChannelId: c.youtubeChannelId,

  name: c.name,
  nameKo: c.nameKo ?? null,
  displayName: getDisplayName(c),

  thumbnailUrl: c.thumbnailUrl ?? null,

  category: c.category ?? null,
  country: c.country ?? null,

  currentSubs: c.currentSubs ?? 0,
  currentViews: c.currentViews ?? 0,
  currentVideos: c.currentVideos ?? 0,

  currentPrice: c.currentPrice ?? 0,
});
