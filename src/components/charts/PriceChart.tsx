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
  pnl?: number | null;
  intervalSeconds?: number;
  initialCandles?: CandleData[];
}

const MAX_CANDLES = 100; // Rolling window size

export function PriceChart({
  price,
  timestamp,
  pnl,
  intervalSeconds = 15,
  initialCandles,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // Note: lightweight-charts v5 uses complex generic types that don't work well with refs.
  // Using ReturnType to infer the correct series type from addSeries.
  const seriesRef = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);
  const pnlSeriesRef = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);
  const sessionBreaksPrimitiveRef = useRef<SessionBreaksPrimitive | null>(null);
  const candlesRef = useRef<CandlestickData[]>([]);
  const pnlDataRef = useRef<LineData[]>([]);
  const currentCandleTimeRef = useRef<number | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);

  // Get candle time bucket from timestamp
  const getCandleTime = useCallback(
    (ts: string): number | null => {
      const date = new Date(ts);
      const epochMs = date.getTime();
      if (isNaN(epochMs)) return null; // Invalid timestamp
      const epochSeconds = Math.floor(epochMs / 1000);
      return Math.floor(epochSeconds / intervalSeconds) * intervalSeconds;
    },
    [intervalSeconds]
  );

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
          visible: true,
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

      const series = chart.addSeries(CandlestickSeries, {
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

      // Add PnL line series on left scale
      const pnlSeries = chart.addSeries(LineSeries, {
        color: "#3b82f6", // blue
        lineWidth: 2,
        priceScaleId: "left",
        lastValueVisible: true,
        priceLineVisible: false,
      });

      // Create and attach session breaks primitive
      const sessionBreaksPrimitive = new SessionBreaksPrimitive(chart);
      series.attachPrimitive(sessionBreaksPrimitive);

      chartRef.current = chart;
      seriesRef.current = series;
      pnlSeriesRef.current = pnlSeries;
      sessionBreaksPrimitiveRef.current = sessionBreaksPrimitive;

      // Clear any previous error
      setChartError(null);

      // Reset data refs when chart reinitializes
      candlesRef.current = [];
      pnlDataRef.current = [];
      currentCandleTimeRef.current = null;

      return () => {
        chart.remove();
        chartRef.current = null;
        seriesRef.current = null;
        pnlSeriesRef.current = null;
        sessionBreaksPrimitiveRef.current = null;
      };
    } catch (error) {
      console.error("Failed to initialize chart:", error);
      setChartError("Failed to load chart");
      return;
    }
  }, [intervalSeconds]);

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

    // Update price candles (only if price is provided and valid)
    if (price !== null && price !== undefined) {
      const candles = candlesRef.current;

      if (currentCandleTimeRef.current === candleTime) {
        // Update existing candle
        const lastCandle = candles[candles.length - 1];
        if (lastCandle) {
          lastCandle.high = Math.max(lastCandle.high, price);
          lastCandle.low = Math.min(lastCandle.low, price);
          lastCandle.close = price;
          seriesRef.current.update(lastCandle);
        }
      } else {
        // Create new candle
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

        seriesRef.current.setData(candles);

        // Auto-scroll to latest
        chartRef.current?.timeScale().scrollToRealTime();
      }
    }

    // Update PnL series (only if pnl is provided and valid)
    if (pnl !== null && pnl !== undefined && pnlSeriesRef.current) {
      const pnlData = pnlDataRef.current;

      // Check if we already have a point at this time
      const lastPoint = pnlData[pnlData.length - 1];
      if (lastPoint && lastPoint.time === candleTime) {
        // Update existing point
        lastPoint.value = pnl;
        pnlSeriesRef.current.update(lastPoint);
      } else {
        // Add new point
        const newPoint: LineData = {
          time: candleTime as Time,
          value: pnl,
        };

        pnlData.push(newPoint);

        // Trim to max points
        if (pnlData.length > MAX_CANDLES) {
          pnlData.shift();
        }

        pnlSeriesRef.current.setData(pnlData);
      }
    }
  }, [price, pnl, timestamp, getCandleTime]);

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
    <div
      ref={containerRef}
      className="w-full h-full"
    />
  );
}
