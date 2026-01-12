/**
 * Candle aggregation utilities
 *
 * Shared between server-side DataRepository and client-side components
 */

export interface CandleData {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TickData {
  timestamp: string;
  price: string;
  size: string;
}

/**
 * Aggregate raw ticks into OHLC candles for a given interval
 * @param ticks - Array of raw tick data
 * @param intervalSeconds - Candle interval in seconds (e.g., 15, 30, 60)
 * @returns Array of candle data
 */
export function aggregateTicksToCandles(ticks: TickData[], intervalSeconds: number): CandleData[] {
  if (ticks.length === 0) return [];

  const candles: CandleData[] = [];
  let currentCandle: CandleData | null = null;

  for (const tick of ticks) {
    const tickTime = new Date(tick.timestamp).getTime() / 1000;
    const candleTime = Math.floor(tickTime / intervalSeconds) * intervalSeconds;
    const price = parseFloat(tick.price);
    const size = parseFloat(tick.size);

    if (!currentCandle || currentCandle.time !== candleTime) {
      // Save previous candle if exists
      if (currentCandle) {
        candles.push(currentCandle);
      }

      // Start new candle
      currentCandle = {
        time: candleTime,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: size,
      };
    } else {
      // Update current candle
      currentCandle.high = Math.max(currentCandle.high, price);
      currentCandle.low = Math.min(currentCandle.low, price);
      currentCandle.close = price;
      currentCandle.volume += size;
    }
  }

  // Don't forget the last candle
  if (currentCandle) {
    candles.push(currentCandle);
  }

  return candles;
}
