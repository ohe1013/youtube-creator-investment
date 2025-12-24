"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { CreatorInfo } from "@/components/market/CreatorInfo";

interface CreatorStat {
  date: string;
  subs: number;
  views: number;
  videos: number;
  dailySubsChange: number;
  dailyViewsChange: number;
}

interface Video {
  id: string;
  title: string;
  thumbnailUrl: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  duration: string;
  type: "LONG" | "SHORTS";
}

interface Creator {
  id: string;
  youtubeChannelId: string;
  name: string;
  thumbnailUrl: string | null;
  category: string | null;
  currentSubs: number;
  currentViews: number;
  currentVideos: number;
  currentScore: number;
  currentPrice: number;
  circulatingSupply: number;
  liquidity: number;
  avgLikes: number;
  avgComments: number;
  engagementRate: number;
  viewsPerSubs: number;
}

export default function CreatorDetailPage() {
  const { id } = useParams();
  const [creator, setCreator] = useState<Creator | null>(null);
  const [stats, setStats] = useState<CreatorStat[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    Promise.all([
      fetch(`/api/creators/${id}`).then((res) => {
        if (!res.ok) throw new Error("Creator not found");
        return res.json();
      }),
      fetch(`/api/creators/${id}?stats=true&days=90`).then((res) => {
        if (!res.ok) return { stats: [] };
        return res.json();
      }),
      fetch(`/api/creators/${id}?videos=true`).then((res) => {
        if (!res.ok) return { videos: [] };
        return res.json();
      }),
    ])
      .then(([creatorData, statsData, videosData]) => {
        setCreator(creatorData.creator);
        setStats(statsData.stats || []);
        setVideos(videosData.videos || []);
        setLoading(false);
      })

      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground text-2xl">로딩 중...</div>
      </div>
    );
  }

  if (error || !creator) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-down text-2xl mb-4">⚠️ 에러 발생</div>
          <p className="text-muted mb-4">
            {error || "크리에이터를 찾을 수 없습니다."}
          </p>
          <Link
            href="/creators"
            className="inline-block mt-4 px-6 py-3 bg-primary hover:opacity-90 text-background rounded-lg transition-colors font-bold"
          >
            목록으로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Trading Header Ticker */}
      <div className="bg-card border-b border-border-exchange px-6 py-3 flex flex-wrap items-center gap-8">
        <div className="flex items-center gap-3">
          <img
            src={creator.thumbnailUrl || ""}
            className="w-8 h-8 rounded-full border border-border-exchange"
            alt=""
          />
          <div>
            <div className="text-sm font-bold">{creator.name}/P</div>
            <div className="text-[10px] text-muted uppercase">
              {creator.category} Market
            </div>
          </div>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] text-muted">Last Price</span>
          <span className="text-sm font-bold text-up mono">
            {creator.currentPrice.toLocaleString()} P
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] text-muted">24h Change</span>
          <span className="text-sm font-bold text-up mono">+4.12%</span>
        </div>
        <div className="flex flex-col hidden sm:flex">
          <span className="text-[10px] text-muted">24h High</span>
          <span className="text-sm font-bold mono">
            {(creator.currentPrice * 1.05).toFixed(0)}
          </span>
        </div>
        <div className="flex flex-col hidden sm:flex">
          <span className="text-[10px] text-muted">24h Low</span>
          <span className="text-sm font-bold mono">
            {(creator.currentPrice * 0.98).toFixed(0)}
          </span>
        </div>
        <div className="flex flex-col hidden lg:flex">
          <span className="text-[10px] text-muted">24h Volume</span>
          <span className="text-sm font-bold mono">14,205 P</span>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row h-[calc(100vh-104px)]">
        /* Left: Chart and Info - Replaced with CreatorInfo */
        <div className="flex-1 border-r border-border-exchange overflow-hidden flex flex-col">
          <CreatorInfo creator={creator} stats={stats} videos={videos} />
        </div>
        {/* Right: Order Book and Trade Panel */}
        <div className="w-full lg:w-80 flex flex-col bg-background h-full border-t lg:border-t-0 border-border-exchange">
          {/* Simple Order Book Simul */}
          <div className="flex-1 p-4 border-b border-border-exchange overflow-y-auto">
            <div className="text-xs font-bold text-muted mb-4">Order Book</div>
            <div className="space-y-1">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex justify-between text-[11px] mono">
                  <span className="text-down">
                    {(creator.currentPrice * (1.005 + i * 0.002)).toFixed(0)}
                  </span>
                  <span className="">{(Math.random() * 10).toFixed(1)}</span>
                  <span className="text-muted">
                    {(Math.random() * 1000).toFixed(0)}
                  </span>
                </div>
              ))}
              <div className="py-2 text-center border-y border-border-exchange my-2">
                <span className="text-lg font-bold text-up mono">
                  {creator.currentPrice.toLocaleString()}
                </span>
              </div>
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex justify-between text-[11px] mono">
                  <span className="text-up">
                    {(creator.currentPrice * (0.995 - i * 0.002)).toFixed(0)}
                  </span>
                  <span className="">{(Math.random() * 10).toFixed(1)}</span>
                  <span className="text-muted">
                    {(Math.random() * 1000).toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Trade Execution */}
          <div className="p-4 bg-card">
            <div className="flex gap-1 mb-4">
              <button className="flex-1 py-2 bg-up text-background text-xs font-black rounded-sm">
                BUY
              </button>
              <button className="flex-1 py-2 bg-border-exchange text-muted text-xs font-black rounded-sm hover:text-foreground">
                SELL
              </button>
            </div>
            <div className="space-y-3">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-muted">
                  Price
                </span>
                <input
                  disabled
                  value={creator.currentPrice}
                  className="w-full bg-background border border-border-exchange rounded px-12 py-2 text-right text-sm mono"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted">
                  P
                </span>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-muted">
                  Amount
                </span>
                <input
                  type="number"
                  placeholder="0.0"
                  className="w-full bg-background border border-border-exchange rounded px-12 py-2 text-right text-sm mono focus:border-primary outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted">
                  UNI
                </span>
              </div>
              <button className="w-full py-3 bg-up text-background font-black text-sm rounded mt-2 hover:opacity-90 transition-opacity">
                Log In to Invest
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
