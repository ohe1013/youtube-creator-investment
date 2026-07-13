"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/LanguageContext";
import Link from "next/link";
import { useCreatorXDataClient } from "@/components/runtime/CreatorXDataProvider";
import type { Portfolio } from "@/lib/data/contracts";
import { decimalToDisplayNumber } from "@/lib/data/decimal-display";
import { creatorDetailHref } from "@/lib/routing/creator";
import { useCreatorXSession } from "@/lib/session/CreatorXSessionProvider";

type Tab = "HOLDINGS" | "ORDERS" | "HISTORY";

export function PortfolioClient() {
  const { t } = useLanguage();
  const client = useCreatorXDataClient();
  const session = useCreatorXSession();
  const canReadPortfolio = session.status === "authenticated";
  const [activeTab, setActiveTab] = useState<Tab>("HOLDINGS");
  const [data, setData] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancellingOrders, setCancellingOrders] = useState<Set<string>>(
    () => new Set(),
  );
  const cancellingOrdersRef = useRef(new Set<string>());
  const requestState = useRef({
    generation: 0,
    pollController: null as AbortController | null,
  });

  const loadPortfolio = useCallback(async (signal?: AbortSignal) => {
    const generation = ++requestState.current.generation;
    try {
      const portfolio = await client.getPortfolio({ signal });
      if (
        signal?.aborted ||
        requestState.current.generation !== generation
      ) {
        return;
      }
      setData(portfolio);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      console.error(error);
    } finally {
      if (
        !signal?.aborted &&
        requestState.current.generation === generation
      ) {
        setLoading(false);
      }
    }
  }, [client]);

  useEffect(() => {
    if (!canReadPortfolio) return;
    const requests = requestState.current;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const controller = new AbortController();
      requests.pollController = controller;
      await loadPortfolio(controller.signal);
      if (!disposed) timer = setTimeout(poll, 5000);
    };
    void poll();
    return () => {
      disposed = true;
      requests.generation += 1;
      requests.pollController?.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [canReadPortfolio, loadPortfolio]);

  const handleCancel = async (orderId: string) => {
    if (cancellingOrdersRef.current.has(orderId)) return;
    if (!confirm(t("portfolio.confirmCancel"))) return;
    cancellingOrdersRef.current.add(orderId);
    setCancellingOrders(new Set(cancellingOrdersRef.current));
    try {
      await client.cancelOrder(orderId, { idempotencyKey: crypto.randomUUID() });
      requestState.current.pollController?.abort();
      const refreshController = new AbortController();
      await Promise.allSettled([
        loadPortfolio(refreshController.signal),
        session.refresh(),
      ]);
    } catch {
      alert("Error cancelling order");
    } finally {
      cancellingOrdersRef.current.delete(orderId);
      setCancellingOrders(new Set(cancellingOrdersRef.current));
    }
  };

  if (!canReadPortfolio) {
    return (
      <div className="p-8 text-center text-muted">
        <p className="mb-4">포트폴리오를 보려면 로그인해 주세요.</p>
        <Link
          href="/auth/signin"
          className="inline-block px-4 py-2 rounded bg-primary text-background font-bold"
        >
          로그인하기
        </Link>
      </div>
    );
  }

  if (loading && !data)
    return (
      <div className="p-8 text-center">{t("channel.collectingData")}...</div>
    );
  if (!data) {
    return (
      <div className="p-8 text-center text-muted">
        <p className="mb-4">포트폴리오를 불러올 수 없습니다.</p>
        <Link
          href="/auth/signin"
          className="inline-block px-4 py-2 rounded bg-primary text-background font-bold"
        >
          로그인하기
        </Link>
      </div>
    );
  }

  const totalAssetsValue =
    decimalToDisplayNumber(data.availableBalance) +
    data.positions.reduce(
      (sum, p) =>
        sum +
        decimalToDisplayNumber(p.quantity) * decimalToDisplayNumber(p.avgPrice),
      0,
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
              {decimalToDisplayNumber(data.availableBalance).toLocaleString()} P
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
                {data.positions.map((p) => {
                  const quantity = decimalToDisplayNumber(p.quantity);
                  const avgPrice = decimalToDisplayNumber(p.avgPrice);
                  const currentVal = quantity * avgPrice;
                  const buyVal = quantity * avgPrice;
                  const pnl = currentVal - buyVal;
                  const pnlPct = buyVal > 0 ? (pnl / buyVal) * 100 : 0;

                  return (
                    <tr
                      key={p.id}
                      className="border-b border-border-exchange hover:bg-muted/5"
                    >
                      <td className="px-6 py-4 font-bold flex items-center gap-2">
                        <Link
                          href={creatorDetailHref(p.creatorId)}
                          className="hover:underline"
                        >
                          {p.creatorId}
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-right font-mono">
                        {quantity.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-muted">
                        {Math.round(avgPrice).toLocaleString()} P
                      </td>
                      <td className="px-6 py-4 text-right font-mono font-bold">
                        {Math.round(avgPrice).toLocaleString()} P
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
                {data.openOrders.map((o) => (
                  <tr
                    key={o.id}
                    className="border-b border-border-exchange hover:bg-muted/5"
                  >
                    <td className="px-6 py-4 text-muted text-xs">
                      {new Date(o.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 font-bold">
                      <Link
                        href={creatorDetailHref(o.creatorId)}
                        className="hover:underline"
                      >
                        {o.creator?.name ?? o.creatorId}
                      </Link>
                    </td>
                    <td
                      className={`px-6 py-4 font-bold ${
                        o.side === "BUY" ? "text-up" : "text-down"
                      }`}
                    >
                      {o.side === "BUY" ? t("common.buy") : t("common.sell")}
                    </td>
                    <td className="px-6 py-4 text-right font-mono">
                      {decimalToDisplayNumber(o.price).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right font-mono">
                      {decimalToDisplayNumber(o.quantity).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right font-mono">
                      {decimalToDisplayNumber(o.filled).toLocaleString()}{" "}
                      <span className="text-muted text-xs">
                        (
                        {(
                          (decimalToDisplayNumber(o.filled) /
                            decimalToDisplayNumber(o.quantity)) *
                          100
                        ).toFixed(0)}
                        %)
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => handleCancel(o.id)}
                        disabled={cancellingOrders.has(o.id)}
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
                {data.executions.map((execution) => {
                  const side = execution.side;
                  const price = decimalToDisplayNumber(execution.price);
                  const quantity = decimalToDisplayNumber(execution.quantity);
                  return (
                  <tr
                    key={execution.id}
                    className="border-b border-border-exchange hover:bg-muted/5"
                  >
                    <td className="px-6 py-4 text-muted text-xs">
                      {new Date(execution.executedAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 font-bold">
                      {execution.creatorId}
                    </td>
                    <td
                      className={`px-6 py-4 font-bold ${
                        side === "BUY" ? "text-up" : "text-down"
                      }`}
                    >
                      {side === "BUY"
                        ? t("common.buy")
                        : t("common.sell")}
                    </td>
                    <td className="px-6 py-4 text-right font-mono">
                      {price.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right font-mono">
                      {quantity.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right font-mono">
                      {decimalToDisplayNumber(execution.quoteAmount).toLocaleString()}
                    </td>
                  </tr>
                  );
                })}
                {data.executions.length === 0 && (
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
