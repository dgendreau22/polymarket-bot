"use client";

import { useState, useEffect, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Settings2, Zap } from "lucide-react";
import type { ParameterRange, OptimizationMetric } from "@/lib/backtest/types";
import type { TimeAbove50Config } from "@/lib/strategies/time-above-50/TimeAbove50Config";
import { DEFAULT_CONFIG } from "@/lib/strategies/time-above-50/TimeAbove50Config";

// Parameter groups for organization
const PARAMETER_GROUPS = {
  signal: {
    label: "Signal Parameters",
    params: ["H_tau", "H_d", "alpha", "beta", "gamma", "d0", "d1"],
  },
  thresholds: {
    label: "Entry/Exit Thresholds",
    params: ["E_enter", "E_exit", "E_taker", "E_override"],
  },
  sizing: {
    label: "Position Sizing",
    params: ["k", "Q_max", "q_step"],
  },
  deadband: {
    label: "Deadband",
    params: ["delta_min", "delta0", "lambda_s", "lambda_c", "A_min"],
  },
  timing: {
    label: "Timing",
    params: ["rebalance_interval", "cooldown", "min_hold"],
  },
  liquidity: {
    label: "Liquidity Gates",
    params: ["spread_max_entry", "spread_halt"],
  },
} as const;

// Parameter metadata for UI
const PARAM_META: Record<
  keyof TimeAbove50Config,
  { label: string; step: number; min: number; max: number }
> = {
  H_tau: { label: "τ Half-life (s)", step: 5, min: 10, max: 120 },
  H_d: { label: "d Half-life (s)", step: 10, min: 15, max: 180 },
  W_chop_sec: { label: "Chop Window (s)", step: 15, min: 30, max: 180 },
  T0: { label: "Theta T₀ (min)", step: 0.5, min: 1, max: 10 },
  theta_b: { label: "Theta Exponent", step: 0.25, min: 0.5, max: 3 },
  alpha: { label: "Alpha (τ weight)", step: 0.1, min: 0.3, max: 2 },
  beta: { label: "Beta (d̄ weight)", step: 0.1, min: 0.1, max: 1.5 },
  gamma: { label: "Gamma (d weight)", step: 0.1, min: 0, max: 1 },
  d0: { label: "d₀ Scale", step: 0.005, min: 0.005, max: 0.05 },
  d1: { label: "d₁ Scale", step: 0.005, min: 0.005, max: 0.03 },
  c0: { label: "Chop c₀", step: 0.5, min: 0.5, max: 5 },
  sigma0: { label: "Chop σ₀", step: 0.02, min: 0.02, max: 0.2 },
  k: { label: "Sensitivity k", step: 0.5, min: 1, max: 5 },
  Q_max: { label: "Max Position", step: 100, min: 100, max: 2000 },
  q_step: { label: "Min Step", step: 5, min: 5, max: 50 },
  delta_min: { label: "Min Deadband", step: 0.001, min: 0.001, max: 0.01 },
  delta0: { label: "Base Deadband", step: 0.001, min: 0.002, max: 0.015 },
  lambda_s: { label: "Spread λ", step: 0.1, min: 0.1, max: 1 },
  lambda_c: { label: "Chop λ", step: 0.001, min: 0.001, max: 0.01 },
  A_min: { label: "Min Persistence", step: 0.05, min: 0.05, max: 0.4 },
  E_enter: { label: "E Enter", step: 0.02, min: 0.08, max: 0.4 },
  E_exit: { label: "E Exit", step: 0.01, min: 0.03, max: 0.2 },
  E_taker: { label: "E Taker", step: 0.05, min: 0.15, max: 0.6 },
  E_override: { label: "E Override", step: 0.05, min: 0.2, max: 0.6 },
  spread_max_entry: { label: "Max Entry Spread", step: 0.005, min: 0.01, max: 0.05 },
  spread_halt: { label: "Halt Spread", step: 0.01, min: 0.02, max: 0.1 },
  T_flat: { label: "Time Flatten (min)", step: 0.25, min: 0.25, max: 3 },
  rebalance_interval: { label: "Rebalance (s)", step: 0.5, min: 0.5, max: 10 },
  cooldown: { label: "Cooldown (s)", step: 0.5, min: 0.5, max: 10 },
  min_hold: { label: "Min Hold (s)", step: 5, min: 5, max: 60 },
  EV_min: { label: "Min EV", step: 0.01, min: -0.1, max: 0.1 },
  m: { label: "Forecast m", step: 0.1, min: 0.5, max: 2 },
};

interface GridSearchFormProps {
  onRangesChange: (ranges: ParameterRange[]) => void;
  onMetricChange: (metric: OptimizationMetric) => void;
  onCapitalChange: (capital: number) => void;
  initialCapital: number;
  optimizeMetric: OptimizationMetric;
}

export function GridSearchForm({
  onRangesChange,
  onMetricChange,
  onCapitalChange,
  initialCapital,
  optimizeMetric,
}: GridSearchFormProps) {
  const [enabledParams, setEnabledParams] = useState<Set<keyof TimeAbove50Config>>(
    new Set()
  );
  const [ranges, setRanges] = useState<Map<keyof TimeAbove50Config, ParameterRange>>(
    new Map()
  );

  // Count combinations
  const combinationCount = useMemo(() => {
    if (enabledParams.size === 0) return 1;
    let count = 1;
    for (const param of enabledParams) {
      const range = ranges.get(param);
      if (range) {
        const steps = Math.floor((range.max - range.min) / range.step) + 1;
        count *= Math.max(1, steps);
      }
    }
    return count;
  }, [enabledParams, ranges]);

  // Update parent when ranges change
  useEffect(() => {
    const activeRanges: ParameterRange[] = [];
    for (const param of enabledParams) {
      const range = ranges.get(param);
      if (range) {
        activeRanges.push(range);
      }
    }
    onRangesChange(activeRanges);
  }, [enabledParams, ranges, onRangesChange]);

  const toggleParam = (param: keyof TimeAbove50Config) => {
    const newEnabled = new Set(enabledParams);
    if (newEnabled.has(param)) {
      newEnabled.delete(param);
    } else {
      newEnabled.add(param);
      // Initialize range if not exists
      if (!ranges.has(param)) {
        const meta = PARAM_META[param];
        const defaultVal = DEFAULT_CONFIG[param];
        setRanges(
          new Map(ranges).set(param, {
            param,
            min: Math.max(meta.min, defaultVal - meta.step * 2),
            max: Math.min(meta.max, defaultVal + meta.step * 2),
            step: meta.step,
          })
        );
      }
    }
    setEnabledParams(newEnabled);
  };

  const updateRange = (
    param: keyof TimeAbove50Config,
    field: "min" | "max" | "step",
    value: number
  ) => {
    const newRanges = new Map(ranges);
    const existing = newRanges.get(param) || {
      param,
      min: PARAM_META[param].min,
      max: PARAM_META[param].max,
      step: PARAM_META[param].step,
    };
    newRanges.set(param, { ...existing, [field]: value });
    setRanges(newRanges);
  };

  const applyPreset = (preset: string) => {
    const presetParams: Record<string, (keyof TimeAbove50Config)[]> = {
      quick: ["H_tau", "E_enter", "k"],
      signal: ["H_tau", "H_d", "alpha", "beta"],
      thresholds: ["E_enter", "E_exit", "E_taker"],
      sizing: ["k", "Q_max", "q_step"],
      timing: ["rebalance_interval", "cooldown", "min_hold"],
    };

    const params = presetParams[preset];
    if (!params) return;

    const newEnabled = new Set<keyof TimeAbove50Config>();
    const newRanges = new Map(ranges);

    for (const param of params) {
      newEnabled.add(param);
      if (!newRanges.has(param)) {
        const meta = PARAM_META[param];
        const defaultVal = DEFAULT_CONFIG[param];
        newRanges.set(param, {
          param,
          min: Math.max(meta.min, defaultVal - meta.step * 2),
          max: Math.min(meta.max, defaultVal + meta.step * 2),
          step: meta.step,
        });
      }
    }

    setEnabledParams(newEnabled);
    setRanges(newRanges);
  };

  return (
    <div className="bg-card border rounded-lg">
      <div className="p-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-purple-500" />
          <div>
            <h3 className="font-semibold">Grid Search Parameters</h3>
            <p className="text-xs text-muted-foreground">
              Select parameters to optimize
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div
            className={`text-sm font-mono px-2 py-1 rounded ${
              combinationCount > 10000
                ? "bg-destructive/20 text-destructive"
                : combinationCount > 1000
                ? "bg-yellow-500/20 text-yellow-500"
                : "bg-green-500/20 text-green-500"
            }`}
          >
            {combinationCount.toLocaleString()} combinations
          </div>
        </div>
      </div>

      {/* Presets */}
      <div className="p-4 border-b bg-muted/30">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground mr-2">Presets:</span>
          <Button variant="outline" size="sm" onClick={() => applyPreset("quick")}>
            <Zap className="w-3 h-3 mr-1" />
            Quick
          </Button>
          <Button variant="outline" size="sm" onClick={() => applyPreset("signal")}>
            Signal
          </Button>
          <Button variant="outline" size="sm" onClick={() => applyPreset("thresholds")}>
            Thresholds
          </Button>
          <Button variant="outline" size="sm" onClick={() => applyPreset("sizing")}>
            Sizing
          </Button>
          <Button variant="outline" size="sm" onClick={() => applyPreset("timing")}>
            Timing
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEnabledParams(new Set());
            }}
          >
            Clear
          </Button>
        </div>
      </div>

      {/* Settings Row */}
      <div className="p-4 border-b flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Label htmlFor="capital" className="text-sm whitespace-nowrap">
            Initial Capital:
          </Label>
          <Input
            id="capital"
            type="number"
            value={initialCapital}
            onChange={(e) => onCapitalChange(parseFloat(e.target.value) || 1000)}
            className="w-24"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="metric" className="text-sm whitespace-nowrap">
            Optimize for:
          </Label>
          <Select value={optimizeMetric} onValueChange={(v) => onMetricChange(v as OptimizationMetric)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sharpeRatio">Sharpe Ratio</SelectItem>
              <SelectItem value="totalPnl">Total PnL</SelectItem>
              <SelectItem value="totalReturn">Return %</SelectItem>
              <SelectItem value="winRate">Win Rate</SelectItem>
              <SelectItem value="maxDrawdown">Min Drawdown</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Warning */}
      {combinationCount > 10000 && (
        <div className="p-4 border-b bg-destructive/10 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-destructive" />
          <span className="text-sm text-destructive">
            Too many combinations! Maximum is 10,000. Increase step sizes or reduce
            ranges.
          </span>
        </div>
      )}

      {/* Parameter Groups */}
      <div className="p-4 space-y-6">
        {Object.entries(PARAMETER_GROUPS).map(([key, group]) => (
          <div key={key}>
            <h4 className="text-sm font-medium text-muted-foreground mb-3">
              {group.label}
            </h4>
            <div className="space-y-2">
              {group.params.map((param) => {
                const meta = PARAM_META[param as keyof TimeAbove50Config];
                const isEnabled = enabledParams.has(param as keyof TimeAbove50Config);
                const range = ranges.get(param as keyof TimeAbove50Config);

                return (
                  <div
                    key={param}
                    className={`flex items-center gap-4 p-2 rounded ${
                      isEnabled ? "bg-muted/50" : ""
                    }`}
                  >
                    <Checkbox
                      checked={isEnabled}
                      onCheckedChange={() =>
                        toggleParam(param as keyof TimeAbove50Config)
                      }
                    />
                    <span className="text-sm w-32">{meta.label}</span>
                    {isEnabled && range && (
                      <div className="flex items-center gap-2 flex-1">
                        <Input
                          type="number"
                          value={range.min}
                          onChange={(e) =>
                            updateRange(
                              param as keyof TimeAbove50Config,
                              "min",
                              parseFloat(e.target.value)
                            )
                          }
                          className="w-20 h-8 text-sm"
                          step={meta.step}
                          placeholder="Min"
                        />
                        <span className="text-muted-foreground">-</span>
                        <Input
                          type="number"
                          value={range.max}
                          onChange={(e) =>
                            updateRange(
                              param as keyof TimeAbove50Config,
                              "max",
                              parseFloat(e.target.value)
                            )
                          }
                          className="w-20 h-8 text-sm"
                          step={meta.step}
                          placeholder="Max"
                        />
                        <span className="text-muted-foreground text-xs">step:</span>
                        <Input
                          type="number"
                          value={range.step}
                          onChange={(e) =>
                            updateRange(
                              param as keyof TimeAbove50Config,
                              "step",
                              parseFloat(e.target.value)
                            )
                          }
                          className="w-16 h-8 text-sm"
                          step={meta.step / 2}
                          placeholder="Step"
                        />
                      </div>
                    )}
                    {!isEnabled && (
                      <span className="text-xs text-muted-foreground">
                        Default: {DEFAULT_CONFIG[param as keyof TimeAbove50Config]}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
