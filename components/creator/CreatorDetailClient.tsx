"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useCreatorXDataClient } from "@/components/runtime/CreatorXDataProvider";
import { CreatorInfo } from "@/components/market/CreatorInfo";
import { OrderBook } from "@/components/market/OrderBook";
import { RecentTrades } from "@/components/market/RecentTrades";
import { MarketChart } from "@/components/market/MarketChart";
import type {
  Creator,
  CreatorStat,
  CreatorVideo,
  HistoryPoint,
  OrderBook as CreatorXOrderBook,
  Trade,
} from "@/lib/data/contracts";
import { useCreatorXOrderSubmission } from "@/lib/orders/useCreatorXOrderSubmission";


export function CreatorDetailClient({ id }: { id: string }) {
  const client = useCreatorXDataClient();
  const { isSubmitting, submit } = useCreatorXOrderSubmission();
  const [creator, setCreator] = useState<Creator | null>(null);
  const [stats, setStats] = useState<CreatorStat[]>([]);
  const [videos, setVideos] = useState<
    Array<CreatorVideo & { thumbnailUrl: string }>
  >([]);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [orderBook, setOrderBook] = useState<CreatorXOrderBook>({
    asks: [],
    bids: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"LIMIT" | "MARKET">("LIMIT");
  const [inputPrice, setInputPrice] = useState("");
  const [inputQuantity, setInputQuantity] = useState("");

  useEffect(() => {
    if (!id) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const optional = async <T,>(promise: Promise<T>, fallback: T): Promise<T> => {
      try {
        return await promise;
      } catch {
        return fallback;
      }
    };

    const poll = async () => {
      controller = new AbortController();
      const options = { signal: controller.signal };
      try {
        const nextCreator = await client.getCreator(id, options);
        const [nextStats, nextVideos, nextHistory, nextTrades, nextOrderBook] =
          await Promise.all([
            optional(
              client.getCreatorStats(id, { days: 90 }, options),
              [] as CreatorStat[],
            ),
            optional(client.getCreatorVideos(id, options), [] as CreatorVideo[]),
            optional(
              client.getCreatorHistory(id, { days: 7 }, options),
              [] as HistoryPoint[],
            ),
            optional(client.getCreatorTrades(id, options), [] as Trade[]),
            optional(
              client.getOrderBook(id, options),
              { asks: [], bids: [] } as CreatorXOrderBook,
            ),
          ]);
        if (controller.signal.aborted || disposed) return;
        setCreator(nextCreator);
        setStats(nextStats);
        setVideos(
          nextVideos.map((video) => ({
            ...video,
            thumbnailUrl: video.thumbnailUrl ?? "",
          })),
        );
        setHistory(nextHistory);
        setTrades(nextTrades);
        setOrderBook(nextOrderBook);
        setInputPrice((current) =>
          current === "" ? nextCreator.currentPrice.toString() : current,
        );
        setError(null);
      } catch (loadError) {
        if (
          !controller.signal.aborted &&
          !disposed
        ) {
          setError(
            loadError instanceof Error ? loadError.message : "Creator not found",
          );
        }
      } finally {
        if (!disposed) {
          setLoading(false);
          timer = setTimeout(poll, 5000);
        }
      }
    };

    void poll();
    return () => {
      disposed = true;
      controller?.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [client, id]);

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
          <div className="text-down text-2xl mb-4">에러 발생</div>
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
    if (!creator || isSubmitting) return;
    try {
      const p =
        orderType === "MARKET" ? creator.currentPrice : Number(inputPrice);
      const order = await submit({
        creatorId: creator.id,
        side,
        orderType,
        price: p,
        quantity: Number(inputQuantity),
      });
      if (order === null) return;
      alert(`Order Placed: ${side} ${inputQuantity} @ ${order.price}`);
      setInputQuantity("");
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Trade failed");
    }
  };

  const isPositive = change24h >= 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="bg-card border-b border-border-exchange px-6 py-3 flex flex-wrap items-center gap-8">
        <div className="flex items-center gap-3">
          <Image
            src={creator.thumbnailUrl || "/globe.svg"}
            width={32}
            height={32}
            className="w-8 h-8 rounded-full border border-border-exchange"
            alt=""
            unoptimized
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
        <div className="flex-1 border-r border-border-exchange overflow-hidden flex flex-col min-w-0">
          <div className="h-[450px] border-b border-border-exchange">
            <MarketChart data={history} />
          </div>
          <div className="flex-1 overflow-y-auto">
            <CreatorInfo creator={creator} stats={stats} videos={videos} />
          </div>
        </div>
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
