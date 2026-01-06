"use client";

import { useMemo, useState, useEffect } from "react";
import { useLanguage } from "@/lib/LanguageContext";

interface OrderBookProps {
  currentPrice: number;
  liquidity: number;
  asks?: { price: number; quantity: number }[];
  bids?: { price: number; quantity: number }[];
  onPriceClick?: (price: number, side?: "BUY" | "SELL") => void;
}

export function OrderBook({
  currentPrice,
  liquidity,
  asks: propAsks,
  bids: propBids,
  onPriceClick,
}: OrderBookProps) {
  const { t } = useLanguage();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Use props directly, default to empty arrays if undefined
  const asks = propAsks || [];
  const bids = propBids || [];

  const maxQty = useMemo(() => {
    const all = [...asks, ...bids].map((o) => o.quantity);
    return Math.max(...all, 1); // Prevent division by zero
  }, [asks, bids]);

  return (
    <div className="flex-1 flex flex-col min-h-0 text-foreground bg-card">
      <div className="flex px-4 py-1.5 text-[10px] text-muted border-b border-border-exchange bg-card/50 font-bold uppercase tracking-wider">
        <span className="flex-1">{t("common.price")}</span>
        <span className="flex-1 text-right">{t("common.quantity")}</span>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col font-mono">
        {/* Asks (Sells) */}
        <div className="flex flex-col-reverse">
          {asks.map((o, i) => (
            <div
              key={`ask-${i}`}
              onClick={() => onPriceClick?.(o.price, "BUY")}
              className="relative flex items-center px-4 py-1 text-xs hover:bg-down/10 transition-colors group h-7 cursor-pointer active:bg-down/20"
            >
              {/* Depth Bar */}
              <div
                className="absolute right-0 top-0 bottom-0 bg-down/10 transition-all pointer-events-none"
                style={{ width: `${(o.quantity / maxQty) * 100}%` }}
              />
              <span className="flex-1 font-bold text-down">
                {o.price.toLocaleString()}
              </span>
              <span className="flex-1 text-right z-10">
                {o.quantity.toLocaleString()}
              </span>
            </div>
          ))}
        </div>

        {/* Current Price Divider */}
        <div
          onClick={() => onPriceClick?.(currentPrice)}
          className="bg-card/80 border-y border-border-exchange py-1.5 px-4 flex justify-between items-center z-20 shadow-sm relative cursor-pointer hover:bg-card/90 active:bg-card transition-colors"
        >
          <span className="text-sm font-bold text-primary">
            {currentPrice.toLocaleString()}
          </span>
          <span className="text-[10px] text-muted">
            Spread {Math.floor(currentPrice * 0.005).toLocaleString()} P
          </span>
        </div>

        {/* Bids (Buys) */}
        <div className="flex flex-col">
          {bids.map((o, i) => (
            <div
              key={`bid-${i}`}
              onClick={() => onPriceClick?.(o.price, "SELL")}
              className="relative flex items-center px-4 py-1 text-xs hover:bg-up/10 transition-colors group h-7 cursor-pointer active:bg-up/20"
            >
              {/* Depth Bar */}
              <div
                className="absolute right-0 top-0 bottom-0 bg-up/10 transition-all pointer-events-none"
                style={{ width: `${(o.quantity / maxQty) * 100}%` }}
              />
              <span className="flex-1 font-bold text-up">
                {o.price.toLocaleString()}
              </span>
              <span className="flex-1 text-right z-10">
                {o.quantity.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
