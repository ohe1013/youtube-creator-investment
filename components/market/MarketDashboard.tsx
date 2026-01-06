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

interface MarketDashboardProps {
  selectedCreator: any;
  stats: any;
  historyStats?: any[]; // For CreatorInfo
  videos?: any[]; // For CreatorInfo
  orderBook?: { asks: any[]; bids: any[] }; // Real OrderBook Data
  chartData: any[];
  trades: any[];
  creators: any[];
  userBalance: number;
  userQuantity: number;
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
}: MarketDashboardProps) {
  // Mobile Tab State: 'CHART' | 'ORDER' | 'TRADES' | 'LIST'
  const [mobileTab, setMobileTab] = useState<
    "CHART" | "ORDER" | "TRADES" | "LIST"
  >("CHART");

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
        creator={selectedCreator}
        stats={stats}
        chartTab={chartTab}
        setChartTab={setChartTab}
      />

      {/* Mobile Navigation Tabs (Visible only on mobile) */}
      <div className="md:hidden flex h-10 border-b border-border-exchange bg-card text-xs font-bold">
        {["CHART", "ORDER", "TRADES", "LIST"].map((tab) => (
          <button
            key={tab}
            onClick={() => setMobileTab(tab as any)}
            className={`flex-1 ${
              mobileTab === tab
                ? "text-primary border-b-2 border-primary"
                : "text-[#848e9c]"
            }`}
          >
            {t(`common.${tab.toLowerCase()}` as any)}
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
                externalPriceUpdate={priceUpdate}
                onBuy={async (amt) => {
                  await fetch("/api/trade/buy", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      creatorId: selectedCreator.id,
                      quantity: amt,
                    }),
                  }).then(async (r) => {
                    if (!r.ok) throw new Error((await r.json()).error);
                    window.location.reload();
                  });
                }}
                onSell={async (amt) => {
                  await fetch("/api/trade/sell", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      creatorId: selectedCreator.id,
                      quantity: amt,
                    }),
                  }).then(async (r) => {
                    if (!r.ok) throw new Error((await r.json()).error);
                    window.location.reload();
                  });
                }}
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
