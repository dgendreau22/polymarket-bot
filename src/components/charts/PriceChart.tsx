"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import {
  createChart,
  IChartApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  CandlestickData,
  LineData,
  Time,
  ColorType,
  CandlestickSeries,
  LineSeries,
  CrosshairMode,
} from "lightweight-charts";

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface RawTick {
  time: number; // epoch seconds
  price: number;
}

interface RawBtcTick {
  time: number; // epoch ms
  price: number;
}

const TIMEFRAMES = [
  { label: "1s", seconds: 1 },
  { label: "5s", seconds: 5 },
  { label: "15s", seconds: 15 },
  { label: "30s", seconds: 30 },
  { label: "1m", seconds: 60 },
] as const;

const MAX_RAW_TICKS = 7200; // Store up to ~2 hours of ticks
const MAX_CANDLES = 300;

function buildCandlesFromTicks(
  ticks: RawTick[],
  intervalSec: number
): CandlestickData[] {
  const buckets = new Map<number, CandlestickData>();
  for (const tick of ticks) {
    const bucketTime = Math.floor(tick.time / intervalSec) * intervalSec;
    const existing = buckets.get(bucketTime);
    if (existing) {
      existing.high = Math.max(existing.high, tick.price);
      existing.low = Math.min(existing.low, tick.price);
      existing.close = tick.price;
    } else {
      buckets.set(bucketTime, {
        time: bucketTime as Time,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
      });
    }
  }
  const candles = Array.from(buckets.values()).sort(
    (a, b) => (a.time as number) - (b.time as number)
  );
  // Trim to max candles (keep latest)
  if (candles.length > MAX_CANDLES) {
    return candles.slice(candles.length - MAX_CANDLES);
  }
  return candles;
}

function buildLineDataFromTicks(
  ticks: { time: number; value: number }[],
  intervalSec: number
): LineData[] {
  const buckets = new Map<number, number>();
  for (const tick of ticks) {
    const bucketTime = Math.floor(tick.time / intervalSec) * intervalSec;
    buckets.set(bucketTime, tick.value); // Last value wins
  }
  const data: LineData[] = Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([time, value]) => ({ time: time as Time, value }));
  if (data.length > MAX_CANDLES) {
    return data.slice(data.length - MAX_CANDLES);
  }
  return data;
}

// Session break interval in seconds (15 minutes)
const SESSION_BREAK_INTERVAL = 15 * 60;

/**
 * Custom primitive to draw vertical dashed lines at session boundaries (every 15 minutes)
 */
class SessionBreaksPrimitive implements ISeriesPrimitive<Time> {
  private _chart: IChartApi;
  private _breakTimes: number[] = [];

  constructor(chart: IChartApi) {
    this._chart = chart;
  }

  updateBreakTimes(candles: CandlestickData[]) {
    if (candles.length === 0) {
      this._breakTimes = [];
      return;
    }

    const breaks: number[] = [];
    const firstTime = candles[0].time as number;
    const lastTime = candles[candles.length - 1].time as number;

    // Find the first 15-minute boundary at or after the first candle
    const firstBreak = Math.ceil(firstTime / SESSION_BREAK_INTERVAL) * SESSION_BREAK_INTERVAL;

    // Add all 15-minute boundaries within the data range
    for (let t = firstBreak; t <= lastTime; t += SESSION_BREAK_INTERVAL) {
      breaks.push(t);
    }

    this._breakTimes = breaks;
  }

  paneViews(): IPrimitivePaneView[] {
    return [new SessionBreaksPaneView(this._chart, this._breakTimes)];
  }
}

class SessionBreaksPaneView implements IPrimitivePaneView {
  private _chart: IChartApi;
  private _breakTimes: number[];

  constructor(chart: IChartApi, breakTimes: number[]) {
    this._chart = chart;
    this._breakTimes = breakTimes;
  }

  renderer(): IPrimitivePaneRenderer {
    return new SessionBreaksRenderer(this._chart, this._breakTimes);
  }

  zOrder(): "bottom" | "top" | "normal" {
    return "bottom";
  }
}

class SessionBreaksRenderer implements IPrimitivePaneRenderer {
  private _chart: IChartApi;
  private _breakTimes: number[];

  constructor(chart: IChartApi, breakTimes: number[]) {
    this._chart = chart;
    this._breakTimes = breakTimes;
  }

  draw(target: CanvasRenderingTarget2D) {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const { height } = scope.bitmapSize;
      const timeScale = this._chart.timeScale();

      ctx.save();
      ctx.strokeStyle = "#666";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);

      for (const breakTime of this._breakTimes) {
        const x = timeScale.timeToCoordinate(breakTime as Time);
        if (x === null) continue;

        // Scale for device pixel ratio
        const scaledX = Math.round(x * scope.horizontalPixelRatio);

        ctx.beginPath();
        ctx.moveTo(scaledX, 0);
        ctx.lineTo(scaledX, height);
        ctx.stroke();
      }

      ctx.restore();
    });
  }
}

// Type for the canvas rendering target in lightweight-charts v5
interface CanvasRenderingTarget2D {
  useBitmapCoordinateSpace(callback: (scope: {
    context: CanvasRenderingContext2D;
    bitmapSize: { width: number; height: number };
    horizontalPixelRatio: number;
    verticalPixelRatio: number;
  }) => void): void;
}

interface PriceChartProps {
  price: number | null;
  timestamp: string | null;
  btcPrice?: number | null;
  btcTimestamp?: number | null;
  intervalSeconds?: number;
  initialCandles?: CandleData[];
}

export function PriceChart({
  price,
  timestamp,
  btcPrice,
  btcTimestamp,
  intervalSeconds = 15,
  initialCandles,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // Note: lightweight-charts v5 uses complex generic types that don't work well with refs.
  // Using ReturnType to infer the correct series type from addSeries.
  const seriesRef = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);
  const btcSeriesRef = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);
  const sessionBreaksPrimitiveRef = useRef<SessionBreaksPrimitive | null>(null);
  const candlesRef = useRef<CandlestickData[]>([]);
  const btcDataRef = useRef<LineData[]>([]);
  const currentCandleTimeRef = useRef<number | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);

  // Timeframe and chart type selection state
  const [selectedInterval, setSelectedInterval] = useState(intervalSeconds);
  const [chartType, setChartType] = useState<"candles" | "line">("candles");

  // Raw tick storage for rebuilding on timeframe/type change
  const rawTicksRef = useRef<RawTick[]>([]);
  const rawBtcTicksRef = useRef<RawBtcTick[]>([]);

  // Get candle time bucket from timestamp
  const getCandleTime = useCallback(
    (ts: string): number | null => {
      const date = new Date(ts);
      const epochMs = date.getTime();
      if (isNaN(epochMs)) return null; // Invalid timestamp
      const epochSeconds = Math.floor(epochMs / 1000);
      return Math.floor(epochSeconds / selectedInterval) * selectedInterval;
    },
    [selectedInterval]
  );

  // Rebuild all series from raw ticks when timeframe/type changes
  const rebuildFromTicks = useCallback(() => {
    if (!seriesRef.current) return;

    // Rebuild price data
    const candles = buildCandlesFromTicks(rawTicksRef.current, selectedInterval);
    candlesRef.current = candles;
    currentCandleTimeRef.current = candles.length > 0
      ? (candles[candles.length - 1].time as number)
      : null;

    if (chartType === "line") {
      const lineData: LineData[] = candles.map((c) => ({
        time: c.time,
        value: c.close,
      }));
      seriesRef.current.setData(lineData);
    } else {
      seriesRef.current.setData(candles);
    }

    // Rebuild BTC line
    if (btcSeriesRef.current) {
      const btcTicks = rawBtcTicksRef.current.map((t) => ({
        time: Math.floor(t.time / 1000),
        value: t.price,
      }));
      const btcData = buildLineDataFromTicks(btcTicks, selectedInterval);
      btcDataRef.current = btcData;
      btcSeriesRef.current.setData(btcData);
    }

    // Update session breaks
    sessionBreaksPrimitiveRef.current?.updateBreakTimes(candles);

    // Fit content after rebuild
    chartRef.current?.timeScale().fitContent();
  }, [selectedInterval, chartType]);

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return;

    try {
      const isDark = document.documentElement.classList.contains("dark");

      const chart = createChart(containerRef.current, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: isDark ? "#888" : "#666",
        },
        grid: {
          vertLines: { color: isDark ? "#222" : "#eee" },
          horzLines: { color: isDark ? "#222" : "#eee" },
        },
        rightPriceScale: {
          borderVisible: false,
        },
        leftPriceScale: {
          visible: false,
          borderVisible: false,
        },
        timeScale: {
          borderVisible: false,
          timeVisible: true,
          secondsVisible: true,
          // Format axis tick labels in local timezone
          tickMarkFormatter: (time: number) => {
            const date = new Date(time * 1000);
            return date.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            });
          },
        },
        localization: {
          // Custom time formatter for crosshair tooltip
          timeFormatter: (time: number) => {
            const date = new Date(time * 1000);
            return date.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
          },
        },
        crosshair: {
          mode: CrosshairMode.Normal, // Free movement, not snapping to candles
          horzLine: {
            visible: true,
            labelVisible: true,
          },
          vertLine: {
            visible: true,
            labelVisible: true,
          },
        },
      });

      const series = chartType === "line"
        ? chart.addSeries(LineSeries, {
            color: "#22c55e",
            lineWidth: 2,
            lastValueVisible: true,
            priceLineVisible: false,
            priceFormat: {
              type: "price",
              precision: 2,
              minMove: 0.01,
            },
          })
        : chart.addSeries(CandlestickSeries, {
            upColor: "#22c55e",
            downColor: "#ef4444",
            borderUpColor: "#22c55e",
            borderDownColor: "#ef4444",
            wickUpColor: "#22c55e",
            wickDownColor: "#ef4444",
            priceFormat: {
              type: "price",
              precision: 2,
              minMove: 0.01,
            },
          });

      // Add BTC price line series on its own hidden scale (auto-scales independently)
      const btcSeries = chart.addSeries(LineSeries, {
        color: "#f59e0b", // amber/orange
        lineWidth: 2,
        priceScaleId: "btc",
        lastValueVisible: true,
        priceLineVisible: false,
        priceFormat: {
          type: "price",
          precision: 0,
          minMove: 1,
        },
      });

      // Hide the BTC price scale (values shown via last-value label on the line)
      chart.priceScale("btc").applyOptions({
        visible: false,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      });

      // Create and attach session breaks primitive
      const sessionBreaksPrimitive = new SessionBreaksPrimitive(chart);
      series.attachPrimitive(sessionBreaksPrimitive);

      chartRef.current = chart;
      seriesRef.current = series;
      btcSeriesRef.current = btcSeries;
      sessionBreaksPrimitiveRef.current = sessionBreaksPrimitive;

      // Clear any previous error
      setChartError(null);

      // Reset candle refs (raw ticks preserved for rebuild)
      candlesRef.current = [];
      btcDataRef.current = [];
      currentCandleTimeRef.current = null;

      return () => {
        chart.remove();
        chartRef.current = null;
        seriesRef.current = null;
        btcSeriesRef.current = null;
        sessionBreaksPrimitiveRef.current = null;
      };
    } catch (error) {
      console.error("Failed to initialize chart:", error);
      setChartError("Failed to load chart");
      return;
    }
  }, [selectedInterval, chartType]);

  // Rebuild from stored raw ticks after chart reinitializes (timeframe or type change)
  useEffect(() => {
    if (!seriesRef.current || rawTicksRef.current.length === 0) return;
    rebuildFromTicks();
  }, [selectedInterval, chartType, rebuildFromTicks]);

  // Load initial candles when provided (for historical data)
  useEffect(() => {
    if (!initialCandles || initialCandles.length === 0 || !seriesRef.current) return;

    // Sort candles by time ascending to ensure correct order
    const sortedCandles = [...initialCandles]
      .map(c => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));

    // Update refs with the loaded data
    candlesRef.current = sortedCandles as CandlestickData[];
    currentCandleTimeRef.current = sortedCandles.length > 0
      ? sortedCandles[sortedCandles.length - 1].time as number
      : null;

    // Update session break lines
    sessionBreaksPrimitiveRef.current?.updateBreakTimes(sortedCandles as CandlestickData[]);

    // Set data on series
    seriesRef.current.setData(sortedCandles);
    chartRef.current?.timeScale().fitContent();
  }, [initialCandles]);

  // Update both price candles and PnL series together for synchronization
  useEffect(() => {
    if (!timestamp || !seriesRef.current) return;

    const candleTime = getCandleTime(timestamp);
    if (candleTime === null) return; // Invalid timestamp

    // Store raw tick for rebuilding on timeframe change
    if (price !== null && price !== undefined) {
      const epochSeconds = Math.floor(new Date(timestamp).getTime() / 1000);
      const rawTick: RawTick = { time: epochSeconds, price };
      rawTicksRef.current.push(rawTick);
      if (rawTicksRef.current.length > MAX_RAW_TICKS) {
        rawTicksRef.current.shift();
      }
    }

    // Update price series (only if price is provided and valid)
    if (price !== null && price !== undefined) {
      const candles = candlesRef.current;

      if (currentCandleTimeRef.current === candleTime) {
        // Update existing candle bucket
        const lastCandle = candles[candles.length - 1];
        if (lastCandle) {
          lastCandle.high = Math.max(lastCandle.high, price);
          lastCandle.low = Math.min(lastCandle.low, price);
          lastCandle.close = price;

          if (chartType === "line") {
            seriesRef.current.update({ time: lastCandle.time, value: price });
          } else {
            seriesRef.current.update(lastCandle);
          }
        }
      } else {
        // Create new candle bucket
        const newCandle: CandlestickData = {
          time: candleTime as Time,
          open: price,
          high: price,
          low: price,
          close: price,
        };

        candles.push(newCandle);
        currentCandleTimeRef.current = candleTime;

        // Trim to max candles
        if (candles.length > MAX_CANDLES) {
          candles.shift();
        }

        if (chartType === "line") {
          const lineData: LineData[] = candles.map((c) => ({
            time: c.time,
            value: c.close,
          }));
          seriesRef.current.setData(lineData);
        } else {
          seriesRef.current.setData(candles);
        }

        // Auto-scroll to latest
        chartRef.current?.timeScale().scrollToRealTime();
      }
    }

  }, [price, timestamp, getCandleTime, chartType]);

  // Update BTC price series (driven by strategy metrics, independent of Polymarket ticks)
  useEffect(() => {
    if (btcPrice === null || btcPrice === undefined || !btcSeriesRef.current || !btcTimestamp) return;

    // Store raw BTC tick for rebuilding on timeframe change
    rawBtcTicksRef.current.push({ time: btcTimestamp, price: btcPrice });
    if (rawBtcTicksRef.current.length > MAX_RAW_TICKS) {
      rawBtcTicksRef.current.shift();
    }

    const candleTime = Math.floor(btcTimestamp / 1000 / selectedInterval) * selectedInterval;
    const btcData = btcDataRef.current;

    const lastPoint = btcData[btcData.length - 1];
    if (lastPoint && lastPoint.time === candleTime) {
      lastPoint.value = btcPrice;
      btcSeriesRef.current.update(lastPoint);
    } else {
      const newPoint: LineData = {
        time: candleTime as Time,
        value: btcPrice,
      };
      btcData.push(newPoint);

      if (btcData.length > MAX_CANDLES) {
        btcData.shift();
      }

      btcSeriesRef.current.setData(btcData);
    }
  }, [btcPrice, btcTimestamp, selectedInterval]);

  // Update theme when it changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (!chartRef.current) return;
      const isDark = document.documentElement.classList.contains("dark");
      chartRef.current.applyOptions({
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: isDark ? "#888" : "#666",
        },
        grid: {
          vertLines: { color: isDark ? "#222" : "#eee" },
          horzLines: { color: isDark ? "#222" : "#eee" },
        },
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  if (chartError) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
        {chartError}
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex items-center gap-3 mb-2 shrink-0">
        <div className="flex gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.seconds}
              onClick={() => setSelectedInterval(tf.seconds)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                selectedInterval === tf.seconds
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
        <div className="w-px h-4 bg-border" />
        <div className="flex gap-1">
          {(["candles", "line"] as const).map((type) => (
            <button
              key={type}
              onClick={() => setChartType(type)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                chartType === type
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {type === "candles" ? "Candles" : "Line"}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={containerRef}
        className="flex-1 min-h-0"
      />
    </div>
  );
}
