"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import {
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
} from "lightweight-charts";
import { generateCandles } from "@/lib/candle-utils";
import { useTheme } from "next-themes";

interface MarketChartProps {
  data: Array<{
    date: string | Date; // Raw history point
    price: number;
    volume?: number;
  }>;
}

const LIGHT_CHART_COLORS = {
  up: "#d24f45",
  down: "#1261c4",
  background: "#ffffff",
  text: "#666666",
  grid: "#f1f1f4",
} as const;

function calculateMA(data: readonly CandlestickData[], count: number): LineData[] {
  const result: LineData[] = [];

  for (let i = count - 1; i < data.length; i += 1) {
    const sum = data
      .slice(i - count + 1, i + 1)
      .reduce((acc, value) => acc + value.close, 0);
    result.push({ time: data[i].time, value: sum / count });
  }

  return result;
}

function isOhlcData(
  value: unknown,
): value is Pick<CandlestickData, "open" | "high" | "low" | "close"> {
  return (
    typeof value === "object" &&
    value !== null &&
    "open" in value &&
    typeof value.open === "number" &&
    "high" in value &&
    typeof value.high === "number" &&
    "low" in value &&
    typeof value.low === "number" &&
    "close" in value &&
    typeof value.close === "number"
  );
}

function isHistogramData(
  value: unknown,
): value is Pick<HistogramData, "value"> {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    typeof value.value === "number"
  );
}

function formatCrosshairTime(time: Time): string {
  if (typeof time === "number") {
    return new Date(time * 1000).toLocaleString();
  }

  if (typeof time === "string") {
    return time;
  }

  return new Date(Date.UTC(time.year, time.month - 1, time.day)).toLocaleString();
}

export function MarketChart({ data }: MarketChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ma5SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const { theme } = useTheme();
  const [showVolume, setShowVolume] = useState(true);

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
    const result = generateCandles(data, 1); // 1 minute candles for smoother MVP look
    const processedCandles: CandlestickData[] = result.candles.map(
      ({ time, ...candle }) => ({
        ...candle,
        time: time as UTCTimestamp,
      }),
    );
    const processedVolume: HistogramData[] = result.volume.map(
      ({ time, ...volume }) => ({
        ...volume,
        time: time as UTCTimestamp,
      }),
    );

    return { processedCandles, processedVolume };
  }, [data]);

  const isDark = theme === "dark";

  // Theme-aware Colors (Upbit Refined)
  const UP_COLOR = isDark ? "#0ecb81" : LIGHT_CHART_COLORS.up;
  const DOWN_COLOR = isDark ? "#f6465d" : LIGHT_CHART_COLORS.down;
  const BG_COLOR = isDark ? "#0b0e11" : LIGHT_CHART_COLORS.background;
  const TEXT_COLOR = isDark ? "#848e9c" : LIGHT_CHART_COLORS.text;
  const GRID_COLOR = isDark ? "#2b3139" : LIGHT_CHART_COLORS.grid;

  // 2. Initialize Chart (Run Once)
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;
    if (chartRef.current) return;

    const chart = createChart(container, {
      layout: {
        background: {
          type: ColorType.Solid,
          color: LIGHT_CHART_COLORS.background,
        },
        textColor: LIGHT_CHART_COLORS.text,
      },
      grid: {
        vertLines: { color: LIGHT_CHART_COLORS.grid },
        horzLines: { color: LIGHT_CHART_COLORS.grid },
      },
      width: container.clientWidth,
      height: container.clientHeight,
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: LIGHT_CHART_COLORS.grid,
        scaleMargins: {
          top: 0.1,
          bottom: 0.1, // Reduced margin to minimize empty space at bottom
        },
        autoScale: true,
      },
      timeScale: {
        borderColor: LIGHT_CHART_COLORS.grid,
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 12,
      },
    });

    chartRef.current = chart;

    // 1. Candlestick Series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: LIGHT_CHART_COLORS.up,
      downColor: LIGHT_CHART_COLORS.down,
      borderUpColor: LIGHT_CHART_COLORS.up,
      borderDownColor: LIGHT_CHART_COLORS.down,
      wickUpColor: LIGHT_CHART_COLORS.up,
      wickDownColor: LIGHT_CHART_COLORS.down,
    });
    candleSeriesRef.current = candleSeries;

    // 2. Moving Averages
    const ma5Series = chart.addSeries(LineSeries, {
      color: "#fcd535",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ma5SeriesRef.current = ma5Series;

    const ma20Series = chart.addSeries(LineSeries, {
      color: "#0ecb81",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ma20SeriesRef.current = ma20Series;

    // 3. Volume Series
    const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: {
          type: "volume",
        },
        priceScaleId: "",
        visible: true,
    });
    volumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
    });
    volumeSeriesRef.current = volumeSeries;

    // Crosshair Handler
    chart.subscribeCrosshairMove((param: MouseEventParams) => {
      if (
        param.point === undefined ||
        !param.time ||
        param.point.x < 0 ||
        param.point.x > container.clientWidth ||
        param.point.y < 0 ||
        param.point.y > container.clientHeight
      ) {
        setTooltip(null);
      } else {
        const dateStr = formatCrosshairTime(param.time);

        const cSeries = candleSeriesRef.current;
        const vSeries = volumeSeriesRef.current;

        const candleData = cSeries ? param.seriesData.get(cSeries) : null;
        const volumeData = vSeries ? param.seriesData.get(vSeries) : null;

        if (isOhlcData(candleData)) {
          setTooltip({
            visible: true,
            x: param.point.x,
            y: param.point.y,
            ohlc: candleData,
            volume: isHistogramData(volumeData) ? volumeData.value : null,
            timeStr: dateStr,
          });
        }
      }
    });

    // Cleanup
    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        candleSeriesRef.current = null;
        volumeSeriesRef.current = null;
        ma5SeriesRef.current = null;
        ma20SeriesRef.current = null;
      }
    };
  }, []);

  // 3. Update Data Effect
  useEffect(() => {
    if (!chartRef.current) return;
    
    if (candleSeriesRef.current) {
        candleSeriesRef.current.setData(processedCandles);
    }
    if (ma5SeriesRef.current) {
        ma5SeriesRef.current.setData(calculateMA(processedCandles, 5));
    }
    if (ma20SeriesRef.current) {
        ma20SeriesRef.current.setData(calculateMA(processedCandles, 20));
    }
    if (volumeSeriesRef.current) {
        volumeSeriesRef.current.setData(processedVolume);
    }
    
    chartRef.current.timeScale().fitContent();
  }, [processedCandles, processedVolume]);

  // 4. Update Theme Effect
  useEffect(() => {
    if (!chartRef.current) return;

    chartRef.current.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: BG_COLOR },
        textColor: TEXT_COLOR,
      },
      grid: {
        vertLines: { color: GRID_COLOR },
        horzLines: { color: GRID_COLOR },
      },
      rightPriceScale: { borderColor: GRID_COLOR },
      timeScale: { borderColor: GRID_COLOR },
    });

    if (candleSeriesRef.current) {
        candleSeriesRef.current.applyOptions({
            upColor: UP_COLOR,
            downColor: DOWN_COLOR,
            borderUpColor: UP_COLOR,
            borderDownColor: DOWN_COLOR,
            wickUpColor: UP_COLOR,
            wickDownColor: DOWN_COLOR,
        });
    }
  }, [theme, BG_COLOR, TEXT_COLOR, GRID_COLOR, UP_COLOR, DOWN_COLOR]);

  // 5. Update Volume Visibility
  useEffect(() => {
      if (volumeSeriesRef.current) {
          volumeSeriesRef.current.applyOptions({
              visible: showVolume
          });
      }
  }, [showVolume]);

  // 6. Handle Resize
  useEffect(() => {
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

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
