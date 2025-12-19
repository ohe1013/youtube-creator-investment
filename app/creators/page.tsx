"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

interface Creator {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  category: string | null;
  currentSubs: number;
  currentScore: number;
  currentPrice: number;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function CreatorsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [creators, setCreators] = useState<Creator[]>([]);
  const [categories, setCategories] = useState<string[]>(["전체"]);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter States
  const category = searchParams.get("category") || "전체";
  const sort = searchParams.get("sort") || "score";
  const page = Number(searchParams.get("page")) || 1;
  const minSubs = searchParams.get("minSubs") || "";
  const maxSubs = searchParams.get("maxSubs") || "";

  useEffect(() => {
    fetch("/api/categories")
      .then((res) => res.json())
      .then((data) => {
        if (data.categories) setCategories(data.categories);
      })
      .catch((err) => console.error("Error fetching categories:", err));
  }, []);

  const fetchCreators = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category !== "전체") params.append("category", category);
      params.append("sort", sort);
      params.append("page", page.toString());
      if (minSubs) params.append("minSubs", minSubs);
      if (maxSubs) params.append("maxSubs", maxSubs);

      const res = await fetch(`/api/creators?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch creators");

      const data = await res.json();
      setCreators(data.creators || []);
      setPagination(data.pagination);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [category, sort, page, minSubs, maxSubs]);

  useEffect(() => {
    fetchCreators();
  }, [fetchCreators]);

  const updateFilters = (
    newFilters: Record<string, string | number | undefined>
  ) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(newFilters).forEach(([key, value]) => {
      if (value === undefined || value === "" || value === "전체") {
        params.delete(key);
      } else {
        params.set(key, value.toString());
      }
    });
    // Reset page when filtering
    if (!newFilters.page) params.delete("page");

    router.push(`/creators?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-4 py-6">
        {/* Market Header */}
        <div className="flex flex-col md:flex-row justify-between items-end mb-8 gap-4 border-b border-border-exchange pb-6">
          <div>
            <h1 className="text-2xl font-bold mb-1">Market</h1>
            <p className="text-sm text-muted">
              Discover and invest in the next top YouTube stars
            </p>
          </div>
          <div className="flex gap-6 text-sm">
            <div className="flex flex-col">
              <span className="text-muted">Total Creators</span>
              <span className="font-bold mono">{pagination?.total || 0}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-muted">Market Cap</span>
              <span className="font-bold text-up mono">2,410,200 P</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-4">
          {/* Compact Filter Bar */}
          <div className="flex gap-2 overflow-x-auto pb-4 no-scrollbar lg:flex-wrap lg:w-48 lg:flex-col lg:shrink-0">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => updateFilters({ category: cat })}
                className={`whitespace-nowrap px-4 py-1.5 rounded text-xs font-bold transition-all border ${
                  category === cat
                    ? "bg-primary text-background border-primary shadow-sm"
                    : "text-muted hover:bg-card border-transparent"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="flex-1 bg-card rounded border border-border-exchange overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border-exchange text-muted text-[10px] uppercase tracking-wider font-bold">
                    <th className="px-6 py-4">Channel</th>
                    <th className="px-4 py-4">Category</th>
                    <th className="px-4 py-4 text-right">Subscribers</th>
                    <th className="px-4 py-4 text-right">Score</th>
                    <th className="px-4 py-4 text-right">Last Price</th>
                    <th className="px-6 py-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-exchange">
                  {loading ? (
                    [...Array(10)].map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        <td
                          colSpan={6}
                          className="px-6 py-4 h-12 bg-foreground/5"
                        ></td>
                      </tr>
                    ))
                  ) : creators.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-6 py-20 text-center text-muted"
                      >
                        No creators found matching your filters.
                      </td>
                    </tr>
                  ) : (
                    creators.map((creator) => (
                      <tr
                        key={creator.id}
                        className="hover:bg-foreground/5 transition-colors group cursor-pointer"
                        onClick={() => router.push(`/creators/${creator.id}`)}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <img
                              src={creator.thumbnailUrl || "/placeholder.png"}
                              alt=""
                              className="w-8 h-8 rounded-full border border-border-exchange"
                            />
                            <span className="font-bold group-hover:text-primary transition-colors truncate max-w-[150px]">
                              {creator.name}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className="text-[10px] px-2 py-0.5 bg-background text-muted border border-border-exchange rounded-sm uppercase tracking-tighter">
                            {creator.category}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-right mono text-xs">
                          {creator.currentSubs.toLocaleString()}
                        </td>
                        <td className="px-4 py-4 text-right mono text-up font-bold text-xs">
                          {creator.currentScore.toFixed(1)}
                        </td>
                        <td className="px-4 py-4 text-right mono font-bold text-xs">
                          {creator.currentPrice.toLocaleString()} P
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button className="bg-card hover:bg-primary hover:text-background text-foreground border border-border-exchange px-3 py-1 rounded text-xs font-bold transition-all">
                            Trade
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Market Pagination */}
            {pagination && pagination.totalPages > 1 && (
              <div className="px-6 py-4 border-t border-border-exchange bg-background/50 flex justify-between items-center text-xs">
                <span className="text-muted">
                  Showing page {page} of {pagination.totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      updateFilters({ page: page - 1 });
                    }}
                    disabled={page === 1}
                    className="p-1.5 rounded bg-card border border-border-exchange disabled:opacity-30 hover:bg-foreground/5 transition-colors"
                  >
                    ←
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      updateFilters({ page: page + 1 });
                    }}
                    disabled={page === pagination.totalPages}
                    className="p-1.5 rounded bg-card border border-border-exchange disabled:opacity-30 hover:bg-foreground/5 transition-colors"
                  >
                    →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
