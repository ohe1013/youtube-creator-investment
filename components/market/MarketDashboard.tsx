"use client";

import { useState } from "react";
import { MarketHeader } from "./MarketHeader";
import { MarketChart } from "./MarketChart";
import { OrderForm } from "./OrderForm";
import { RecentTrades } from "./RecentTrades";
import { MarketList } from "./MarketList";
import { CreatorInfo } from "./CreatorInfo";
import { useLanguage } from "@/lib/LanguageContext";

interface MarketDashboardProps {
  selectedCreator: any;
  stats: any;
  chartData: any[];
  trades: any[];
  creators: any[];
  userBalance: number;
  userQuantity: number;
}

export function MarketDashboard({
  selectedCreator,
  stats,
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
  const { t } = useLanguage();

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden max-w-[1600px] mx-auto w-full bg-background text-foreground">
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
          className={`flex-1 flex flex-col min-w-0 md:gap-3 ${
            mobileTab === "LIST" ? "hidden" : "flex"
          }`}
        >
          {/* Chart Section Card */}
          <div
            className={`flex-col relative bg-card border border-border-exchange rounded shadow-sm overflow-hidden ${
              mobileTab === "CHART"
                ? "flex flex-1"
                : "hidden md:flex flex-1 min-h-0"
            }`}
          >
            {/* Chart Content Area */}
            <div className="flex-1 flex flex-col min-h-[350px] md:min-h-0 md:h-[55%]">
              {chartTab === "CHART" ? (
                <MarketChart data={chartData} />
              ) : (
                <CreatorInfo creator={selectedCreator} />
              )}
            </div>
          </div>

          {/* Order & Trades Section (Shared Row) */}
          <div
            className={`flex-col md:flex-row md:h-[45%] md:gap-3 ${
              mobileTab === "ORDER" || mobileTab === "TRADES"
                ? "flex flex-1"
                : "hidden md:flex"
            }`}
          >
            {/* Recent Trades Card */}
            <div
              className={`flex-1 flex flex-col bg-card border border-border-exchange rounded shadow-sm overflow-hidden ${
                mobileTab === "TRADES" || "hidden md:flex"
              }`}
            >
              <RecentTrades trades={trades} />
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
