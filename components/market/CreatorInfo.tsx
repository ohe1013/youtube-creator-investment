"use client";

import { useMemo, useState } from "react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  Bar,
  ComposedChart,
} from "recharts";
import { useLanguage } from "@/lib/LanguageContext";

interface CreatorStat {
  date: string;
  subs: number;
  views: number;
  videos: number;
  dailySubsChange: number;
  dailyViewsChange: number;
}

interface Video {
  id: string;
  title: string;
  thumbnailUrl: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  duration: string; // ISO 8601 format like "PT1M5S"
  type: "LONG" | "SHORTS";
}

interface Creator {
  id: string;
  youtubeChannelId: string;
  name: string;
  thumbnailUrl: string | null;
  category: string | null;
  currentSubs: number;
  currentViews: number;
  currentVideos: number;
  currentScore: number;
  currentPrice: number;
  circulatingSupply: number;
  liquidity: number;
  avgLikes: number;
  avgComments: number;
  engagementRate: number;
  viewsPerSubs: number;
}

interface CreatorInfoProps {
  creator: Creator;
  stats?: CreatorStat[];
  videos?: Video[];
}

export function CreatorInfo({
  creator,
  stats = [],
  videos = [],
}: CreatorInfoProps) {
  const [activeTab, setActiveTab] = useState<"trending" | "content">(
    "trending"
  );
  const [chartMode, setChartMode] = useState<"subs" | "views">("subs");
  const [timeRange, setTimeRange] = useState<"30d" | "90d">("30d");
  const [contentFilter, setContentFilter] = useState<"all" | "long" | "shorts">(
    "all"
  );

  const { t, locale } = useLanguage();

  // Helper to format large numbers
  const formatNumber = (num: number) => {
    return new Intl.NumberFormat(locale === "ko" ? "ko-KR" : "en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(num);
  };

  const marketCap = creator.currentPrice * creator.circulatingSupply;

  // Helper to parse ISO 8601 duration to seconds
  const parseDuration = (duration: string) => {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    const hours = parseInt(match[1] || "0");
    const minutes = parseInt(match[2] || "0");
    const seconds = parseInt(match[3] || "0");
    return hours * 3600 + minutes * 60 + seconds;
  };

  // Trending Tab Data
  const momentum = useMemo(() => {
    if (!stats || stats.length === 0) return null;
    const sortedStats = [...stats].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    const latest = sortedStats[sortedStats.length - 1];
    const daysAgos = (days: number) => {
      if (sortedStats.length <= days) return sortedStats[0];
      return sortedStats[sortedStats.length - 1 - days];
    };
    const stats7d = daysAgos(7);
    const stats30d = daysAgos(30);
    const subsGrowth7d = latest.subs - stats7d.subs;
    const subsGrowth30d = latest.subs - stats30d.subs;
    const viewsGrowth7d = latest.views - stats7d.views;
    const viewsGrowth30d = latest.views - stats30d.views;
    const subsGrowthRate30d =
      stats30d.subs > 0 ? (subsGrowth30d / stats30d.subs) * 100 : 0;
    const viewsGrowthRate30d =
      stats30d.views > 0 ? (viewsGrowth30d / stats30d.views) * 100 : 0;
    return {
      subsGrowth7d,
      subsGrowth30d,
      viewsGrowth7d,
      viewsGrowth30d,
      subsGrowthRate30d,
      viewsGrowthRate30d,
      hasEnoughData7d: sortedStats.length >= 7,
      hasEnoughData30d: sortedStats.length >= 30,
    };
  }, [stats]);

  const chartData = useMemo(() => {
    if (!stats || stats.length === 0) return [];
    const days = timeRange === "30d" ? 30 : 90;
    return stats.slice(-days).map((s) => ({
      ...s,
      dateFormatted: new Date(s.date).toLocaleDateString(
        locale === "ko" ? "ko-KR" : "en-US",
        { month: "short", day: "numeric" }
      ),
    }));
  }, [stats, timeRange, locale]);

  // Content Tab Data
  const filteredVideos = useMemo(() => {
    if (!videos) return [];
    return videos
      .filter((v) => {
        // Use the DB type if available, otherwise fallback to duration calculation
        if (v.type) {
          if (contentFilter === "shorts") return v.type === "SHORTS";
          if (contentFilter === "long") return v.type === "LONG";
          return true;
        }
        const durationSec = parseDuration(v.duration);
        if (contentFilter === "shorts") return durationSec <= 60;
        if (contentFilter === "long") return durationSec > 60;
        return true;
      })
      .slice(0, 10);
  }, [videos, contentFilter]);

  const contentMetrics = useMemo(() => {
    if (!videos || videos.length === 0) return null;
    const totalViews = videos.reduce((sum, v) => sum + v.viewCount, 0);
    const totalLikes = videos.reduce((sum, v) => sum + v.likeCount, 0);
    const totalComments = videos.reduce((sum, v) => sum + v.commentCount, 0);
    const avgViews = totalViews / videos.length;

    // Ratios
    // Use pre-calculated DB metrics if they are available (not 0)
    if (creator.engagementRate > 0) {
      return {
        totalLikes: creator.avgLikes * videos.length,
        totalComments: creator.avgComments * videos.length,
        engagementRate: creator.engagementRate,
        viewsPerSubs: creator.viewsPerSubs,
        likesPerViews: totalViews > 0 ? (totalLikes / totalViews) * 100 : 0,
        commentsPerViews:
          totalViews > 0 ? (totalComments / totalViews) * 100 : 0,
      };
    }

    const engagementRate =
      totalViews > 0 ? ((totalLikes + totalComments) / totalViews) * 100 : 0;
    const viewsPerSubs =
      creator.currentSubs > 0 ? (avgViews / creator.currentSubs) * 100 : 0;
    const likesPerViews = totalViews > 0 ? (totalLikes / totalViews) * 100 : 0;
    const commentsPerViews =
      totalViews > 0 ? (totalComments / totalViews) * 100 : 0;

    return {
      totalLikes,
      totalComments,
      engagementRate,
      viewsPerSubs,
      likesPerViews,
      commentsPerViews,
    };
  }, [
    videos,
    creator.currentSubs,
    creator.engagementRate,
    creator.viewsPerSubs,
    creator.avgLikes,
    creator.avgComments,
  ]);

  return (
    <div className="h-full flex flex-col bg-background text-foreground overflow-hidden">
      {/* 1. Outer Tabs & YouTube Link */}
      <div className="flex items-center justify-between px-6 border-b border-border-exchange bg-card h-12 flex-shrink-0">
        <div className="flex h-full">
          <button
            onClick={() => setActiveTab("trending")}
            className={`px-6 h-full text-sm font-bold transition-all relative flex items-center justify-center ${
              activeTab === "trending"
                ? "text-primary bg-primary/5"
                : "text-muted hover:text-foreground hover:bg-card/50"
            }`}
          >
            {t("channel.trending")}
            {activeTab === "trending" && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary" />
            )}
          </button>
          <button
            onClick={() => setActiveTab("content")}
            className={`px-6 h-full text-sm font-bold transition-all relative flex items-center justify-center ${
              activeTab === "content"
                ? "text-primary bg-primary/5"
                : "text-muted hover:text-foreground hover:bg-card/50"
            }`}
          >
            {t("channel.content")}
            {activeTab === "content" && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary" />
            )}
          </button>
        </div>

        <a
          href={`https://youtube.com/channel/${creator.youtubeChannelId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs font-bold text-muted hover:text-primary transition-colors bg-card hover:bg-slate-50 px-3 py-1.5 rounded border border-border-exchange shadow-sm group"
        >
          <svg
            className="w-4 h-4 text-down group-hover:text-primary transition-colors"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
          </svg>
          {t("channel.visitYoutube")}
        </a>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {activeTab === "trending" ? (
          <div className="p-6 space-y-8 animate-in fade-in duration-300">
            {/* Market Info Row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-card p-4 rounded-lg border border-border-exchange flex justify-between items-center shadow-sm">
                <span className="text-xs text-muted font-bold tracking-wider">
                  {t("channel.marketCap").toUpperCase()}
                </span>
                <span className="text-xl font-mono font-bold text-primary">
                  {formatNumber(marketCap)} P
                </span>
              </div>
              <div className="bg-card p-4 rounded-lg border border-border-exchange flex justify-between items-center shadow-sm">
                <span className="text-xs text-muted font-bold tracking-wider">
                  {t("channel.liquidity").toUpperCase()}
                </span>
                <span className="text-xl font-mono font-bold">
                  {formatNumber(creator.liquidity)} P
                </span>
              </div>
            </div>

            {/* Momentum Cards */}
            <div>
              <h3 className="text-sm font-bold text-muted mb-4 flex items-center gap-2 uppercase tracking-wider">
                <span className="w-1 h-4 bg-primary rounded-full"></span>
                {t("channel.trending")}
              </h3>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MomentumCard
                  label={t("channel.subsChange7d")}
                  value={momentum?.subsGrowth7d || 0}
                  subValue={t("channel.subscribers")}
                  isPositive={(momentum?.subsGrowth7d || 0) >= 0}
                  loading={!momentum?.hasEnoughData7d}
                  t={t}
                />
                <MomentumCard
                  label={t("channel.subsChange30d")}
                  value={momentum?.subsGrowth30d || 0}
                  subValue={
                    momentum?.subsGrowthRate30d !== undefined
                      ? `${momentum.subsGrowthRate30d.toFixed(1)}% ${t(
                          "channel.growth"
                        )}`
                      : "N/A"
                  }
                  isPositive={(momentum?.subsGrowth30d || 0) >= 0}
                  loading={!momentum?.hasEnoughData30d}
                  t={t}
                />
                <MomentumCard
                  label={t("channel.viewsChange7d")}
                  value={momentum?.viewsGrowth7d || 0}
                  subValue={t("channel.totalViews")}
                  isPositive={(momentum?.viewsGrowth7d || 0) >= 0}
                  loading={!momentum?.hasEnoughData7d}
                  t={t}
                />
                <MomentumCard
                  label={t("channel.viewsChange30d")}
                  value={momentum?.viewsGrowth30d || 0}
                  subValue={
                    momentum?.viewsGrowthRate30d !== undefined
                      ? `${momentum.viewsGrowthRate30d.toFixed(1)}% ${t(
                          "channel.growth"
                        )}`
                      : "N/A"
                  }
                  isPositive={(momentum?.viewsGrowth30d || 0) >= 0}
                  loading={!momentum?.hasEnoughData30d}
                  t={t}
                />
              </div>
            </div>

            {/* Charts Section */}
            <div className="flex flex-col h-[400px] border border-border-exchange rounded bg-card/20 overflow-hidden shadow-sm">
              <div className="flex items-center justify-between p-4 border-b border-border-exchange bg-card/40">
                <div className="flex gap-1 h-8 bg-background p-1 rounded border border-border-exchange">
                  <button
                    onClick={() => setChartMode("subs")}
                    className={`px-3 py-1 text-[11px] font-bold rounded transition-colors ${
                      chartMode === "subs"
                        ? "bg-border-exchange text-foreground"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    {t("channel.subscribers")}
                  </button>
                  <button
                    onClick={() => setChartMode("views")}
                    className={`px-3 py-1 text-[11px] font-bold rounded transition-colors ${
                      chartMode === "views"
                        ? "bg-border-exchange text-foreground"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    {t("channel.totalViews")}
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setTimeRange("30d")}
                    className={`px-3 py-1 text-xs font-bold rounded transition-colors ${
                      timeRange === "30d"
                        ? "text-primary bg-primary/10"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    30D
                  </button>
                  <button
                    onClick={() => setTimeRange("90d")}
                    className={`px-3 py-1 text-xs font-bold rounded transition-colors ${
                      timeRange === "90d"
                        ? "text-primary bg-primary/10"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    90D
                  </button>
                </div>
              </div>
              <div className="flex-1 p-4 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient
                        id="colorValue"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="var(--primary)"
                          stopOpacity={0.2}
                        />
                        <stop
                          offset="95%"
                          stopColor="var(--primary)"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--border)"
                      vertical={false}
                      opacity={0.3}
                    />
                    <XAxis
                      dataKey="dateFormatted"
                      stroke="var(--muted)"
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={40}
                    />
                    <YAxis
                      stroke="var(--muted)"
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={formatNumber}
                      domain={["auto", "auto"]}
                      orientation="right"
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--card)",
                        borderColor: "var(--border)",
                        borderRadius: "4px",
                        color: "var(--foreground)",
                        fontSize: "12px",
                      }}
                      itemStyle={{ color: "var(--primary)" }}
                      labelStyle={{
                        color: "var(--muted)",
                        marginBottom: "4px",
                      }}
                      formatter={(value: any) => [
                        new Intl.NumberFormat(
                          locale === "ko" ? "ko-KR" : "en-US"
                        ).format(value),
                        chartMode === "subs"
                          ? t("channel.subscribers")
                          : t("channel.totalViews"),
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey={chartMode}
                      stroke="var(--primary)"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorValue)"
                      animationDuration={1000}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-8 animate-in fade-in duration-300">
            {/* Content Filters */}
            <div className="flex gap-2 p-1 bg-card/60 rounded-lg w-fit border border-border-exchange shadow-sm">
              <button
                onClick={() => setContentFilter("all")}
                className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${
                  contentFilter === "all"
                    ? "bg-primary text-white shadow-md scale-[1.02]"
                    : "text-muted hover:text-foreground hover:bg-card"
                }`}
              >
                {t("channel.all")}
              </button>
              <button
                onClick={() => setContentFilter("long")}
                className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${
                  contentFilter === "long"
                    ? "bg-primary text-white shadow-md scale-[1.02]"
                    : "text-muted hover:text-foreground hover:bg-card"
                }`}
              >
                {t("channel.longVideos")}
              </button>
              <button
                onClick={() => setContentFilter("shorts")}
                className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${
                  contentFilter === "shorts"
                    ? "bg-primary text-white shadow-md scale-[1.02]"
                    : "text-muted hover:text-foreground hover:bg-card"
                }`}
              >
                {t("channel.shorts")}
              </button>
            </div>

            {/* Engagement Gauges (Image Inspired) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
              <GaugeCard
                label={t("channel.engagementRate")}
                value={contentMetrics?.engagementRate || 0}
                color="#0ecb81"
                status="EXCELLENT"
              />
              <GaugeCard
                label={t("channel.viewsPerSubs")}
                value={contentMetrics?.viewsPerSubs || 0}
                color="#fcd535"
                status="GOOD"
              />
              <GaugeCard
                label={t("channel.likesPerViews")}
                value={contentMetrics?.likesPerViews || 0}
                color="#f6465d"
                status="NORMAL"
              />
              <GaugeCard
                label={t("channel.commentsPerViews")}
                value={contentMetrics?.commentsPerViews || 0}
                color="#0ecb81"
                status="EXCELLENT"
              />
            </div>

            {/* Engagement Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-card/40 p-4 rounded-lg border border-border-exchange flex justify-between items-center shadow-sm">
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted font-bold tracking-wider uppercase mb-1">
                    {t("channel.likes")}
                  </span>
                  <span className="text-2xl font-mono font-bold">
                    {formatNumber(contentMetrics?.totalLikes || 0)}
                  </span>
                </div>
                <div className="text-up opacity-20">
                  <svg
                    className="w-8 h-8"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z" />
                  </svg>
                </div>
              </div>
              <div className="bg-card/40 p-4 rounded-lg border border-border-exchange flex justify-between items-center shadow-sm">
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted font-bold tracking-wider uppercase mb-1">
                    {t("channel.comments")}
                  </span>
                  <span className="text-2xl font-mono font-bold">
                    {formatNumber(contentMetrics?.totalComments || 0)}
                  </span>
                </div>
                <div className="text-primary opacity-20">
                  <svg
                    className="w-8 h-8"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M21.99 4c0-1.1-.89-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Performance Chart */}
            <div className="h-64 border border-border-exchange rounded-lg bg-card/10 p-4">
              <h4 className="text-[10px] font-bold text-muted uppercase mb-4 tracking-tighter">
                Engagement performance (Last 10)
              </h4>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={[...filteredVideos].reverse()}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--border)"
                    vertical={false}
                    opacity={0.2}
                  />
                  <XAxis dataKey="title" hide />
                  <YAxis yAxisId="left" hide />
                  <YAxis yAxisId="right" orientation="right" hide />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--card)",
                      borderColor: "var(--border)",
                      borderRadius: "4px",
                      fontSize: "11px",
                    }}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="viewCount"
                    fill="var(--primary)"
                    opacity={0.3}
                    radius={[2, 2, 0, 0]}
                  />
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="likeCount"
                    stroke="var(--up)"
                    fill="var(--up)"
                    fillOpacity={0.1}
                    strokeWidth={2}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Recent 10 Videos List */}
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-muted flex items-center gap-2 uppercase tracking-wider">
                <span className="w-1 h-4 bg-primary rounded-full"></span>
                RECENT 10 CONTENT
              </h3>
              <div className="grid grid-cols-1 gap-3">
                {filteredVideos.map((video) => (
                  <div
                    key={video.id}
                    className="flex gap-4 p-3 bg-card/20 rounded-lg border border-border-exchange hover:border-muted transition-all group"
                  >
                    <div className="relative w-32 h-20 flex-shrink-0 overflow-hidden rounded">
                      <img
                        src={video.thumbnailUrl}
                        alt=""
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute bottom-1 right-1 bg-black/80 text-[10px] px-1 rounded font-mono text-white">
                        {video.duration
                          .replace("PT", "")
                          .replace("M", ":")
                          .replace("S", "")}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                      <h4 className="text-sm font-bold line-clamp-1">
                        {video.title}
                      </h4>
                      <div className="flex gap-4 text-[11px] text-muted font-mono">
                        <span className="flex items-center gap-1">
                          <span className="text-[10px] uppercase">Views</span>{" "}
                          {formatNumber(video.viewCount)}
                        </span>
                        <span className="flex items-center gap-1 text-up">
                          <span className="text-[10px] uppercase text-muted">
                            Likes
                          </span>{" "}
                          {formatNumber(video.likeCount)}
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="text-[10px] uppercase">
                            Comments
                          </span>{" "}
                          {formatNumber(video.commentCount)}
                        </span>
                      </div>
                      <div className="text-[10px] text-muted">
                        {new Date(video.publishedAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
                {filteredVideos.length === 0 && (
                  <div className="py-12 text-center text-muted border border-dashed border-border-exchange rounded-lg">
                    No videos found for this filter.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MomentumCard({ label, value, subValue, isPositive, loading, t }: any) {
  if (loading)
    return (
      <div className="bg-card/40 p-4 rounded border border-border-exchange opacity-60">
        <div className="text-[10px] text-muted font-bold uppercase mb-2">
          {label}
        </div>
        <div className="text-xs bg-background text-muted inline-block px-2 py-1 rounded border border-border-exchange">
          {t("channel.collectingData")}
        </div>
      </div>
    );
  return (
    <div className="bg-card/40 p-4 rounded border border-border-exchange hover:border-muted transition-colors shadow-sm">
      <div className="text-[10px] text-muted font-bold uppercase mb-2">
        {label}
      </div>
      <div
        className={`text-lg font-mono font-bold flex items-center gap-1 ${
          isPositive ? "text-up" : "text-down"
        }`}
      >
        <span>{isPositive ? "▲" : "▼"}</span>
        {new Intl.NumberFormat("en-US", { notation: "compact" }).format(
          Math.abs(value)
        )}
      </div>
      <div className="text-xs text-muted mt-1">{subValue}</div>
    </div>
  );
}

function GaugeCard({
  label,
  value,
  color,
  status,
}: {
  label: string;
  value: number;
  color: string;
  status: string;
}) {
  const percentage = Math.min(100, Math.max(0, value * 5)); // Scaling for display
  return (
    <div className="flex flex-col items-center gap-3 p-4 bg-card/20 rounded-lg border border-border-exchange shadow-sm transition-all hover:bg-card/30">
      <div className="relative w-24 h-24">
        <svg
          className="w-full h-full transform -rotate-90"
          viewBox="0 0 100 100"
        >
          <circle
            cx="50"
            cy="50"
            r="42"
            stroke="var(--border)"
            strokeWidth="6"
            fill="transparent"
            opacity="0.3"
          />
          <circle
            cx="50"
            cy="50"
            r="42"
            stroke={color}
            strokeWidth="6"
            fill="transparent"
            strokeDasharray="264"
            strokeDashoffset={264 - (264 * percentage) / 100}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center flex-col">
          <span className="text-[13px] font-black mono">
            {value.toFixed(2)}%
          </span>
          <span className="text-[9px] font-bold" style={{ color }}>
            {status}
          </span>
        </div>
      </div>
      <span className="text-[10px] font-bold text-muted uppercase tracking-tight text-center leading-tight">
        {label}
      </span>
      <div className="w-full h-[1px] bg-border-exchange opacity-50 mt-1" />
      <span className="text-[9px] text-muted text-center italic opacity-60">
        Avg. 1.07%~3.76%
      </span>
    </div>
  );
}
