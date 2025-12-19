export interface HistoryPoint {
  date: string | Date;
  price: number;
  volume?: number;
}

export interface CandleData {
  time: number; // Unix timestamp
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface VolumeData {
  time: number;
  value: number;
  color?: string;
}

/**
 * Convert raw linear data points into OHLC candles.
 * This is a client-side approximation useful for MVP when backend aggregation isn't ready.
 *
 * @param data Array of { date, price } sorted by date ascending
 * @param intervalMinutes Duration of each candle in minutes
 */
export function generateCandles(
  data: HistoryPoint[],
  intervalMinutes: number = 5
): { candles: CandleData[]; volume: VolumeData[] } {
  if (!data || data.length === 0) return { candles: [], volume: [] };

  const candles: CandleData[] = [];
  const volumes: VolumeData[] = [];

  // Group data by time buckets
  const intervalMs = intervalMinutes * 60 * 1000;
  const grouped = new Map<number, HistoryPoint[]>();

  data.forEach((point) => {
    const time = new Date(point.date).getTime();
    const bucketTime = Math.floor(time / intervalMs) * intervalMs;

    if (!grouped.has(bucketTime)) {
      grouped.set(bucketTime, []);
    }
    grouped.get(bucketTime)!.push(point);
  });

  // Sort buckets just in case
  const sortedTimes = Array.from(grouped.keys()).sort((a, b) => a - b);

  sortedTimes.forEach((time) => {
    const points = grouped.get(time)!;

    // Sort points within bucket by time
    points.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    let open = points[0].price;
    let close = points[points.length - 1].price;
    const prices = points.map((p) => p.price);
    let high = Math.max(...prices);
    let low = Math.min(...prices);

    // Ensure there's a visible spread between Open and Close for "body" color
    // If they are exactly the same, jitter one of them slightly.
    if (open === close) {
      const jitter = open * 0.0005; // 0.05% jitter
      close = open + (Math.random() > 0.5 ? jitter : -jitter);
    }

    // Ensure High/Low encapsulate the new Open/Close
    high = Math.max(high, open, close);
    low = Math.min(low, open, close);

    // Add a tiny extra wick if flat
    if (high === low) {
      high += open * 0.001;
      low -= open * 0.001;
    }

    // Convert to Unix timestamp (seconds) for lightweight-charts
    const timeSeconds = time / 1000;

    candles.push({
      time: timeSeconds as any,
      open,
      high,
      low,
      close,
    });

    // Upbit uses Red for Up, Blue for Down
    const isUp = close >= open;
    const color = isUp ? "#dd3c44" : "#003597";

    // Dynamic Volume Generation
    let vol = 0;
    if (points[0].volume !== undefined) {
      vol = points.reduce((acc, p) => acc + (p.volume || 0), 0);
    } else {
      const priceMovement = Math.abs(close - open) + (high - low);
      vol =
        100 + Math.floor(priceMovement * 50) + Math.floor(Math.random() * 500);
    }

    volumes.push({
      time: timeSeconds as any,
      value: vol,
      color: isUp ? "#dd3c4455" : "#00359755", // Transparent volume colors
    });
  });

  // Fill gaps if strictly needed? Lightweight-charts handles gaps fine naturally.

  return { candles, volume: volumes };
}
