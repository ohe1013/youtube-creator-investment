"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface Creator {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  category: string | null;
  currentSubs: number;
  currentViews: number;
  currentVideos: number;
  currentScore: number;
  currentPrice: number;
}

export default function CreatorDetailPage() {
  const { id } = useParams();
  const [creator, setCreator] = useState<Creator | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    fetch(`/api/creators/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Creator not found");
        return res.json();
      })
      .then((data) => {
        setCreator(data.creator);
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
        {/* Left: Chart and Info */}
        <div className="flex-1 flex flex-col border-r border-border-exchange">
          {/* Chart Area */}
          <div className="flex-1 bg-card relative">
            <div className="absolute top-4 left-4 z-10 flex gap-2">
              <button className="px-2 py-1 bg-border-exchange text-primary text-[10px] rounded font-bold">
                Time
              </button>
              <button className="px-2 py-1 text-muted text-[10px]">15m</button>
              <button className="px-2 py-1 text-muted text-[10px]">1h</button>
              <button className="px-2 py-1 text-muted text-[10px]">4h</button>
              <button className="px-2 py-1 text-muted text-[10px]">1D</button>
              <button className="px-2 py-1 text-muted text-[10px]">
                Indicators
              </button>
            </div>

            <div className="w-full h-full flex items-center justify-center opacity-20">
              <div className="text-center">
                <div className="text-6xl mb-4 text-foreground">📈</div>
                <p className="text-xl font-bold mono text-foreground">
                  ADVANCED CHART LOADING...
                </p>
                <p className="text-sm text-muted">
                  Real-time growth visualization
                </p>
              </div>
            </div>

            {/* Watermark-like info */}
            <div className="absolute bottom-6 left-6 pointer-events-none opacity-5">
              <h2 className="text-8xl font-black italic">{creator.name}</h2>
            </div>
          </div>

          {/* Bottom Tabs: Stats/Info */}
          <div className="h-48 border-t border-border-exchange bg-background">
            <div className="flex border-b border-border-exchange">
              <button className="px-6 py-2 text-xs font-bold text-primary border-b-2 border-primary">
                Market Stats
              </button>
              <button className="px-6 py-2 text-xs font-bold text-muted hover:text-foreground">
                Channel Info
              </button>
            </div>
            <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <div className="text-[10px] text-muted uppercase mb-1">
                  Growth Score
                </div>
                <div className="text-lg font-bold text-up mono">
                  {creator.currentScore.toFixed(1)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted uppercase mb-1">
                  Subscribers
                </div>
                <div className="text-lg font-bold mono">
                  {creator.currentSubs.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted uppercase mb-1">
                  Total Views
                </div>
                <div className="text-lg font-bold mono">
                  {creator.currentViews.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted uppercase mb-1">
                  Video Count
                </div>
                <div className="text-lg font-bold mono">
                  {creator.currentVideos.toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Order Book and Trade Panel */}
        <div className="w-full lg:w-80 flex flex-col bg-background">
          {/* Simple Order Book Simul */}
          <div className="flex-1 p-4 border-b border-border-exchange">
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
