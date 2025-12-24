"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/LanguageContext";

interface RecentTradesProps {
  trades: Array<{
    id: string;
    price: number;
    quantity: number;
    time: string;
    type: "BUY" | "SELL";
  }>;
}

export function RecentTrades({ trades }: RecentTradesProps) {
  const [displayCount, setDisplayCount] = useState(20);
  const { t } = useLanguage();
  const visibleTrades = trades.slice(0, displayCount);

  return (
    <div className="flex-1 flex flex-col min-h-0 text-foreground">
      <div className="px-4 py-2 border-b border-border-exchange text-xs font-bold">
        {t("common.recentTrades")}
      </div>
      <div className="flex px-4 py-1 text-[10px] text-muted">
        <span className="flex-1">{t("common.price")}</span>
        <span className="flex-1 text-right">{t("common.quantity")}</span>
        <span className="flex-1 text-right">Time</span>
      </div>
      <div className="flex-1 overflow-hidden">
        {visibleTrades.map((t) => (
          <div
            key={t.id}
            className="flex px-4 py-1 text-xs hover:bg-card transition-colors"
          >
            <span
              className={`flex-1 font-mono font-bold ${
                t.type === "BUY" ? "text-up" : "text-down"
              }`}
            >
              {t.price.toLocaleString()}
            </span>
            <span className="flex-1 text-right font-mono">
              {t.quantity.toLocaleString()}
            </span>
            <span className="flex-1 text-right text-muted font-mono text-[10px]">
              {t.time}
            </span>
          </div>
        ))}
        {displayCount < trades.length && (
          <button
            onClick={() => setDisplayCount((prev) => prev + 20)}
            className="w-full py-2 text-[10px] text-muted hover:bg-card border-t border-border-exchange transition-colors"
          >
            Show More
          </button>
        )}
      </div>
    </div>
  );
}
