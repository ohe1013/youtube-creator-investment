"use client";

import { useState } from "react";
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
  const [amount, setAmount] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const { t } = useLanguage();

  const price = currentPrice;
  const quantity = parseFloat(amount) || 0;
  const total = quantity * price;

  return (
    <div className="w-full h-full flex flex-col text-foreground">
      <div className="flex border-b border-border-exchange">
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

      <div className="p-4 flex flex-col gap-4 flex-1 overflow-auto">
        <div className="flex justify-between text-xs text-muted">
          <span>{t("common.balance")}</span>
          <span className="font-mono text-foreground font-bold">
            {tab === "BUY"
              ? `${userBalance.toLocaleString()} P`
              : `${userQuantity} Shares`}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted">Order Type</label>
          <div className="bg-card px-3 py-2 rounded text-sm font-bold opacity-70 border border-border-exchange">
            Market Price
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted">{t("common.price")}</label>
          <div className="bg-card px-3 py-2 rounded text-sm font-mono flex justify-between border border-border-exchange">
            <span>{price.toLocaleString()}</span>
            <span className="text-muted">P</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted">{t("common.quantity")}</label>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="w-full bg-card border border-border-exchange rounded px-3 py-2 font-mono focus:border-primary outline-none transition-colors text-foreground"
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
