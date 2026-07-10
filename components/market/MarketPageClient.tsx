"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MarketDashboard } from "@/components/market/MarketDashboard";
import { useCreatorXDataClient } from "@/components/runtime/CreatorXDataProvider";
import type {
  CreatorStat,
  CreatorSummary,
  CreatorVideo,
  HistoryPoint,
  OrderBook as CreatorXOrderBook,
  Portfolio,
  Trade,
} from "@/lib/data/contracts";

type Creator = CreatorSummary;
type ChartPoint = { date: string; price: number; volume: number };
type RecentTrade = {
  id: string;
  price: number;
  quantity: number;
  type: "BUY" | "SELL";
  time: string;
};
type LoadState = {
  selectedCreator: Creator;
  creators: Creator[];
  stats: {
    high24h: number;
    low24h: number;
    vol24h: number;
    change24h: number;
  };
  historyStats: CreatorStat[];
  videos: Array<CreatorVideo & { thumbnailUrl: string }>;
  orderBook: CreatorXOrderBook;
  chartData: ChartPoint[];
  trades: RecentTrade[];
  userBalance: number;
  userQuantity: number;
};

function toChartPoint(point: HistoryPoint): ChartPoint {
  return {
    date: point.date,
    price: point.price,
    volume: point.volume,
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
  const client = useCreatorXDataClient();
  const [state, setState] = useState<LoadState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const optional = async <T,>(promise: Promise<T>, fallback: T): Promise<T> => {
      try {
        return await promise;
      } catch {
        return fallback;
      }
    };

    async function loadMarket() {
      try {
        setError(null);
        const creatorsData = await client.listCreators(
          { sort: "subs", limit: 50 },
          { signal: controller.signal },
        );
        const creators = creatorsData.creators;
        const selectedCreator =
          creators.find((creator) => creator.id === ticker) || creators[0];

        if (!selectedCreator) {
          if (!controller.signal.aborted) setState(null);
          return;
        }

        const [history, trades, statsData, videos, orderBook, portfolio] =
          await Promise.all([
            optional(
              client.getCreatorHistory(
                selectedCreator.id,
                { days: 7 },
                { signal: controller.signal },
              ),
              [] as HistoryPoint[],
            ),
            optional(
              client.getCreatorTrades(selectedCreator.id, {
                signal: controller.signal,
              }),
              [] as Trade[],
            ),
            optional(
              client.getCreatorStats(
                selectedCreator.id,
                { days: 90 },
                { signal: controller.signal },
              ),
              [] as CreatorStat[],
            ),
            optional(
              client.getCreatorVideos(selectedCreator.id, {
                signal: controller.signal,
              }),
              [] as CreatorVideo[],
            ),
            optional(
              client.getOrderBook(selectedCreator.id, {
                signal: controller.signal,
              }),
              { asks: [], bids: [] } as CreatorXOrderBook,
            ),
            optional(
              client.getPortfolio({ signal: controller.signal }),
              { balance: 0, positions: [], openOrders: [], trades: [] } as Portfolio,
            ),
          ]);
        if (controller.signal.aborted) return;
        const chartData = history.map(toChartPoint);
        const stats = calculateStats(selectedCreator, chartData);
        const selectedPosition = portfolio.positions.find(
          (position) => position.creatorId === selectedCreator.id
        );

        setState({
          selectedCreator,
          creators,
          stats,
          historyStats: statsData,
          videos: videos.map((video) => ({
            ...video,
            thumbnailUrl: video.thumbnailUrl ?? "",
          })),
          orderBook,
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
          trades: trades.map((trade) => ({
            id: trade.id,
            price: trade.price,
            quantity: trade.quantity,
            type: trade.type,
            time: new Date(trade.createdAt).toLocaleTimeString(),
          })),
          userBalance: portfolio.balance,
          userQuantity: selectedPosition?.quantity || 0,
        });
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "Market load failed");
        }
      }
    }

    void loadMarket();

    return () => controller.abort();
  }, [client, ticker]);

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
