"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/LanguageContext";
import Link from "next/link";
import { useSession } from "next-auth/react";

export function DashboardClient() {
  const { t } = useLanguage();
  const { data: session } = useSession();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const res = await fetch("/api/dashboard");
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
    const interval = setInterval(fetchData, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, []);

  if (loading && !data)
    return (
      <div className="h-screen flex items-center justify-center">
        {t("channel.collectingData")}...
      </div>
    );

  return (
    <div className="h-[calc(100vh-56px)] overflow-hidden flex flex-col bg-background text-foreground font-sans">
      {/* 1. Header Hero Ticker */}
      <div className="bg-card border-b border-border-exchange px-6 py-4 flex flex-wrap items-center justify-between gap-4 flex-shrink-0 animate-in fade-in duration-500">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-black uppercase tracking-tighter text-primary">
            Market Pulse
          </h1>
          <div className="h-4 w-px bg-border-exchange mx-2" />
          <span className="text-xs text-muted font-bold tracking-widest uppercase">
            {t("dashboard.marketOverview")}
          </span>
        </div>
        <div className="flex items-center gap-8">
          <div className="flex flex-col">
            <span className="text-[10px] text-muted uppercase font-bold">
              {t("dashboard.totalCap")}
            </span>
            <span className="text-sm font-mono font-bold text-up">
              {data.stats.totalMarketCap.toLocaleString()} P
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-muted uppercase font-bold">
              {t("dashboard.vol24h")}
            </span>
            <span className="text-sm font-mono font-bold">
              {data.stats.totalVolume24h.toLocaleString()} P
            </span>
          </div>
          <div className="flex flex-col hidden sm:flex">
            <span className="text-[10px] text-muted uppercase font-bold">
              {t("dashboard.activeAssets")}
            </span>
            <span className="text-sm font-mono font-bold">
              {data.stats.totalCreators}
            </span>
          </div>
          <div className="flex flex-col hidden md:flex">
            <span className="text-[10px] text-muted uppercase font-bold">
              {t("dashboard.activeTraders")}
            </span>
            <span className="text-sm font-mono font-bold text-primary">
              {data.stats.activeTraders}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Main Dashboard Area */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
        {/* Left column: Top Rankings Table */}
        <div className="flex-1 border-r border-border-exchange flex flex-col min-h-0 overflow-hidden animate-in slide-in-from-left duration-500">
          <div className="px-6 py-4 border-b border-border-exchange bg-card/30 flex justify-between items-center">
            <h2 className="text-sm font-black uppercase tracking-wider">
              {t("dashboard.topRankings")}
            </h2>
            <Link
              href="/creators"
              className="text-[10px] text-primary hover:underline uppercase font-bold"
            >
              View All Creators →
            </Link>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-card/90 backdrop-blur-sm z-10">
                <tr className="text-[10px] text-muted uppercase font-bold border-b border-border-exchange">
                  <th className="px-6 py-3 w-16">{t("dashboard.rank")}</th>
                  <th className="px-4 py-3">{t("dashboard.creator")}</th>
                  <th className="px-4 py-3 text-right">
                    {t("dashboard.price")}
                  </th>
                  <th className="px-4 py-3 text-right">
                    {t("dashboard.score")}
                  </th>
                  <th className="px-6 py-3 text-right">
                    {t("dashboard.marketCap")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-exchange/30">
                {data.rankings.map((r: any, idx: number) => (
                  <tr
                    key={r.id}
                    className="hover:bg-primary/5 group transition-colors cursor-pointer"
                    onClick={() => (window.location.href = `/creators/${r.id}`)}
                  >
                    <td className="px-6 py-4 font-mono text-sm text-muted">
                      #{idx + 1}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <img
                          src={r.thumbnailUrl}
                          className="w-8 h-8 rounded-full border border-border-exchange"
                          alt=""
                        />
                        <div className="flex flex-col">
                          <span className="font-bold group-hover:text-primary transition-colors">
                            {r.name}
                          </span>
                          <span className="text-[10px] text-muted uppercase">
                            {r.category}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="text-sm font-mono font-bold">
                        {r.currentPrice.toLocaleString()} P
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="text-sm font-mono font-bold text-up">
                        {r.currentScore.toFixed(1)}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="text-xs font-mono text-muted">
                        {r.marketCap.toLocaleString()} P
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right column: User Summary & New Listings */}
        <div className="w-full md:w-[380px] flex flex-col overflow-y-auto bg-card/20 animate-in slide-in-from-right duration-500">
          {/* User Portfolio Section */}
          {data.user ? (
            <div className="p-6 border-b border-border-exchange bg-card/50">
              <h2 className="text-xs font-black uppercase tracking-wider mb-4 opacity-50">
                {t("dashboard.mySummary")}
              </h2>
              <div className="space-y-4">
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted uppercase font-bold mb-1">
                    {t("dashboard.totalAssets")}
                  </span>
                  <span className="text-2xl font-mono font-bold">
                    {data.user.totalAssets.toLocaleString()} P
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border-exchange/30">
                  <div>
                    <span className="text-[10px] text-muted uppercase font-bold block mb-1">
                      {t("common.balance")}
                    </span>
                    <span className="text-sm font-mono font-bold">
                      {data.user.balance.toLocaleString()} P
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted uppercase font-bold block mb-1">
                      {t("dashboard.topHolding")}
                    </span>
                    <span className="text-sm font-bold truncate block">
                      {data.user.topHolding || "-"}
                    </span>
                  </div>
                </div>
                <Link
                  href="/portfolio"
                  className="block w-full text-center py-2 bg-primary text-background rounded font-black text-xs uppercase tracking-widest hover:scale-[1.02] transition-transform"
                >
                  {t("portfolio.title")}
                </Link>
              </div>
            </div>
          ) : (
            <div className="p-10 text-center border-b border-border-exchange">
              <p className="text-xs text-muted mb-4">
                Login to see your portfolio summary
              </p>
              <Link
                href="/auth/signin"
                className="px-6 py-2 bg-foreground text-background rounded text-xs font-bold uppercase tracking-widest"
              >
                Login
              </Link>
            </div>
          )}

          {/* New Listings Section */}
          <div className="flex-1 flex flex-col">
            <div className="px-6 py-4 border-b border-border-exchange flex justify-between items-center">
              <h2 className="text-xs font-black uppercase tracking-wider">
                {t("dashboard.newListings")}
              </h2>
            </div>
            <div className="p-6 space-y-4">
              {data.newListings.map((c: any) => (
                <Link
                  key={c.id}
                  href={`/creators/${c.id}`}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border-exchange/50 hover:border-primary/50 hover:bg-primary/5 transition-all group"
                >
                  <img
                    src={c.thumbnailUrl}
                    className="w-10 h-10 rounded-full grayscale group-hover:grayscale-0 transition-all shadow-sm"
                    alt=""
                  />
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-bold truncate group-hover:text-primary transition-colors">
                      {c.name}
                    </span>
                    <span className="text-[10px] text-muted uppercase tracking-tighter">
                      Listed {new Date(c.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="ml-auto text-right">
                    <span className="text-xs font-mono font-bold block">
                      {c.currentPrice.toLocaleString()} P
                    </span>
                    <span className="text-[10px] text-up font-bold">NEW</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Ad/Promo Area */}
          <div className="mt-auto p-6">
            <div className="p-6 rounded-2xl bg-gradient-to-br from-brand-blue to-brand-red p-[1px]">
              <div className="bg-background rounded-[15px] p-5">
                <h3 className="text-sm font-black mb-2 tracking-tighter uppercase italic">
                  Be the Whale.
                </h3>
                <p className="text-[10px] text-muted leading-relaxed">
                  Early investors in high-potential creators see the biggest
                  returns. Spot the trend before anyone else.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
