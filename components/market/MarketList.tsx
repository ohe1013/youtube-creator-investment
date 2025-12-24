"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/LanguageContext";

interface MarketListProps {
  creators: Array<{
    id: string;
    name: string;
    thumbnailUrl?: string | null;
    currentPrice: number;
    change24h?: number;
    volume24h?: number;
  }>;
  selectedId?: string;
}

type SortKey = "name" | "price" | "change";
type SortOrder = "asc" | "desc";

export function MarketList({ creators, selectedId }: MarketListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortConfig, setSortConfig] = useState<{
    key: SortKey;
    order: SortOrder;
  }>({
    key: "change",
    order: "desc",
  });
  const { t } = useLanguage();

  const handleSort = (key: SortKey) => {
    setSortConfig((prev) => ({
      key,
      order: prev.key === key && prev.order === "desc" ? "asc" : "desc",
    }));
  };

  const filteredAndSortedCreators = useMemo(() => {
    return [...creators]
      .filter((c) => c.name.toLowerCase().includes(searchTerm.toLowerCase()))
      .sort((a, b) => {
        const order = sortConfig.order === "asc" ? 1 : -1;
        if (sortConfig.key === "name") {
          return order * a.name.localeCompare(b.name);
        }
        if (sortConfig.key === "price") {
          return order * (a.currentPrice - b.currentPrice);
        }
        if (sortConfig.key === "change") {
          return order * ((a.change24h || 0) - (b.change24h || 0));
        }
        return 0;
      });
  }, [creators, searchTerm, sortConfig]);

  return (
    <div className="w-full flex flex-col h-full text-foreground overflow-hidden">
      {/* Search Bar - Fixed */}
      <div className="h-12 border-b border-border-exchange flex items-center px-4 flex-shrink-0">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder={`${t("common.search")}...`}
          className="w-full bg-card border border-border-exchange rounded px-3 py-1.5 text-xs focus:ring-1 ring-primary outline-none transition-all"
        />
      </div>

      {/* Header - Fixed */}
      <div className="flex text-[10px] text-muted px-4 py-2 bg-card/50 border-b border-border-exchange font-bold tracking-tight flex-shrink-0 items-center">
        {/* Spacer for Thumbnail (w-8 + mr-3 = 44px) */}
        <div className="w-[44px] shrink-0" />

        <span
          className="flex-1 uppercase cursor-pointer hover:text-foreground transition-colors flex items-center gap-1"
          onClick={() => handleSort("name")}
        >
          NAME
          {sortConfig.key === "name" &&
            (sortConfig.order === "asc" ? "▲" : "▼")}
        </span>
        <span
          className="w-16 text-right uppercase cursor-pointer hover:text-foreground transition-colors"
          onClick={() => handleSort("price")}
        >
          PRICE
          {sortConfig.key === "price" &&
            (sortConfig.order === "asc" ? "▲" : "▼")}
        </span>
        <span
          className="w-14 text-right uppercase cursor-pointer hover:text-foreground transition-colors"
          onClick={() => handleSort("change")}
        >
          CHG%
          {sortConfig.key === "change" &&
            (sortConfig.order === "asc" ? "▲" : "▼")}
        </span>
      </div>

      {/* List - Scrollable */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {filteredAndSortedCreators.map((c) => {
          const isSelected = c.id === selectedId;
          const changeColor = (c.change24h || 0) >= 0 ? "text-up" : "text-down";
          const displayName = c.name;

          return (
            <Link
              key={c.id}
              href={`/?ticker=${c.id}`}
              className={`flex items-center px-4 py-3 hover:bg-card cursor-pointer transition-colors border-l-2 ${
                isSelected ? "bg-card border-primary" : "border-transparent"
              }`}
            >
              <div className="mr-3 shrink-0">
                {c.thumbnailUrl ? (
                  <img
                    src={c.thumbnailUrl}
                    alt={displayName}
                    className="w-8 h-8 rounded-full border border-border-exchange object-cover"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-card border border-border-exchange flex items-center justify-center text-[10px] font-bold">
                    {displayName.substring(0, 1)}
                  </div>
                )}
              </div>
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
        {filteredAndSortedCreators.length === 0 && (
          <div className="p-8 text-center text-xs text-muted">
            No results found
          </div>
        )}
      </div>
    </div>
  );
}
