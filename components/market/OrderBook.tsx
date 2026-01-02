"use client";

import { useMemo, useState, useEffect } from "react";
import { useLanguage } from "@/lib/LanguageContext";

interface OrderBookProps {
  currentPrice: number;
  liquidity: number;
  asks?: { price: number; quantity: number }[];
  bids?: { price: number; quantity: number }[];
}

export function OrderBook({
  currentPrice,
  liquidity,
  asks: propAsks,
  bids: propBids,
}: OrderBookProps) {
  const { t } = useLanguage();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const k = 0.1; // Consistent with lib/market.ts

  // Generate simulated order book data based on currentPrice and liquidity
  const { asks, bids } = useMemo(() => {
    if (!mounted) {
      return { asks: [], bids: [] };
    }

    // Use Real Data if provided
    if (propAsks && propBids) {
      return { asks: propAsks, bids: propBids };
    }

    const askList = [];
    const bidList = [];
    const spreadCount = 8;
    const safeLiquidity = Math.max(liquidity || 0, 1000);

    // Each level represents a 0.5% price movement roughly
    const stepPct = 0.005;

    for (let i = spreadCount; i >= 1; i--) {
      const price = currentPrice * (1 + i * stepPct);
      // How much trade value would cause this impact?
      // impact = (k * tradeValue) / liquidity -> tradeValue = (impact * liquidity) / k
      const impact = i * stepPct;
      const tradeValue = (impact * safeLiquidity) / k;

      // Add +/- 20% random noise to the quantity to make it look "real"
      const noise = 0.8 + Math.random() * 0.4;
      const quantity = (tradeValue / price) * noise;

      askList.push({
        price: Math.round(price),
        quantity: Number(quantity.toFixed(2)),
      });
    }

    for (let i = 1; i <= spreadCount; i++) {
      const price = currentPrice * (1 - i * stepPct);
      const impact = i * stepPct;
      const tradeValue = (impact * safeLiquidity) / k;

      const noise = 0.8 + Math.random() * 0.4;
      const quantity = (tradeValue / price) * noise;

      bidList.push({
        price: Math.max(1, Math.round(price)),
        quantity: Number(quantity.toFixed(2)),
      });
    }

    return {
      asks: askList.sort((a, b) => a.price - b.price), // Lowest price first for asks (standard)
      bids: bidList.sort((a, b) => b.price - a.price), // Highest price first for bids (standard)
    };
  }, [currentPrice, liquidity, mounted, propAsks, propBids]);
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
              className="relative flex items-center px-4 py-1 text-xs hover:bg-down/5 transition-colors group h-7"
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
        <div className="bg-card/80 border-y border-border-exchange py-1.5 px-4 flex justify-between items-center z-20 shadow-sm relative">
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
              className="relative flex items-center px-4 py-1 text-xs hover:bg-up/5 transition-colors group h-7"
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
