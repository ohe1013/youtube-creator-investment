"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MarketDashboard } from "@/components/market/MarketDashboard";
import type { AppInTossCreator } from "@/lib/appintoss-demo-data";

type Creator = AppInTossCreator;
type PriceLevel = { price: number; quantity: number };
type ChartPoint = { date: string; price: number; volume: number };
type ChartSourcePoint = {
  date: string | Date;
  price: number;
  volume?: number;
  quantity?: number;
};
type TradeResponse = {
  id: string;
  price: number;
  quantity?: number;
  type: "BUY" | "SELL";
  createdAt: string;
};
type RecentTrade = {
  id: string;
  price: number;
  quantity: number;
  type: "BUY" | "SELL";
  time: string;
};
type PortfolioPosition = { creatorId: string; quantity: number };
type PortfolioResponse = { balance?: number; positions?: PortfolioPosition[] };
type CreatorsResponse = { creators?: Creator[] };
type HistoryResponse = { history?: ChartSourcePoint[] };
type TradesResponse = { trades?: TradeResponse[] };
type StatsResponse = { stats?: unknown[] };
type VideosResponse = { videos?: unknown[] };
type OrderBookResponse = { asks?: PriceLevel[]; bids?: PriceLevel[] };


type LoadState = {
  selectedCreator: Creator;
  creators: Creator[];
  stats: {
    high24h: number;
    low24h: number;
    vol24h: number;
    change24h: number;
  };
  historyStats: unknown[];
  videos: unknown[];
  orderBook: { asks: PriceLevel[]; bids: PriceLevel[] };
  chartData: ChartPoint[];
  trades: RecentTrade[];
  userBalance: number;
  userQuantity: number;
};

function toChartPoint(point: ChartSourcePoint): ChartPoint {
  return {
    date:
      typeof point.date === "string"
        ? point.date
        : new Date(point.date).toISOString(),
    price: point.price,
    volume: point.volume ?? (point.quantity ?? 0) * point.price,
  };
}

function calculateStats(selectedCreator: Creator | null, history: ChartPoint[]) {
  if (!selectedCreator) {
    return { high24h: 0, low24h: 0, vol24h: 0, change24h: 0 };
  }

  const prices = history.map((point) => point.price).filter(Boolean);
  const high24h = prices.length
    ? Math.max(...prices, selectedCreator.currentPrice)
    : selectedCreator.currentPrice;
  const low24h = prices.length
    ? Math.min(...prices, selectedCreator.currentPrice)
    : selectedCreator.currentPrice;
  const vol24h = history.reduce((sum, point) => sum + point.volume, 0);

  const firstPrice = prices[0] || selectedCreator.currentPrice;
  const lastPrice = prices[prices.length - 1] || selectedCreator.currentPrice;
  const change24h =
    firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

  return { high24h, low24h, vol24h, change24h };
}

function MarketPageContent() {
  const searchParams = useSearchParams();
  const ticker = searchParams.get("ticker");
  const [state, setState] = useState<LoadState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadMarket() {
      try {
        setError(null);
        const creatorsResponse = await fetch("/api/creators?sort=subs&limit=50");
        if (!creatorsResponse.ok) {
          throw new Error("Failed to load creators");
        }

        const creatorsData = (await creatorsResponse.json()) as CreatorsResponse;
        const creators = creatorsData.creators || [];
        const selectedCreator =
          creators.find((creator) => creator.id === ticker) || creators[0];

        if (!selectedCreator) {
          if (!cancelled) {
            setState(null);
          }
          return;
        }

        const [historyRes, tradesRes, statsRes, videosRes, orderBookRes, portfolioRes] =
          await Promise.all([
            fetch(`/api/creators/${selectedCreator.id}?history=true&days=7`),
            fetch(`/api/creators/${selectedCreator.id}?trades=true`),
            fetch(`/api/creators/${selectedCreator.id}?stats=true&days=90`),
            fetch(`/api/creators/${selectedCreator.id}?videos=true`),
            fetch(`/api/creators/${selectedCreator.id}?orderbook=true`),
            fetch("/api/portfolio"),
          ]);

        const [historyData, tradesData, statsData, videosData, orderBookData, portfolioData] =
          (await Promise.all([
            historyRes.ok ? historyRes.json() : Promise.resolve({ history: [] }),
            tradesRes.ok ? tradesRes.json() : Promise.resolve({ trades: [] }),
            statsRes.ok ? statsRes.json() : Promise.resolve({ stats: [] }),
            videosRes.ok ? videosRes.json() : Promise.resolve({ videos: [] }),
            orderBookRes.ok ? orderBookRes.json() : Promise.resolve({ asks: [], bids: [] }),
            portfolioRes.ok
              ? portfolioRes.json()
              : Promise.resolve({ balance: 0, positions: [] }),
          ])) as [
            HistoryResponse,
            TradesResponse,
            StatsResponse,
            VideosResponse,
            OrderBookResponse,
            PortfolioResponse,
          ];

        const chartData = (historyData.history || []).map(toChartPoint);
        const stats = calculateStats(selectedCreator, chartData);
        const selectedPosition = (portfolioData.positions || []).find(
          (position) => position.creatorId === selectedCreator.id
        );

        if (!cancelled) {
          setState({
            selectedCreator,
            creators,
            stats,
            historyStats: statsData.stats || [],
            videos: videosData.videos || [],
            orderBook: {
              asks: orderBookData.asks || [],
              bids: orderBookData.bids || [],
            },
            chartData:
              chartData.length > 0
                ? chartData
                : [
                    {
                      date: new Date().toISOString(),
                      price: selectedCreator.currentPrice,
                      volume: 0,
                    },
                  ],
            trades: (tradesData.trades || []).map((trade) => ({
              id: trade.id,
              price: trade.price,
              quantity: trade.quantity ?? 0,
              type: trade.type,
              time: new Date(trade.createdAt).toLocaleTimeString(),
            })),
            userBalance: portfolioData.balance || 0,
            userQuantity: selectedPosition?.quantity || 0,
          });
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Market load failed");
        }
      }
    }

    loadMarket();

    return () => {
      cancelled = true;
    };
  }, [ticker]);

  const content = useMemo(() => {
    if (error) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4">Market unavailable</h1>
            <p className="text-muted">{error}</p>
          </div>
        </div>
      );
    }

    if (!state) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4">Loading market...</h1>
            <p className="text-muted">크리에이터 데이터를 불러오고 있어요.</p>
          </div>
        </div>
      );
    }

    return (
      <main className="h-[calc(100vh-56px)] bg-background text-foreground flex flex-col overflow-hidden">
        <MarketDashboard
          selectedCreator={state.selectedCreator}
          stats={state.stats}
          historyStats={state.historyStats}
          videos={state.videos}
          orderBook={state.orderBook}
          chartData={state.chartData}
          trades={state.trades}
          creators={state.creators}
          userBalance={state.userBalance}
          userQuantity={state.userQuantity}
        />
      </main>
    );
  }, [error, state]);

  return content;
}

export function MarketPageClient() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
          Loading market...
        </div>
      }
    >
      <MarketPageContent />
    </Suspense>
  );
}
