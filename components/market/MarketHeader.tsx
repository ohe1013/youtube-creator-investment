"use client";

import { useMemo } from "react";
import { useLanguage } from "@/lib/LanguageContext";

interface MarketHeaderProps {
  creator: {
    id: string;
    name: string;
    thumbnailUrl?: string | null;
    currentPrice: number;
    currentSubs: number;
    currentViews: number;
    liquidity: number;
    category: string;
  } | null;
  stats?: {
    high24h: number;
    low24h: number;
    vol24h: number;
    change24h: number;
  };
  chartTab: "CHART" | "INFO";
  setChartTab: (tab: "CHART" | "INFO") => void;
}

export function MarketHeader({
  creator,
  stats,
  chartTab,
  setChartTab,
}: MarketHeaderProps) {
  const { t, locale } = useLanguage();

  if (!creator)
    return (
      <div className="h-24 bg-background border-b border-border-exchange" />
    );

  const displayName = creator.name;

  const changeColor = (stats?.change24h || 0) >= 0 ? "text-up" : "text-down";
  const changeSign = (stats?.change24h || 0) >= 0 ? "+" : "";

  return (
    <div className="h-24 bg-card border-b border-border-exchange flex items-center px-6 justify-between text-foreground">
      <div className="flex items-center gap-4">
        {creator.thumbnailUrl ? (
          <img
            src={creator.thumbnailUrl}
            alt={displayName}
            className="w-10 h-10 rounded-full border border-border-exchange object-cover"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-card border border-border-exchange flex items-center justify-center text-foreground font-bold text-lg">
            {displayName.substring(0, 1)}
          </div>
        )}
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            {displayName}
            <span className="text-xs text-muted font-normal bg-card px-2 py-0.5 rounded border border-border-exchange">
              {creator.category}
            </span>
          </h1>
          <div className="flex items-end gap-2 text-2xl font-mono font-bold">
            {creator.currentPrice.toLocaleString()} P
            <span className={`text-sm mb-1 ${changeColor}`}>
              {changeSign}
              {(stats?.change24h || 0).toFixed(2)}%
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-8">
        <div className="hidden lg:flex gap-8 text-xs">
          <div className="flex flex-col gap-1">
            <span className="text-muted">{t("market.high24h")}</span>
            <span className="font-mono">
              {(stats?.high24h || creator.currentPrice).toLocaleString()}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted">{t("market.low24h")}</span>
            <span className="font-mono">
              {(stats?.low24h || creator.currentPrice).toLocaleString()}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted">{t("market.vol24h")}</span>
            <span className="font-mono">
              {(stats?.vol24h || 0).toLocaleString()}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted">Liquidity</span>
            <span className="font-mono">
              {creator.liquidity.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex h-8 bg-card rounded p-1 border border-border-exchange">
          <button
            onClick={() => setChartTab("CHART")}
            className={`px-4 flex items-center text-xs font-bold transition-colors rounded ${
              chartTab === "CHART"
                ? "bg-border-exchange text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t("common.chart")}
          </button>
          <button
            onClick={() => setChartTab("INFO")}
            className={`px-4 flex items-center text-xs font-bold transition-colors rounded ${
              chartTab === "INFO"
                ? "bg-border-exchange text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t("common.info")}
          </button>
        </div>
      </div>
    </div>
  );
}
