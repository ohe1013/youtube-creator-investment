"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/LanguageContext";
import { useCreatorXOrderSubmission } from "@/lib/orders/useCreatorXOrderSubmission";

interface OrderFormProps {
  creatorId: string;
  currentPrice: number;
  userBalance: number;
  userQuantity: number; // User's holding of this creator
  onOrderAccepted?: () => Promise<void>;
  externalPriceUpdate?: {
    price: number;
    side?: "BUY" | "SELL";
    timestamp: number;
  };
}

export function OrderForm(props: OrderFormProps) {
  const submission = useCreatorXOrderSubmission();
  return (
    <OrderFormFields
      key={`${props.creatorId}:${props.externalPriceUpdate?.timestamp ?? 0}`}
      {...props}
      {...submission}
    />
  );
}

function OrderFormFields({
  creatorId,
  currentPrice,
  userBalance,
  userQuantity,
  onOrderAccepted,
  externalPriceUpdate,
  isSubmitting,
  submit,
}: OrderFormProps & ReturnType<typeof useCreatorXOrderSubmission>) {
  const [tab, setTab] = useState<"BUY" | "SELL">(
    externalPriceUpdate?.side ?? "BUY",
  );
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT">(
    externalPriceUpdate?.side ? "LIMIT" : "MARKET",
  );
  const [amount, setAmount] = useState<string>("0");
  const [limitPrice, setLimitPrice] = useState<string>(
    (externalPriceUpdate?.price ?? currentPrice).toString(),
  );
  const { t } = useLanguage();

  const price =
    orderType === "MARKET" ? currentPrice : parseFloat(limitPrice) || 0;
  const quantity = parseFloat(amount) || 0;
  const total = quantity * price;

  return (
    <div className="w-full h-full flex flex-col text-foreground">
      {/* Buy/Sell Tabs */}
      <div className="flex border-b border-border-exchange bg-card/50">
        <button
          onClick={() => {
            setTab("BUY");
            setAmount("0");
          }}
          className={`flex-1 py-3 font-bold text-sm transition-colors ${
            tab === "BUY"
              ? "text-up border-b-2 border-up bg-up/5"
              : "text-muted hover:text-foreground"
          }`}
        >
          {t("common.buy")}
        </button>
        <button
          onClick={() => {
            setTab("SELL");
            setAmount("0");
          }}
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
              data-creatorx-keyboard-target="true"
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
              data-creatorx-keyboard-target="true"
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
              if (isSubmitting || total <= 0) return;
              try {
                const order = await submit({
                  creatorId,
                  side: tab,
                  orderType,
                  price,
                  quantity,
                });
                if (order === null) return;

                const isFilled = order.status === "FILLED";
                const msg = isFilled
                  ? `Trade Executed: ${tab} ${amount} shares @ ${order.price}`
                  : `Order Placed: ${tab} ${amount} shares @ ${price}`;

                alert(msg);
                setAmount("");
                await onOrderAccepted?.().catch(() => undefined);
              } catch (e) {
                console.error(e);
                alert(e instanceof Error ? e.message : "Order Failed");
              }
            }}
            disabled={isSubmitting || total <= 0}
            className={`w-full py-3 rounded font-bold text-background transition-all ${
              isSubmitting
                ? "opacity-50 cursor-not-allowed"
                : "hover:scale-[1.01] active:scale-[0.99]"
            } ${tab === "BUY" ? "bg-up" : "bg-down"}`}
          >
            {isSubmitting
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
