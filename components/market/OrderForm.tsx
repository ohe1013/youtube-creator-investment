"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/LanguageContext";

interface OrderFormProps {
  creatorId: string;
  currentPrice: number;
  userBalance: number;
  userQuantity: number; // User's holding of this creator
  onBuy: (amount: number) => Promise<void>;
  onSell: (amount: number) => Promise<void>;
}

export function OrderForm({
  creatorId,
  currentPrice,
  userBalance,
  userQuantity,
  onBuy,
  onSell,
}: OrderFormProps) {
  const [tab, setTab] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [amount, setAmount] = useState<string>("");
  const [limitPrice, setLimitPrice] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const { t } = useLanguage();
  useEffect(() => {
    setLimitPrice(currentPrice.toString());
  }, [currentPrice]);

  const price =
    orderType === "MARKET" ? currentPrice : parseFloat(limitPrice) || 0;
  const quantity = parseFloat(amount) || 0;
  const total = quantity * price;

  return (
    <div className="w-full h-full flex flex-col text-foreground">
      {/* Buy/Sell Tabs */}
      <div className="flex border-b border-border-exchange bg-card/50">
        <button
          onClick={() => setTab("BUY")}
          className={`flex-1 py-3 font-bold text-sm transition-colors ${
            tab === "BUY"
              ? "text-up border-b-2 border-up bg-up/5"
              : "text-muted hover:text-foreground"
          }`}
        >
          {t("common.buy")}
        </button>
        <button
          onClick={() => setTab("SELL")}
          className={`flex-1 py-3 font-bold text-sm transition-colors ${
            tab === "SELL"
              ? "text-down border-b-2 border-down bg-down/5"
              : "text-muted hover:text-foreground"
          }`}
        >
          {t("common.sell")}
        </button>
      </div>

      <div className="p-4 flex flex-col gap-4 flex-1">
        {/* Balance Info */}
        <div className="flex justify-between text-xs text-muted">
          <span>{t("common.balance")}</span>
          <span className="font-mono text-foreground font-bold">
            {tab === "BUY"
              ? `${userBalance.toLocaleString()} P`
              : `${userQuantity} Shares`}
          </span>
        </div>

        {/* Order Type Toggle */}
        <div className="flex flex-col gap-2">
          <label className="text-[10px] text-muted font-bold uppercase tracking-wider">
            {t("common.orderType")}
          </label>
          <div className="grid grid-cols-2 gap-1 p-1 bg-card rounded border border-border-exchange">
            <button
              onClick={() => setOrderType("LIMIT")}
              className={`py-1.5 text-xs font-bold rounded transition-all ${
                orderType === "LIMIT"
                  ? "bg-foreground text-white border-b-2 border-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {t("common.limitPrice")}
            </button>
            <button
              onClick={() => setOrderType("MARKET")}
              className={`py-1.5 text-xs font-bold rounded transition-all ${
                orderType === "MARKET"
                  ? "bg-foreground text-white border-b-2 border-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {t("common.marketPrice")}
            </button>
          </div>
        </div>

        {/* Price Input */}
        <div className="flex flex-col gap-2">
          <label className="text-[10px] text-muted font-bold uppercase tracking-wider">
            {t("common.price")}
          </label>
          <div className="relative">
            <input
              type="number"
              value={orderType === "MARKET" ? currentPrice : limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              disabled={orderType === "MARKET"}
              className={`w-full bg-card border border-border-exchange rounded px-3 py-2 font-mono text-sm outline-none transition-colors text-foreground ${
                orderType === "MARKET"
                  ? "opacity-50 cursor-not-allowed"
                  : "focus:border-primary"
              }`}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted font-bold">
              P
            </span>
          </div>
        </div>

        {/* Quantity Input */}
        <div className="flex flex-col gap-2">
          <label className="text-[10px] text-muted font-bold uppercase tracking-wider">
            {t("common.quantity")}
          </label>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="w-full bg-card border border-border-exchange rounded px-3 py-2 font-mono text-sm focus:border-primary outline-none transition-colors text-foreground"
            />
          </div>
        </div>

        {/* Percent Buttons */}
        <div className="grid grid-cols-4 gap-2">
          {[0.1, 0.25, 0.5, 1].map((pct) => (
            <button
              key={pct}
              onClick={() => {
                if (tab === "BUY") {
                  const maxQty = Math.floor(userBalance / price);
                  setAmount(Math.floor(maxQty * pct).toString());
                } else {
                  setAmount(Math.floor(userQuantity * pct).toString());
                }
              }}
              className="bg-card hover:bg-foreground/5 border border-border-exchange text-[10px] text-muted rounded py-1 transition-colors font-bold"
            >
              {pct * 100}%
            </button>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-border-exchange">
          <div className="flex justify-between text-xs mb-2">
            <span className="text-muted">{t("common.total")}</span>
            <span className="font-mono font-bold">
              {total.toLocaleString()} P
            </span>
          </div>
          <button
            onClick={async () => {
              if (loading || total <= 0) return;
              setLoading(true);
              try {
                const endpoint =
                  tab === "BUY" ? "/api/trade/buy" : "/api/trade/sell";
                const res = await fetch(endpoint, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    creatorId,
                    quantity: parseFloat(amount),
                  }),
                });
                const data = await res.json();

                if (!res.ok) throw new Error(data.error || "Trade Failed");

                alert(`Success: ${data.message || "Trade executed"}`);
                setAmount("");
                window.location.reload();
              } catch (e) {
                console.error(e);
                alert(e instanceof Error ? e.message : "Trade Failed");
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading || total <= 0}
            className={`w-full py-3 rounded font-bold text-background transition-all ${
              loading
                ? "opacity-50 cursor-not-allowed"
                : "hover:scale-[1.01] active:scale-[0.99]"
            } ${tab === "BUY" ? "bg-up" : "bg-down"}`}
          >
            {loading
              ? "Processing..."
              : tab === "BUY"
              ? t("common.buy")
              : t("common.sell")}
          </button>
        </div>
      </div>
    </div>
  );
}
