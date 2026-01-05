"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { CreatorInfo } from "@/components/market/CreatorInfo";
import { OrderBook } from "@/components/market/OrderBook";
import { RecentTrades } from "@/components/market/RecentTrades";
import { MarketChart } from "@/components/market/MarketChart";

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

interface Trade {
  id: string;
  price: number;
  quantity: number;
  createdAt: string;
  type: "BUY" | "SELL";
}

interface HistoryPoint {
  date: string;
  price: number;
  volume: number;
}

export default function CreatorDetailPage() {
  const { id } = useParams();
  const { update } = useSession();
  const [creator, setCreator] = useState<Creator | null>(null);
  const [stats, setStats] = useState<CreatorStat[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [orderBook, setOrderBook] = useState<{ asks: any[]; bids: any[] }>({
    asks: [],
    bids: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Trade State
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"LIMIT" | "MARKET">("LIMIT");
  const [inputPrice, setInputPrice] = useState("");
  const [inputQuantity, setInputQuantity] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;

    const fetchData = () => {
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
        fetch(`/api/creators/${id}?history=true&days=7`).then((res) => {
          if (!res.ok) return { history: [] };
          return res.json();
        }),
        fetch(`/api/creators/${id}?trades=true`).then((res) => {
          if (!res.ok) return { trades: [] };
          return res.json();
        }),
        fetch(`/api/creators/${id}?orderbook=true`).then((res) => {
          if (!res.ok) return { asks: [], bids: [] };
          return res.json();
        }),
      ])
        .then(
          ([
            creatorData,
            statsData,
            videosData,
            historyData,
            tradesData,
            obData,
          ]) => {
            setCreator(creatorData.creator);
            setStats(statsData.stats || []);
            setVideos(videosData.videos || []);
            setHistory(historyData.history || []);
            setTrades(tradesData.trades || []);
            setOrderBook({ asks: obData.asks || [], bids: obData.bids || [] });
            setLoading(false);
          }
        )
        .catch((err) => {
          setError(err.message);
          setLoading(false);
        });
    };

    fetchData();
    const interval = setInterval(fetchData, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, [id]);

  useEffect(() => {
    if (creator && !inputPrice) {
      setInputPrice(creator.currentPrice.toString());
    }
  }, [creator?.currentPrice]);

  const { change24h, high24h, low24h, volume24h } = useMemo(() => {
    if (history.length === 0)
      return { change24h: 0, high24h: 0, low24h: 100, volume24h: 0 };

    const prices = history.map((h) => h.price);
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const volume = history.reduce((sum, h) => sum + (h.volume || 0), 0);

    const firstPrice = history[0].price;
    const lastPrice = history[history.length - 1].price;
    const change = ((lastPrice - firstPrice) / firstPrice) * 100;

    return { change24h: change, high24h: high, low24h: low, volume24h: volume };
  }, [history]);

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

  const handleTrade = async () => {
    if (!creator) return;
    setIsSubmitting(true);
    try {
      const p =
        orderType === "MARKET" ? creator.currentPrice : Number(inputPrice);
      const res = await fetch("/api/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creatorId: creator.id,
          side,
          orderType,
          price: p,
          quantity: Number(inputQuantity),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Trade failed");

      alert(`Order Placed: ${side} ${inputQuantity} @ ${p}`);

      // Update session to reflect balance change in Navbar
      await update?.();

      setInputQuantity("");
    } catch (e: any) {
      alert(e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isPositive = change24h >= 0;

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
          <span
            className={`text-sm font-bold mono ${
              isPositive ? "text-up" : "text-down"
            }`}
          >
            {creator.currentPrice.toLocaleString()} P
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] text-muted">24h Change</span>
          <span
            className={`text-sm font-bold mono ${
              isPositive ? "text-up" : "text-down"
            }`}
          >
            {isPositive ? "+" : ""}
            {change24h.toFixed(2)}%
          </span>
        </div>
        <div className="flex flex-col hidden sm:flex">
          <span className="text-[10px] text-muted">24h High</span>
          <span className="text-sm font-bold mono">
            {high24h.toLocaleString()}
          </span>
        </div>
        <div className="flex flex-col hidden sm:flex">
          <span className="text-[10px] text-muted">24h Low</span>
          <span className="text-sm font-bold mono">
            {low24h.toLocaleString()}
          </span>
        </div>
        <div className="flex flex-col hidden lg:flex">
          <span className="text-[10px] text-muted">24h Volume</span>
          <span className="text-sm font-bold mono">
            {volume24h.toLocaleString()} P
          </span>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row h-[calc(100vh-104px)]">
        {/* Left: Chart and Info */}
        <div className="flex-1 border-r border-border-exchange overflow-hidden flex flex-col min-w-0">
          <div className="h-[450px] border-b border-border-exchange">
            <MarketChart data={history} />
          </div>
          <div className="flex-1 overflow-y-auto">
            <CreatorInfo creator={creator} stats={stats} videos={videos} />
          </div>
        </div>
        {/* Right: Order Book and Trade Panel */}
        <div className="w-full lg:w-80 flex flex-col bg-background h-full border-t lg:border-t-0 border-border-exchange">
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="h-1/2 overflow-y-auto border-b border-border-exchange">
              <OrderBook
                currentPrice={creator.currentPrice}
                liquidity={creator.liquidity}
                asks={orderBook.asks}
                bids={orderBook.bids}
              />
            </div>
            <div className="h-1/2 overflow-y-auto">
              <RecentTrades
                trades={trades.map((t) => ({
                  id: t.id,
                  price: t.price,
                  quantity: t.quantity,
                  time: new Date(t.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  }),
                  type: t.type,
                }))}
              />
            </div>
          </div>

          {/* Trade Execution */}
          <div className="p-4 bg-card border-t border-border-exchange">
            <div className="flex gap-1 mb-4">
              <button
                onClick={() => setSide("BUY")}
                className={`flex-1 py-2 text-xs font-black rounded-sm transition-colors ${
                  side === "BUY"
                    ? "bg-up text-background"
                    : "bg-border-exchange text-muted hover:text-foreground"
                }`}
              >
                BUY
              </button>
              <button
                onClick={() => setSide("SELL")}
                className={`flex-1 py-2 text-xs font-black rounded-sm transition-colors ${
                  side === "SELL"
                    ? "bg-down text-background"
                    : "bg-border-exchange text-muted hover:text-foreground"
                }`}
              >
                SELL
              </button>
            </div>

            <div className="flex gap-2 mb-2">
              <button
                onClick={() => setOrderType("LIMIT")}
                className={`flex-1 text-[10px] py-1 border ${
                  orderType === "LIMIT"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted"
                }`}
              >
                Limit
              </button>
              <button
                onClick={() => setOrderType("MARKET")}
                className={`flex-1 text-[10px] py-1 border ${
                  orderType === "MARKET"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted"
                }`}
              >
                Market
              </button>
            </div>

            <div className="space-y-3">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-muted">
                  Price
                </span>
                <input
                  type="number"
                  disabled={orderType === "MARKET"}
                  value={
                    orderType === "MARKET" ? creator.currentPrice : inputPrice
                  }
                  onChange={(e) => setInputPrice(e.target.value)}
                  className={`w-full bg-background border border-border-exchange rounded px-12 py-2 text-right text-sm mono focus:border-primary outline-none ${
                    orderType === "MARKET" ? "opacity-50" : ""
                  }`}
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
                  value={inputQuantity}
                  onChange={(e) => setInputQuantity(e.target.value)}
                  className="w-full bg-background border border-border-exchange rounded px-12 py-2 text-right text-sm mono focus:border-primary outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted">
                  UNI
                </span>
              </div>
              <button
                onClick={handleTrade}
                disabled={isSubmitting || !inputQuantity}
                className={`w-full py-3 text-background font-black text-sm rounded mt-2 hover:opacity-90 transition-opacity ${
                  isSubmitting ? "opacity-50 cursor-not-allowed" : ""
                } ${side === "BUY" ? "bg-up" : "bg-down"}`}
              >
                {isSubmitting ? "Processing..." : side}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
