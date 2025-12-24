"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import {
  createChart,
  ColorType,
  ISeriesApi,
  Time,
  UTCTimestamp,
  CrosshairMode,
  MouseEventParams,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
} from "lightweight-charts";
import { generateCandles, CandleData, VolumeData } from "@/lib/candle-utils";
import { useTheme } from "next-themes";
import { useLanguage } from "@/lib/LanguageContext";

interface MarketChartProps {
  data: Array<{
    date: string | Date; // Raw history point
    price: number;
    volume?: number;
  }>;
}

export function MarketChart({ data }: MarketChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null); // Store chart instance
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  // 0. Hydration Fix
  const [mounted, setMounted] = useState(false);
  const { theme } = useTheme();
  const [showVolume, setShowVolume] = useState(true);

  useEffect(() => {
    setMounted(true);
  }, []);

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    ohlc: { open: number; high: number; low: number; close: number } | null;
    volume: number | null;
    timeStr: string;
  } | null>(null);

  // 1. Transform Data using Utils
  const { processedCandles, processedVolume } = useMemo(() => {
    if (!mounted) return { processedCandles: [], processedVolume: [] };
    const result = generateCandles(data, 1); // 1 minute candles for smoother MVP look
    return { processedCandles: result.candles, processedVolume: result.volume };
  }, [data, mounted]);

  // 2. Initialize Chart
  useEffect(() => {
    if (!mounted || !chartContainerRef.current) return;

    const isDark = theme === "dark";

    // Theme-aware Colors (Upbit Refined)
    const UP_COLOR = isDark ? "#0ecb81" : "#d24f45";
    const DOWN_COLOR = isDark ? "#f6465d" : "#1261c4";
    const BG_COLOR = isDark ? "#0b0e11" : "#ffffff";
    const TEXT_COLOR = isDark ? "#848e9c" : "#666666";
    const GRID_COLOR = isDark ? "#2b3139" : "#f1f1f4";

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: BG_COLOR },
        textColor: TEXT_COLOR,
      },
      grid: {
        vertLines: { color: GRID_COLOR },
        horzLines: { color: GRID_COLOR },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: GRID_COLOR,
        scaleMargins: {
          top: 0.1,
          bottom: 0.1, // Reduced margin to minimize empty space at bottom
        },

        autoScale: true,
      },
      timeScale: {
        borderColor: GRID_COLOR,
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 12,
      },
    }) as any;

    chartRef.current = chart;

    // 1. Candlestick Series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderUpColor: UP_COLOR,
      borderDownColor: DOWN_COLOR,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
    });
    candleSeries.setData(processedCandles as any);
    candleSeriesRef.current = candleSeries;

    // 2. Moving Averages
    const calculateMA = (data: any[], count: number) => {
      const result = [];
      for (let i = 0; i < data.length; i++) {
        if (i < count - 1) continue;
        const sum = data
          .slice(i - count + 1, i + 1)
          .reduce((acc, val) => acc + val.close, 0);
        result.push({ time: data[i].time, value: sum / count });
      }
      return result;
    };

    const ma5Series = chart.addSeries(LineSeries, {
      color: "#fcd535",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ma5Series.setData(calculateMA(processedCandles, 5));

    const ma20Series = chart.addSeries(LineSeries, {
      color: "#0ecb81",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ma20Series.setData(calculateMA(processedCandles, 20));

    // 3. Optional Volume Series
    if (volumeSeriesRef.current && !showVolume) {
      chart.removeSeries(volumeSeriesRef.current);
      volumeSeriesRef.current = null;
    }

    if (showVolume && !volumeSeriesRef.current) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: {
          type: "volume",
        },
        priceScaleId: "",
      });

      volumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
      });

      volumeSeries.setData(processedVolume as any);
      volumeSeriesRef.current = volumeSeries;
    } else if (showVolume && volumeSeriesRef.current) {
      // If volume is shown and series already exists, just update data
      volumeSeriesRef.current.setData(processedVolume as any);
    }

    chart.subscribeCrosshairMove((param: MouseEventParams) => {
      if (
        param.point === undefined ||
        !param.time ||
        param.point.x < 0 ||
        param.point.x > chartContainerRef.current!.clientWidth ||
        param.point.y < 0 ||
        param.point.y > chartContainerRef.current!.clientHeight
      ) {
        setTooltip(null);
      } else {
        const dateStr = new Date(
          (param.time as number) * 1000
        ).toLocaleString();

        const candleData = param.seriesData.get(candleSeries) as any;
        const volumeData = volumeSeriesRef.current
          ? (param.seriesData.get(volumeSeriesRef.current) as any)
          : null;

        if (candleData) {
          setTooltip({
            visible: true,
            x: param.point.x,
            y: param.point.y,
            ohlc: candleData,
            volume: volumeData ? volumeData.value : null,
            timeStr: dateStr,
          });
        }
      }
    });

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [mounted, processedCandles, processedVolume, theme, showVolume]);

  if (!mounted) {
    return (
      <div className="flex-1 flex items-center justify-center bg-card text-muted min-h-[400px]">
        Loading Chart...
      </div>
    );
  }

  return (
    <div className="flex-1 relative bg-card min-h-[400px] w-full h-full flex flex-col">
      {/* Chart Legend / Floating Tooltip */}
      <div className="absolute top-2 left-2 z-10 font-mono text-[10px] pointer-events-none select-none bg-card/80 p-1.5 rounded-sm border border-border-exchange">
        {tooltip && tooltip.ohlc ? (
          <div className="flex space-x-3 text-foreground">
            <span>
              O:{" "}
              <span
                className={
                  tooltip.ohlc.close >= tooltip.ohlc.open
                    ? "text-up"
                    : "text-down"
                }
              >
                {tooltip.ohlc.open.toLocaleString()}
              </span>
            </span>
            <span>
              H:{" "}
              <span
                className={
                  tooltip.ohlc.close >= tooltip.ohlc.open
                    ? "text-up"
                    : "text-down"
                }
              >
                {tooltip.ohlc.high.toLocaleString()}
              </span>
            </span>
            <span>
              L:{" "}
              <span
                className={
                  tooltip.ohlc.close >= tooltip.ohlc.open
                    ? "text-up"
                    : "text-down"
                }
              >
                {tooltip.ohlc.low.toLocaleString()}
              </span>
            </span>
            <span>
              C:{" "}
              <span
                className={
                  tooltip.ohlc.close >= tooltip.ohlc.open
                    ? "text-up"
                    : "text-down"
                }
              >
                {tooltip.ohlc.close.toLocaleString()}
              </span>
            </span>
            {showVolume && tooltip.volume && (
              <span>
                V:{" "}
                <span className="text-muted">
                  {Math.floor(tooltip.volume).toLocaleString()}
                </span>
              </span>
            )}
          </div>
        ) : (
          <div className="text-muted">Market Price (KRW)</div>
        )}
      </div>

      <div ref={chartContainerRef} className="flex-1 w-full h-full" />

      {/* Stats Toggle (Top Right) */}
      <div className="absolute top-2 right-2 flex space-x-2">
        <button
          onClick={() => setShowVolume(!showVolume)}
          className={`px-2 py-1 text-[10px] font-bold rounded border transition-colors ${
            showVolume
              ? "bg-primary/20 text-primary border-primary/50"
              : "bg-card text-muted border-border-exchange"
          }`}
        >
          Vol
        </button>
      </div>
    </div>
  );
}
