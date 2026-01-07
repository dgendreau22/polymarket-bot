"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  LineData,
  Time,
  ColorType,
  CandlestickSeries,
  LineSeries,
} from "lightweight-charts";

interface PriceChartProps {
  price: number | null;
  timestamp: string | null;
  pnl?: number | null;
  intervalSeconds?: number;
  height?: number;
}

const MAX_CANDLES = 100; // Rolling window size

export function PriceChart({
  price,
  timestamp,
  pnl,
  intervalSeconds = 15,
  height = 180,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // Note: lightweight-charts v5 uses complex generic types that don't work well with refs.
  // Using ReturnType to infer the correct series type from addSeries.
  const seriesRef = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);
  const pnlSeriesRef = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);
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
        height,
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
        },
        crosshair: {
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
      });

      // Add PnL line series on left scale
      const pnlSeries = chart.addSeries(LineSeries, {
        color: "#3b82f6", // blue
        lineWidth: 2,
        priceScaleId: "left",
        lastValueVisible: true,
        priceLineVisible: false,
      });

      chartRef.current = chart;
      seriesRef.current = series;
      pnlSeriesRef.current = pnlSeries;

      // Clear any previous error
      setChartError(null);

      // Reset data refs when chart reinitializes
      candlesRef.current = [];
      pnlDataRef.current = [];
      currentCandleTimeRef.current = null;

      // Handle resize
      const handleResize = () => {
        if (containerRef.current && chartRef.current) {
          chartRef.current.applyOptions({
            width: containerRef.current.clientWidth,
          });
        }
      };

      window.addEventListener("resize", handleResize);
      handleResize();

      return () => {
        window.removeEventListener("resize", handleResize);
        chart.remove();
        chartRef.current = null;
        seriesRef.current = null;
        pnlSeriesRef.current = null;
      };
    } catch (error) {
      console.error("Failed to initialize chart:", error);
      setChartError("Failed to load chart");
      return;
    }
  }, [height, intervalSeconds]);

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
      <div
        className="w-full flex items-center justify-center text-muted-foreground text-sm"
        style={{ height }}
      >
        {chartError}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full"
      style={{ height }}
    />
  );
}
