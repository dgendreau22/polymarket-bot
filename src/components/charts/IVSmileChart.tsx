"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  IChartApi,
  Time,
  ColorType,
  LineSeries,
  LineStyle,
} from "lightweight-charts";

interface IVDataPoint {
  strike: number;
  deribitIV: number | null;  // IV from Deribit (interpolated)
  polymarketIV: number | null;  // IV implied from Polymarket prices
}

interface IVSmileChartProps {
  data: IVDataPoint[];
  height?: number;
}

/**
 * IV Smile Chart - Compares Deribit IV vs Polymarket implied IV across strikes
 * X-axis: Strike prices
 * Y-axis: IV percentage
 */
export function IVSmileChart({ data, height = 300 }: IVSmileChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const deribitSeriesRef = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);
  const polymarketSeriesRef = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);

  // Sort data by strike and create strike-to-index mapping
  const sortedData = [...data].sort((a, b) => a.strike - b.strike);
  const strikeMap = new Map<number, number>();
  sortedData.forEach((d, i) => {
    strikeMap.set(i, d.strike);
  });

  useEffect(() => {
    if (!containerRef.current || sortedData.length === 0) return;

    try {
      const isDark = document.documentElement.classList.contains("dark");

      const chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
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
          scaleMargins: { top: 0.1, bottom: 0.1 },
        },
        leftPriceScale: {
          visible: false,
        },
        timeScale: {
          borderVisible: false,
          fixLeftEdge: true,
          fixRightEdge: true,
          // Format x-axis labels as strike prices
          tickMarkFormatter: (index: number) => {
            const strike = strikeMap.get(index);
            if (strike === undefined) return "";
            return `$${(strike / 1000).toFixed(0)}k`;
          },
        },
        localization: {
          // Format crosshair tooltip
          timeFormatter: (index: number) => {
            const strike = strikeMap.get(index);
            if (strike === undefined) return "";
            return `Strike: $${strike.toLocaleString()}`;
          },
        },
        crosshair: {
          horzLine: { visible: true, labelVisible: true },
          vertLine: { visible: true, labelVisible: true },
        },
      });

      // Deribit IV series (solid line)
      const deribitSeries = chart.addSeries(LineSeries, {
        color: "#3b82f6", // Blue
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        priceFormat: {
          type: "custom",
          formatter: (value: number) => `${(value * 100).toFixed(1)}%`,
        },
        lastValueVisible: true,
        priceLineVisible: false,
        title: "Deribit",
      });

      // Polymarket implied IV series (dashed line)
      const polymarketSeries = chart.addSeries(LineSeries, {
        color: "#22c55e", // Green
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        priceFormat: {
          type: "custom",
          formatter: (value: number) => `${(value * 100).toFixed(1)}%`,
        },
        lastValueVisible: true,
        priceLineVisible: false,
        title: "Polymarket",
      });

      // Prepare data for series (use index as x-axis "time")
      const deribitData = sortedData
        .map((d, i) => ({
          time: i as Time,
          value: d.deribitIV,
        }))
        .filter((d) => d.value !== null) as { time: Time; value: number }[];

      const polymarketData = sortedData
        .map((d, i) => ({
          time: i as Time,
          value: d.polymarketIV,
        }))
        .filter((d) => d.value !== null) as { time: Time; value: number }[];

      deribitSeries.setData(deribitData);
      polymarketSeries.setData(polymarketData);

      chart.timeScale().fitContent();

      chartRef.current = chart;
      deribitSeriesRef.current = deribitSeries;
      polymarketSeriesRef.current = polymarketSeries;
      setChartError(null);

      // Handle resize
      const handleResize = () => {
        if (containerRef.current && chartRef.current) {
          chartRef.current.applyOptions({
            width: containerRef.current.clientWidth,
          });
        }
      };
      window.addEventListener("resize", handleResize);

      return () => {
        window.removeEventListener("resize", handleResize);
        chart.remove();
        chartRef.current = null;
        deribitSeriesRef.current = null;
        polymarketSeriesRef.current = null;
      };
    } catch (error) {
      console.error("Failed to initialize IV smile chart:", error);
      setChartError("Failed to load chart");
    }
  }, [sortedData, height, strikeMap]);

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

  if (data.length === 0) {
    return (
      <div
        className="w-full flex items-center justify-center text-muted-foreground text-sm"
        style={{ height }}
      >
        No data available
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-blue-500" />
          <span className="text-muted-foreground">Deribit IV</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-green-500 border-dashed" style={{ borderTopWidth: 2, borderTopStyle: "dashed", height: 0 }} />
          <span className="text-muted-foreground">Polymarket Implied IV</span>
        </div>
      </div>

      {/* Chart container */}
      <div ref={containerRef} style={{ height }} />
    </div>
  );
}
