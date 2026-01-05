"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/LanguageContext";
import Link from "next/link";
import { useSession } from "next-auth/react";

type Tab = "HOLDINGS" | "ORDERS" | "HISTORY";

export function PortfolioClient() {
  const { t } = useLanguage();
  const { update } = useSession();
  const [activeTab, setActiveTab] = useState<Tab>("HOLDINGS");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const res = await fetch("/api/portfolio");
      if (res.ok) {
        setData(await res.json());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000); // Poll every 5s
    return () => clearInterval(interval);
  }, []);

  const handleCancel = async (orderId: string) => {
    if (!confirm(t("portfolio.confirmCancel"))) return;
    try {
      const res = await fetch(`/api/orders/${orderId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to cancel");

      // Update session to reflect balance change in Navbar
      await update?.();

      fetchData(); // Refresh immediately
    } catch (e) {
      alert("Error cancelling order");
    }
  };

  if (loading && !data)
    return (
      <div className="p-8 text-center">{t("channel.collectingData")}...</div>
    );

  const totalAssetsValue =
    data.balance +
    data.positions.reduce(
      (sum: number, p: any) =>
        sum + p.quantity * (p.creator?.currentPrice || 0),
      0
    );

  return (
    <div className="max-w-[1200px] mx-auto p-4 md:p-8">
      {/* Header / Summary */}
      <div className="mb-8 p-6 bg-card border border-border-exchange rounded-lg shadow-sm">
        <h1 className="text-xl font-bold mb-4">{t("portfolio.title")}</h1>
        <div className="flex flex-col md:flex-row gap-8">
          <div>
            <span className="text-xs text-muted font-bold uppercase block mb-1">
              {t("portfolio.totalAssets")}
            </span>
            <span className="text-2xl font-mono font-bold">
              {totalAssetsValue.toLocaleString()} P
            </span>
          </div>
          <div>
            <span className="text-xs text-muted font-bold uppercase block mb-1">
              {t("portfolio.availableCash")}
            </span>
            <span className="text-2xl font-mono font-bold">
              {data.balance.toLocaleString()} P
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border-exchange mb-6">
        {[
          { id: "HOLDINGS", label: t("portfolio.holdings") },
          { id: "ORDERS", label: t("portfolio.openOrders") },
          { id: "HISTORY", label: t("portfolio.tradeHistory") },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as Tab)}
            className={`px-6 py-3 font-bold text-sm transition-colors relative ${
              activeTab === tab.id
                ? "text-primary"
                : "text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="bg-card border border-border-exchange rounded-lg overflow-hidden min-h-[400px]">
        {activeTab === "HOLDINGS" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-card/50 text-xs text-muted uppercase font-bold border-b border-border-exchange">
                <tr>
                  <th className="px-6 py-3">{t("portfolio.asset")}</th>
                  <th className="px-6 py-3 text-right">
                    {t("common.quantity")}
                  </th>
                  <th className="px-6 py-3 text-right">
                    {t("portfolio.avgPrice")}
                  </th>
                  <th className="px-6 py-3 text-right">
                    {t("portfolio.currentPrice")}
                  </th>
                  <th className="px-6 py-3 text-right">
                    {t("portfolio.valuation")}
                  </th>
                  <th className="px-6 py-3 text-right">{t("portfolio.pnl")}</th>
                </tr>
              </thead>
              <tbody>
                {data.positions.map((p: any) => {
                  const currentVal = p.quantity * p.creator.currentPrice;
                  const buyVal = p.quantity * p.avgPrice;
                  const pnl = currentVal - buyVal;
                  const pnlPct = buyVal > 0 ? (pnl / buyVal) * 100 : 0;

                  return (
                    <tr
                      key={p.id}
                      className="border-b border-border-exchange hover:bg-muted/5"
                    >
                      <td className="px-6 py-4 font-bold flex items-center gap-2">
                        {p.creator.thumbnailUrl && (
                          <img
                            src={p.creator.thumbnailUrl}
                            className="w-6 h-6 rounded-full"
                          />
                        )}
                        <Link
                          href={`/creators/${p.creatorId}`}
                          className="hover:underline"
                        >
                          {p.creator.name}
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-right font-mono">
                        {p.quantity.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-muted">
                        {Math.round(p.avgPrice || 0).toLocaleString()} P
                      </td>
                      <td className="px-6 py-4 text-right font-mono font-bold">
                        {p.creator.currentPrice.toLocaleString()} P
                      </td>
                      <td className="px-6 py-4 text-right font-mono">
                        {currentVal.toLocaleString()} P
                      </td>
                      <td
                        className={`px-6 py-4 text-right font-mono font-bold ${
                          pnl >= 0 ? "text-up" : "text-down"
                        }`}
                      >
                        {pnlPct.toFixed(2)}%
                      </td>
                    </tr>
                  );
                })}
                {data.positions.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-6 py-8 text-center text-muted"
                    >
                      {t("portfolio.noHoldings")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "ORDERS" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-card/50 text-xs text-muted uppercase font-bold border-b border-border-exchange">
                <tr>
                  <th className="px-6 py-3">{t("portfolio.time")}</th>
                  <th className="px-6 py-3">{t("portfolio.asset")}</th>
                  <th className="px-6 py-3">{t("portfolio.type")}</th>
                  <th className="px-6 py-3 text-right">{t("common.price")}</th>
                  <th className="px-6 py-3 text-right">
                    {t("common.quantity")}
                  </th>
                  <th className="px-6 py-3 text-right">
                    {t("portfolio.filled")}
                  </th>
                  <th className="px-6 py-3 text-center">
                    {t("portfolio.action")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.openOrders.map((o: any) => (
                  <tr
                    key={o.id}
                    className="border-b border-border-exchange hover:bg-muted/5"
                  >
                    <td className="px-6 py-4 text-muted text-xs">
                      {new Date(o.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 font-bold">
                      <Link
                        href={`/creators/${o.creatorId}`}
                        className="hover:underline"
                      >
                        {o.creator.name}
                      </Link>
                    </td>
                    <td
                      className={`px-6 py-4 font-bold ${
                        o.type === "BUY" ? "text-up" : "text-down"
                      }`}
                    >
                      {o.type === "BUY" ? t("common.buy") : t("common.sell")}
                    </td>
                    <td className="px-6 py-4 text-right font-mono">
                      {o.price.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right font-mono">
                      {o.quantity.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right font-mono">
                      {o.filled.toLocaleString()}{" "}
                      <span className="text-muted text-xs">
                        ({((o.filled / o.quantity) * 100).toFixed(0)}%)
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => handleCancel(o.id)}
                        className="text-xs border border-border-exchange px-3 py-1 rounded hover:bg-down hover:text-white hover:border-down transition-colors"
                      >
                        {t("portfolio.cancel")}
                      </button>
                    </td>
                  </tr>
                ))}
                {data.openOrders.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-6 py-8 text-center text-muted"
                    >
                      {t("portfolio.noOrders")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "HISTORY" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-card/50 text-xs text-muted uppercase font-bold border-b border-border-exchange">
                <tr>
                  <th className="px-6 py-3">{t("portfolio.time")}</th>
                  <th className="px-6 py-3">{t("portfolio.asset")}</th>
                  <th className="px-6 py-3">{t("portfolio.type")}</th>
                  <th className="px-6 py-3 text-right">{t("common.price")}</th>
                  <th className="px-6 py-3 text-right">
                    {t("common.quantity")}
                  </th>
                  <th className="px-6 py-3 text-right">{t("common.total")}</th>
                </tr>
              </thead>
              <tbody>
                {data.trades.map((t_data: any) => (
                  <tr
                    key={t_data.id}
                    className="border-b border-border-exchange hover:bg-muted/5"
                  >
                    <td className="px-6 py-4 text-muted text-xs">
                      {new Date(t_data.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 font-bold">
                      {t_data.creator.name}
                    </td>
                    <td
                      className={`px-6 py-4 font-bold ${
                        t_data.type === "BUY" ? "text-up" : "text-down"
                      }`}
                    >
                      {t_data.type === "BUY"
                        ? t("common.buy")
                        : t("common.sell")}
                    </td>
                    <td className="px-6 py-4 text-right font-mono">
                      {t_data.price.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right font-mono">
                      {t_data.quantity.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right font-mono">
                      {(t_data.price * t_data.quantity).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {data.trades.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-6 py-8 text-center text-muted"
                    >
                      {t("portfolio.noHistory")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
