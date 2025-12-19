"use client";

import { useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/LanguageContext";

interface MarketListProps {
  creators: Array<{
    id: string;
    name: string;
    nameKo?: string | null;
    currentPrice: number;
    change24h?: number;
    volume24h?: number;
  }>;
  selectedId?: string;
}

export function MarketList({ creators, selectedId }: MarketListProps) {
  const [displayCount, setDisplayCount] = useState(20);
  const { t, locale } = useLanguage();

  const visibleCreators = creators.slice(0, displayCount);

  return (
    <div className="w-full flex flex-col h-full text-foreground">
      <div className="h-12 border-b border-border-exchange flex items-center px-4">
        <input
          type="text"
          placeholder={`${t("common.search")}...`}
          className="w-full bg-card border border-border-exchange rounded px-3 py-1.5 text-xs focus:ring-1 ring-primary outline-none transition-all"
        />
      </div>

      <div className="flex text-[10px] text-muted px-4 py-2 bg-card/50 border-b border-border-exchange font-bold tracking-tight">
        <span className="flex-1 uppercase">NAME</span>
        <span className="w-16 text-right uppercase">PRICE</span>
        <span className="w-14 text-right uppercase">CHG%</span>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {visibleCreators.map((c) => {
          const isSelected = c.id === selectedId;
          const changeColor = (c.change24h || 0) >= 0 ? "text-up" : "text-down";
          const displayName = locale === "ko" ? c.nameKo || c.name : c.name;

          return (
            <Link
              key={c.id}
              href={`/?ticker=${c.id}`}
              className={`flex items-center px-4 py-3 hover:bg-card cursor-pointer transition-colors border-l-2 ${
                isSelected ? "bg-card border-primary" : "border-transparent"
              }`}
            >
              <div className="flex-1 flex flex-col min-w-0 mr-2">
                <span
                  className={`text-xs font-bold truncate ${
                    isSelected ? "text-primary" : "text-foreground"
                  }`}
                >
                  {displayName}
                </span>
                <span className="text-[10px] text-muted">
                  {c.volume24h
                    ? `Vol ${c.volume24h.toLocaleString()}`
                    : "Vol 0"}
                </span>
              </div>
              <div className="w-16 text-right text-xs font-mono font-bold shrink-0">
                {c.currentPrice.toLocaleString()}
              </div>
              <div
                className={`w-14 text-right text-xs font-bold shrink-0 ${changeColor}`}
              >
                {(c.change24h || 0) >= 0 ? "+" : ""}
                {(c.change24h || 0).toFixed(1)}%
              </div>
            </Link>
          );
        })}
        {displayCount < creators.length && (
          <button
            onClick={() => setDisplayCount((prev) => prev + 20)}
            className="w-full py-2 text-[10px] text-muted hover:bg-card border-t border-border-exchange transition-colors font-bold"
          >
            Show More
          </button>
        )}
      </div>
    </div>
  );
}
