"use client";

import { useState, useMemo } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Layers,
  Info,
  ChevronDown,
  ChevronRight,
  RotateCcw,
} from "lucide-react";

// Phase configuration data matching the plan
const PHASE_CONFIGS = [
  {
    phase: 1,
    name: "Signal Half-lives",
    description: "Control signal smoothing - foundational to all other signals",
    params: ["H_tau", "H_d"],
    combinations: 49,
    metric: "Sharpe Ratio",
  },
  {
    phase: 2,
    name: "Entry/Exit Thresholds",
    description: "Gate ALL trading - must maintain E_exit < E_enter by at least 0.04",
    params: ["E_enter", "E_exit"],
    combinations: 20,
    metric: "Sharpe Ratio",
  },
  {
    phase: 3,
    name: "Edge Weights",
    description: "Weights that ADD linearly in E calculation",
    params: ["alpha", "beta", "gamma"],
    combinations: 100,
    metric: "Sharpe Ratio",
  },
  {
    phase: 4,
    name: "Theta/Time Scaler",
    description: "Theta MULTIPLIES edge score - controls behavior near resolution",
    params: ["T0", "theta_b"],
    combinations: 36,
    metric: "Sharpe Ratio",
  },
  {
    phase: 5,
    name: "Saturation Scales",
    description: "Control tanh saturation rate - smaller = faster saturation",
    params: ["d0", "d1"],
    combinations: 30,
    metric: "Sharpe Ratio",
  },
  {
    phase: 6,
    name: "Position Sizing",
    description: "Final position = Q_max * gamma(p) * tanh(k * E) - multiplicative",
    params: ["k", "Q_max"],
    combinations: 48,
    metric: "Total PnL",
  },
  {
    phase: 7,
    name: "Taker Threshold",
    description: "When to cross spread for immediate fills",
    params: ["E_taker"],
    combinations: 7,
    metric: "Sharpe Ratio",
  },
  {
    phase: 8,
    name: "Decision Frequency",
    description: "Controls how often strategy can act",
    params: ["rebalance_interval"],
    combinations: 9,
    metric: "Sharpe Ratio",
  },
  {
    phase: 9,
    name: "Cross-Validation",
    description: "Verify top parameters from each phase work well together",
    params: ["Top 3 from each phase"],
    combinations: 200,
    metric: "Composite (0.6S + 0.3W + 0.1PF)",
  },
];

interface PhasedOptimizationFormProps {
  onPhasesChange: (phases: number[]) => void;
  onCapitalChange: (capital: number) => void;
  initialCapital: number;
}

export function PhasedOptimizationForm({
  onPhasesChange,
  onCapitalChange,
  initialCapital,
}: PhasedOptimizationFormProps) {
  const [selectedPhases, setSelectedPhases] = useState<Set<number>>(
    new Set([1, 2, 3, 4, 5, 6, 7, 8, 9])
  );
  const [expandedPhases, setExpandedPhases] = useState<Set<number>>(new Set());

  // Calculate total combinations
  const totalCombinations = useMemo(() => {
    let total = 0;
    for (const phase of PHASE_CONFIGS) {
      if (selectedPhases.has(phase.phase)) {
        total += phase.combinations;
      }
    }
    return total;
  }, [selectedPhases]);

  const togglePhase = (phase: number) => {
    const newSelected = new Set(selectedPhases);
    if (newSelected.has(phase)) {
      newSelected.delete(phase);
    } else {
      newSelected.add(phase);
    }
    setSelectedPhases(newSelected);
    onPhasesChange(Array.from(newSelected).sort((a, b) => a - b));
  };

  const toggleExpand = (phase: number) => {
    const newExpanded = new Set(expandedPhases);
    if (newExpanded.has(phase)) {
      newExpanded.delete(phase);
    } else {
      newExpanded.add(phase);
    }
    setExpandedPhases(newExpanded);
  };

  const selectAll = () => {
    const allPhases = new Set(PHASE_CONFIGS.map((p) => p.phase));
    setSelectedPhases(allPhases);
    onPhasesChange(Array.from(allPhases).sort((a, b) => a - b));
  };

  const selectNone = () => {
    setSelectedPhases(new Set());
    onPhasesChange([]);
  };

  const selectQuick = () => {
    // Quick optimization: Phases 1, 2, 6 only (foundational + sizing)
    const quickPhases = new Set([1, 2, 6]);
    setSelectedPhases(quickPhases);
    onPhasesChange([1, 2, 6]);
  };

  return (
    <div className="bg-card border rounded-lg">
      <div className="p-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-purple-500" />
          <div>
            <h3 className="font-semibold">Phased Optimization</h3>
            <p className="text-xs text-muted-foreground">
              9-phase divide-and-conquer approach
            </p>
          </div>
        </div>
        <div
          className={`text-sm font-mono px-2 py-1 rounded ${
            totalCombinations > 500
              ? "bg-yellow-500/20 text-yellow-500"
              : "bg-green-500/20 text-green-500"
          }`}
        >
          ~{totalCombinations.toLocaleString()} combinations
        </div>
      </div>

      {/* Quick Actions */}
      <div className="p-4 border-b bg-muted/30">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground mr-2">Presets:</span>
          <Button variant="outline" size="sm" onClick={selectAll}>
            All Phases
          </Button>
          <Button variant="outline" size="sm" onClick={selectQuick}>
            Quick (1,2,6)
          </Button>
          <Button variant="ghost" size="sm" onClick={selectNone}>
            <RotateCcw className="w-3 h-3 mr-1" />
            Clear
          </Button>
        </div>
      </div>

      {/* Settings Row */}
      <div className="p-4 border-b flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Label htmlFor="capital-phased" className="text-sm whitespace-nowrap">
            Initial Capital:
          </Label>
          <Input
            id="capital-phased"
            type="number"
            value={initialCapital}
            onChange={(e) => onCapitalChange(parseFloat(e.target.value) || 1000)}
            className="w-24"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Info className="w-4 h-4" />
          <span>
            {selectedPhases.size} of 9 phases selected
          </span>
        </div>
      </div>

      {/* Phase List */}
      <div className="divide-y">
        {PHASE_CONFIGS.map((phase) => {
          const isSelected = selectedPhases.has(phase.phase);
          const isExpanded = expandedPhases.has(phase.phase);

          return (
            <div
              key={phase.phase}
              className={`${isSelected ? "bg-muted/30" : ""}`}
            >
              <div className="p-4 flex items-center gap-4">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => togglePhase(phase.phase)}
                />
                <button
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  onClick={() => toggleExpand(phase.phase)}
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </button>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm bg-muted px-1.5 py-0.5 rounded">
                      Phase {phase.phase}
                    </span>
                    <span className="font-medium">{phase.name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {phase.description}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono">
                    {phase.combinations} runs
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {phase.metric}
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div className="px-4 pb-4 pl-16">
                  <div className="bg-muted/50 rounded-lg p-3 text-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-muted-foreground">Parameters:</span>
                      <span className="font-mono">
                        {phase.params.join(", ")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        Optimization Metric:
                      </span>
                      <span>{phase.metric}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Info Box */}
      <div className="p-4 bg-blue-500/10 border-t">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-700 dark:text-blue-300">
            <p className="font-medium mb-1">How Phased Optimization Works</p>
            <p className="text-xs opacity-80">
              Each phase optimizes a subset of parameters while keeping others at their
              best known values. Winners from each phase cascade forward, dramatically
              reducing the search space from millions of combinations to ~500.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
