"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart,
  IChartApi,
  Time,
  ColorType,
  LineSeries,
} from "lightweight-charts";
import { Checkbox } from "@/components/ui/checkbox";
import type { StrategyMetric } from "@/lib/persistence/StrategyMetricsRepository";

// Parameter configuration
// axis: 'left' = position quantities, 'right' = price/edge raw values, 'overlay' = normalized signals
const PARAMETERS = [
  { key: "tau", label: "A (Time-Above)", color: "#3b82f6", defaultEnabled: true, axis: "right" as const },
  { key: "edge", label: "E (Edge)", color: "#10b981", defaultEnabled: true, axis: "right" as const },
  { key: "qStar", label: "q* (Target)", color: "#f59e0b", defaultEnabled: true, axis: "left" as const },
  { key: "theta", label: "θ (Theta)", color: "#8b5cf6", defaultEnabled: false, axis: "right" as const },
  { key: "delta", label: "d̄ (Dbar)", color: "#ec4899", defaultEnabled: false, axis: "right" as const },
  { key: "price", label: "Price", color: "#06b6d4", defaultEnabled: true, axis: "right" as const },
  { key: "positionYes", label: "Pos YES", color: "#22c55e", defaultEnabled: false, axis: "left" as const },
  { key: "positionNo", label: "Pos NO", color: "#ef4444", defaultEnabled: false, axis: "left" as const },
  { key: "totalPnl", label: "PnL", color: "#f97316", defaultEnabled: true, axis: "left" as const },
] as const;

type ParamKey = (typeof PARAMETERS)[number]["key"];

// Parameters grouped by axis type
const LEFT_AXIS_KEYS: Set<ParamKey> = new Set(PARAMETERS.filter(p => p.axis === "left").map(p => p.key));
const RIGHT_AXIS_KEYS: Set<ParamKey> = new Set(PARAMETERS.filter(p => p.axis === "right").map(p => p.key));

interface StrategyChartProps {
  metrics?: StrategyMetric[];
}

export function StrategyChart({ metrics = [] }: StrategyChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Map<ParamKey, ReturnType<IChartApi["addSeries"]>>>(
    new Map()
  );
  const metricsRef = useRef<StrategyMetric[]>(metrics);
  const prevMetricsLengthRef = useRef<number>(metrics.length);
  const [chartError, setChartError] = useState<string | null>(null);

  // Track enabled parameters
  const [enabledParams, setEnabledParams] = useState<Set<ParamKey>>(
    new Set(PARAMETERS.filter((p) => p.defaultEnabled).map((p) => p.key))
  );

  // Process metrics - all axes use raw values
  const processMetrics = useCallback(
    (
      metrics: StrategyMetric[]
    ): Map<ParamKey, { time: number; value: number }[]> => {
      const result = new Map<ParamKey, { time: number; value: number }[]>();

      if (metrics.length === 0) {
        return result;
      }

      // Process each parameter with raw values
      PARAMETERS.forEach(({ key }) => {
        const dataPoints: { time: number; value: number }[] = [];

        metrics.forEach((metric) => {
          const value = metric[key] as number | null;
          if (value !== null && !isNaN(value)) {
            dataPoints.push({
              time: Math.floor(metric.timestamp / 1000),
              value: value,
            });
          }
        });

        result.set(key, dataPoints);
      });

      return result;
    },
    []
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
          scaleMargins: {
            top: 0.1,
            bottom: 0.1,
          },
        },
        leftPriceScale: {
          borderVisible: false,
          visible: true,
          scaleMargins: {
            top: 0.1,
            bottom: 0.1,
          },
        },
        timeScale: {
          borderVisible: false,
          timeVisible: true,
          secondsVisible: true,
          tickMarkFormatter: (time: number) => {
            const date = new Date(time * 1000);
            return date.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            });
          },
        },
        localization: {
          timeFormatter: (time: number) => {
            const date = new Date(time * 1000);
            return date.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
          },
        },
      });

      // Create series for each parameter
      PARAMETERS.forEach((param) => {
        const isLeftAxis = LEFT_AXIS_KEYS.has(param.key);
        const isRightAxis = RIGHT_AXIS_KEYS.has(param.key);

        // Determine price scale: left for positions, right for price/edge, overlay for normalized
        let priceScaleId: string;
        let formatter: (value: number) => string;

        if (isLeftAxis) {
          priceScaleId = "left";
          // Format PnL with $ prefix, others as integers
          formatter = param.key === "totalPnl"
            ? (value: number) => "$" + value.toFixed(2)
            : (value: number) => value.toFixed(0);
        } else if (isRightAxis) {
          priceScaleId = "right";
          formatter = (value: number) => value.toFixed(3); // Price/edge with 3 decimals
        } else {
          priceScaleId = "overlay";
          formatter = (value: number) => value.toFixed(2);
        }

        const series = chart.addSeries(LineSeries, {
          color: param.color,
          lineWidth: 2,
          visible: enabledParams.has(param.key),
          priceScaleId,
          priceFormat: {
            type: "custom",
            formatter,
          },
          lastValueVisible: false,
          priceLineVisible: false,
        });
        seriesRef.current.set(param.key, series);
      });

      chartRef.current = chart;
      setChartError(null);

      // Load initial data
      if (metrics.length > 0) {
        metricsRef.current = metrics;
        prevMetricsLengthRef.current = metrics.length;
        const normalized = processMetrics(metrics);
        PARAMETERS.forEach((param) => {
          const series = seriesRef.current.get(param.key);
          const data = normalized.get(param.key);
          if (series && data && data.length > 0) {
            series.setData(
              data.map((d) => ({ time: d.time as Time, value: d.value }))
            );
          }
        });
        chart.timeScale().fitContent();
      }

      // Copy refs for cleanup
      const currentSeriesRef = seriesRef.current;

      return () => {
        chart.remove();
        chartRef.current = null;
        currentSeriesRef.clear();
      };
    } catch (error) {
      console.error("Failed to initialize strategy chart:", error);
      setChartError("Failed to load chart");
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update metrics data
  const updateMetrics = useCallback(
    (newMetrics: StrategyMetric[]) => {
      metricsRef.current = [...metricsRef.current, ...newMetrics];

      if (!chartRef.current) return;

      // Re-normalize all data (needed because min/max may change)
      const normalized = processMetrics(metricsRef.current);

      PARAMETERS.forEach((param) => {
        const series = seriesRef.current.get(param.key);
        const data = normalized.get(param.key);
        if (series && data && data.length > 0) {
          series.setData(
            data.map((d) => ({ time: d.time as Time, value: d.value }))
          );
        }
      });

      // Auto-scroll to latest
      chartRef.current?.timeScale().scrollToRealTime();
    },
    [processMetrics]
  );

  // Expose update method via ref or callback
  useEffect(() => {
    // Store the update function for external use
    (window as unknown as { updateStrategyChart?: (metrics: StrategyMetric[]) => void }).updateStrategyChart = updateMetrics;
    return () => {
      delete (window as unknown as { updateStrategyChart?: (metrics: StrategyMetric[]) => void }).updateStrategyChart;
    };
  }, [updateMetrics]);

  // Respond to metrics prop changes
  useEffect(() => {
    if (!chartRef.current) return;

    // Check if new metrics have been added
    if (metrics.length > prevMetricsLengthRef.current) {
      // Get only the new metrics
      const newMetrics = metrics.slice(prevMetricsLengthRef.current);
      prevMetricsLengthRef.current = metrics.length;
      updateMetrics(newMetrics);
    } else if (metrics.length > 0 && metrics.length !== metricsRef.current.length) {
      // Full replacement (e.g., after page reload with different data)
      metricsRef.current = metrics;
      prevMetricsLengthRef.current = metrics.length;
      const normalized = processMetrics(metrics);
      PARAMETERS.forEach((param) => {
        const series = seriesRef.current.get(param.key);
        const data = normalized.get(param.key);
        if (series && data && data.length > 0) {
          series.setData(
            data.map((d) => ({ time: d.time as Time, value: d.value }))
          );
        }
      });
      chartRef.current?.timeScale().fitContent();
    }
  }, [metrics, updateMetrics, processMetrics]);

  // Handle parameter toggle
  const toggleParam = useCallback((key: ParamKey) => {
    const series = seriesRef.current.get(key);
    if (series) {
      setEnabledParams((prev) => {
        const newEnabled = new Set(prev);
        if (newEnabled.has(key)) {
          newEnabled.delete(key);
          series.applyOptions({ visible: false });
        } else {
          newEnabled.add(key);
          series.applyOptions({ visible: true });
        }
        return newEnabled;
      });
    }
  }, []);

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
    <div className="space-y-3">
      {/* Toggle controls */}
      <div className="flex flex-wrap gap-3">
        {PARAMETERS.map((param) => (
          <label
            key={param.key}
            className="flex items-center gap-2 cursor-pointer text-sm"
          >
            <Checkbox
              checked={enabledParams.has(param.key)}
              onCheckedChange={() => toggleParam(param.key)}
            />
            <span
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: param.color }}
            />
            <span className="text-muted-foreground">{param.label}</span>
          </label>
        ))}
      </div>

      {/* Chart container */}
      <div ref={containerRef} className="w-full h-[300px]" />
    </div>
  );
}
