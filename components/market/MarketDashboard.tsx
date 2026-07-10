"use client";

import { useState } from "react";
import { MarketHeader } from "./MarketHeader";
import { MarketChart } from "./MarketChart";
import { OrderForm } from "./OrderForm";
import { RecentTrades } from "./RecentTrades";
import { OrderBook } from "./OrderBook";
import { MarketList } from "./MarketList";
import { CreatorInfo } from "./CreatorInfo";
import { useLanguage } from "@/lib/LanguageContext";
import type {
  CreatorStat,
  CreatorSummary,
  CreatorVideo,
  OrderBook as CreatorXOrderBook,
} from "@/lib/data/contracts";

type MobileTab = "CHART" | "ORDER" | "TRADES" | "LIST";
const MOBILE_TABS: MobileTab[] = ["CHART", "ORDER", "TRADES", "LIST"];

interface MarketDashboardProps {
  selectedCreator: CreatorSummary;
  stats: {
    high24h: number;
    low24h: number;
    vol24h: number;
    change24h: number;
  };
  historyStats?: CreatorStat[];
  videos?: Array<CreatorVideo & { thumbnailUrl: string }>;
  orderBook?: CreatorXOrderBook;
  chartData: Array<{ date: string | Date; price: number; volume?: number }>;
  trades: Array<{
    id: string;
    price: number;
    quantity: number;
    type: "BUY" | "SELL";
    time: string;
  }>;
  creators: CreatorSummary[];
  userBalance: number;
  userQuantity: number;
  onOrderAccepted: () => Promise<void>;
}

export function MarketDashboard({
  selectedCreator,
  stats,
  historyStats = [],
  videos = [],
  orderBook = { asks: [], bids: [] },
  chartData,
  trades,
  creators,
  userBalance,
  userQuantity,
  onOrderAccepted,
}: MarketDashboardProps) {
  // Mobile Tab State: 'CHART' | 'ORDER' | 'TRADES' | 'LIST'
  const [mobileTab, setMobileTab] = useState<MobileTab>("CHART");

  // Desktop/Inner Chart Tab State: 'CHART' | 'INFO'
  const [chartTab, setChartTab] = useState<"CHART" | "INFO">("CHART");
  // Secondary Data Area Tab: 'ORDERBOOK' | 'TRADES'
  const [dataTab, setDataTab] = useState<"ORDERBOOK" | "TRADES">("ORDERBOOK");
  // External Price Update (from OrderBook to OrderForm)
  const [priceUpdate, setPriceUpdate] = useState<
    { price: number; side?: "BUY" | "SELL"; timestamp: number } | undefined
  >();
  const { t } = useLanguage();

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden max-w-[1600px] mx-auto w-full bg-background text-foreground">
      {/* Header - Always Visible */}
      <MarketHeader
        creator={{
          ...selectedCreator,
          category: selectedCreator.category ?? "Other",
        }}
        stats={stats}
        chartTab={chartTab}
        setChartTab={setChartTab}
      />

      {/* Mobile Navigation Tabs (Visible only on mobile) */}
      <div className="md:hidden flex h-10 border-b border-border-exchange bg-card text-xs font-bold">
        {MOBILE_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setMobileTab(tab)}
            className={`flex-1 ${
              mobileTab === tab
                ? "text-primary border-b-2 border-primary"
                : "text-[#848e9c]"
            }`}
          >
            {t(`common.${tab.toLowerCase()}`)}
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 relative md:p-3 md:gap-3 bg-background">
        {/* --- LEFT SIDE (Desktop) / DYNAMIC (Mobile) --- */}
        <div
          className={`flex-1 flex flex-col min-w-0 md:gap-3 overflow-y-auto scrollbar-hide ${
            mobileTab === "LIST" ? "hidden" : "flex"
          }`}
        >
          {/* Chart Section Card */}
          <div
            className={`flex-col relative bg-card border border-border-exchange rounded shadow-sm overflow-hidden flex-shrink-0 ${
              mobileTab === "CHART"
                ? "flex h-[500px]"
                : "hidden md:flex h-[500px]"
            }`}
          >
            {/* Chart Content Area */}
            <div className="flex-1 flex flex-col h-full">
              {chartTab === "CHART" ? (
                <MarketChart data={chartData} />
              ) : (
                <CreatorInfo
                  creator={selectedCreator}
                  stats={historyStats}
                  videos={videos}
                />
              )}
            </div>
          </div>

          {/* Order & Trades Section (Shared Row) */}
          <div
            className={`flex-col md:flex-row md:gap-3 flex-shrink-0 ${
              mobileTab === "ORDER" || mobileTab === "TRADES"
                ? "flex"
                : "hidden md:flex"
            }`}
          >
            {/* OrderBook & Recent Trades Card */}
            <div
              className={`flex-1 flex flex-col bg-card border border-border-exchange rounded shadow-sm overflow-hidden min-h-[400px] ${
                mobileTab === "TRADES" || "hidden md:flex"
              }`}
            >
              {/* Internal Tabs */}
              <div className="flex h-10 border-b border-border-exchange bg-card/50 flex-shrink-0">
                <button
                  onClick={() => setDataTab("ORDERBOOK")}
                  className={`flex-1 text-[10px] font-bold uppercase tracking-wider transition-all relative ${
                    dataTab === "ORDERBOOK"
                      ? "bg-primary text-primary border-b-2 border-primary"
                      : "text-muted hover:text-foreground hover:bg-card"
                  }`}
                >
                  {t("common.orderBook")}
                  {dataTab === "ORDERBOOK" && (
                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary" />
                  )}
                </button>
                <button
                  onClick={() => setDataTab("TRADES")}
                  className={`flex-1 text-[10px] font-bold uppercase tracking-wider transition-all relative ${
                    dataTab === "TRADES"
                      ? "bg-primary text-primary border-b-2 border-primary"
                      : "text-muted hover:text-foreground hover:bg-card"
                  }`}
                >
                  {t("common.recentTrades")}
                  {dataTab === "TRADES" && (
                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary" />
                  )}
                </button>
              </div>

              <div className="flex-1 overflow-hidden flex flex-col">
                {dataTab === "ORDERBOOK" ? (
                  <OrderBook
                    currentPrice={selectedCreator.currentPrice}
                    liquidity={selectedCreator.liquidity}
                    asks={orderBook.asks}
                    bids={orderBook.bids}
                    onPriceClick={(price, side) =>
                      setPriceUpdate({ price, side, timestamp: Date.now() })
                    }
                  />
                ) : (
                  <RecentTrades trades={trades} />
                )}
              </div>
            </div>

            {/* Order Form Card */}
            <div
              className={`w-full md:w-[320px] bg-card border border-border-exchange rounded shadow-sm overflow-hidden ${
                mobileTab === "ORDER" || "hidden md:block"
              }`}
            >
              <OrderForm
                creatorId={selectedCreator.id}
                currentPrice={selectedCreator.currentPrice}
                userBalance={userBalance}
                userQuantity={userQuantity}
                onOrderAccepted={onOrderAccepted}
                externalPriceUpdate={priceUpdate}
              />
            </div>
          </div>
        </div>

        {/* --- RIGHT SIDE (Market List Card) --- */}
        <div
          className={`w-full md:w-[320px] bg-card border border-border-exchange rounded shadow-sm overflow-hidden ${
            mobileTab === "LIST"
              ? "flex flex-col z-20 absolute inset-0 md:static"
              : "hidden md:flex flex-col"
          }`}
        >
          <MarketList creators={creators} selectedId={selectedCreator.id} />
        </div>
      </div>
    </div>
  );
}
