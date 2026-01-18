"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DollarSign,
  BarChart3,
  Percent,
  TrendingDown,
  Award,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Save,
  Rocket,
} from "lucide-react";
import type { PhaseSummary, PhaseResult } from "@/lib/backtest/types";
import { SavePresetModal } from "./SavePresetModal";
import { DeployToDryRunModal } from "./DeployToDryRunModal";

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  subValue?: string;
  positive?: boolean;
}

function MetricCard({ icon, label, value, subValue, positive }: MetricCardProps) {
  return (
    <div className="bg-card border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <p
        className={`text-2xl font-bold ${
          positive === true
            ? "text-green-500"
            : positive === false
            ? "text-red-500"
            : ""
        }`}
      >
        {value}
      </p>
      {subValue && <p className="text-xs text-muted-foreground mt-1">{subValue}</p>}
    </div>
  );
}

interface PhasedResultsDisplayProps {
  finalParams: Record<string, number>;
  finalMetrics: {
    totalPnl: number;
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    tradeCount: number;
    profitFactor: number;
  };
  phaseSummaries: PhaseSummary[];
  totalCombinationsTested: number;
  totalDurationSeconds: number;
  strategySlug?: string;
  optimizationRunId?: string;
}

export function PhasedResultsDisplay({
  finalParams,
  finalMetrics,
  phaseSummaries,
  totalCombinationsTested,
  totalDurationSeconds,
  strategySlug,
  optimizationRunId,
}: PhasedResultsDisplayProps) {
  const [copied, setCopied] = useState(false);
  const [expandedPhases, setExpandedPhases] = useState<Set<number>>(new Set());
  const [showSavePresetModal, setShowSavePresetModal] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);

  const togglePhase = (phase: number) => {
    const newExpanded = new Set(expandedPhases);
    if (newExpanded.has(phase)) {
      newExpanded.delete(phase);
    } else {
      newExpanded.add(phase);
    }
    setExpandedPhases(newExpanded);
  };

  const copyParams = () => {
    const text = JSON.stringify(finalParams, null, 2);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportResults = () => {
    const data = {
      finalParams,
      finalMetrics,
      phaseSummaries: phaseSummaries.map((ps) => ({
        phase: ps.phase,
        name: ps.name,
        combinationsTested: ps.combinationsTested,
        durationSeconds: ps.durationSeconds,
        bestParams: ps.bestParams,
        skipped: ps.skipped,
        skipReason: ps.skipReason,
        topResults: ps.topResults?.slice(0, 3) ?? [],
      })),
      totalCombinationsTested,
      totalDurationSeconds,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `phased-optimization-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  };

  return (
    <div className="space-y-4">
      {/* Summary Header */}
      <div className="bg-card border rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-yellow-500" />
            <h3 className="font-semibold">Optimization Results</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {totalCombinationsTested} combinations in {formatDuration(totalDurationSeconds)}
            </span>
            {strategySlug && (
              <>
                <Button variant="outline" size="sm" onClick={() => setShowSavePresetModal(true)}>
                  <Save className="w-3 h-3 mr-1" />
                  Save Preset
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowDeployModal(true)}>
                  <Rocket className="w-3 h-3 mr-1" />
                  Deploy
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={exportResults}>
              <Download className="w-3 h-3 mr-1" />
              Export
            </Button>
          </div>
        </div>

        {/* Metric Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            icon={<DollarSign className="w-4 h-4 text-green-500" />}
            label="Total PnL"
            value={`$${finalMetrics.totalPnl.toFixed(2)}`}
            subValue={`${finalMetrics.totalReturn >= 0 ? "+" : ""}${finalMetrics.totalReturn.toFixed(2)}% return`}
            positive={finalMetrics.totalPnl >= 0}
          />
          <MetricCard
            icon={<BarChart3 className="w-4 h-4 text-blue-500" />}
            label="Sharpe Ratio"
            value={finalMetrics.sharpeRatio.toFixed(3)}
            subValue="Risk-adjusted return"
          />
          <MetricCard
            icon={<TrendingDown className="w-4 h-4 text-red-500" />}
            label="Max Drawdown"
            value={`${finalMetrics.maxDrawdown.toFixed(2)}%`}
            positive={false}
          />
          <MetricCard
            icon={<Percent className="w-4 h-4 text-purple-500" />}
            label="Win Rate"
            value={`${finalMetrics.winRate.toFixed(1)}%`}
            subValue={`${finalMetrics.tradeCount} trades`}
          />
        </div>
      </div>

      {/* Optimized Parameters */}
      <div className="bg-card border rounded-lg">
        <div className="p-4 border-b flex items-center justify-between">
          <h4 className="font-medium">Optimized Parameters</h4>
          <Button variant="outline" size="sm" onClick={copyParams}>
            {copied ? (
              <>
                <Check className="w-3 h-3 mr-1" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-3 h-3 mr-1" />
                Copy JSON
              </>
            )}
          </Button>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {Object.entries(finalParams)
              .filter(([key]) => !["E_override", "EV_min", "m", "T_flat"].includes(key))
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => (
                <div key={key} className="bg-muted/50 rounded px-2 py-1">
                  <span className="text-xs text-muted-foreground">{key}</span>
                  <span className="ml-2 font-mono text-sm">
                    {typeof value === "number"
                      ? value < 1
                        ? value.toFixed(4)
                        : value < 10
                        ? value.toFixed(2)
                        : value.toFixed(0)
                      : value}
                  </span>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Phase Details */}
      <div className="bg-card border rounded-lg">
        <div className="p-4 border-b">
          <h4 className="font-medium">Phase Results</h4>
        </div>
        <div className="divide-y">
          {phaseSummaries.map((phase) => (
            <PhaseDetail
              key={phase.phase}
              phase={phase}
              isExpanded={expandedPhases.has(phase.phase)}
              onToggle={() => togglePhase(phase.phase)}
            />
          ))}
        </div>
      </div>

      {/* Modals */}
      {strategySlug && (
        <>
          <SavePresetModal
            isOpen={showSavePresetModal}
            onClose={() => setShowSavePresetModal(false)}
            strategySlug={strategySlug}
            params={finalParams}
            metrics={{
              totalPnl: finalMetrics.totalPnl,
              sharpeRatio: finalMetrics.sharpeRatio,
              winRate: finalMetrics.winRate,
            }}
            sourceOptimizationId={optimizationRunId}
          />
          <DeployToDryRunModal
            isOpen={showDeployModal}
            onClose={() => setShowDeployModal(false)}
            strategySlug={strategySlug}
            params={finalParams}
          />
        </>
      )}
    </div>
  );
}

interface PhaseDetailProps {
  phase: PhaseSummary;
  isExpanded: boolean;
  onToggle: () => void;
}

function PhaseDetail({ phase, isExpanded, onToggle }: PhaseDetailProps) {
  const bestResult = phase.topResults?.[0];

  return (
    <div>
      <button
        className={`w-full p-4 flex items-center justify-between hover:bg-muted/50 transition-colors ${
          phase.skipped ? "opacity-60" : ""
        }`}
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm bg-muted px-1.5 py-0.5 rounded">
                Phase {phase.phase}
              </span>
              <span className="font-medium">{phase.name}</span>
              {phase.skipped && (
                <span className="text-xs bg-yellow-500/20 text-yellow-600 px-1.5 py-0.5 rounded">
                  Skipped
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">
            {phase.combinationsTested} tested
          </span>
          {bestResult && (
            <span className={`font-mono ${bestResult.metrics.totalPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
              ${bestResult.metrics.totalPnl.toFixed(2)}
            </span>
          )}
          {bestResult && (
            <span className="font-mono">
              SR: {bestResult.metrics.sharpeRatio.toFixed(3)}
            </span>
          )}
        </div>
      </button>

      {isExpanded && !phase.skipped && phase.topResults && phase.topResults.length > 0 && (
        <div className="px-4 pb-4">
          <div className="bg-muted/30 rounded-lg p-3">
            {/* Best Parameters */}
            <div className="mb-3">
              <span className="text-xs text-muted-foreground">Best Parameters:</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {Object.entries(phase.bestParams).map(([key, value]) => (
                  <span key={key} className="bg-green-500/10 text-green-700 dark:text-green-300 px-2 py-0.5 rounded text-xs font-mono">
                    {key}={typeof value === "number" ? (value < 1 ? value.toFixed(4) : value.toFixed(2)) : value}
                  </span>
                ))}
              </div>
            </div>

            {/* Top Results Table */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead className="text-right">PnL</TableHead>
                  <TableHead className="text-right">Sharpe</TableHead>
                  <TableHead className="text-right">Win Rate</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                  <TableHead>Parameters</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {phase.topResults.slice(0, 5).map((result, idx) => (
                  <TableRow key={idx} className={idx === 0 ? "bg-yellow-500/5" : ""}>
                    <TableCell className="font-bold">
                      {idx === 0 ? "Best" : idx + 1}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono ${
                        result.metrics.totalPnl >= 0 ? "text-green-500" : "text-red-500"
                      }`}
                    >
                      ${result.metrics.totalPnl.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {result.metrics.sharpeRatio.toFixed(3)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {result.metrics.winRate.toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right">
                      {result.metrics.tradeCount}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {Object.entries(result.params)
                        .filter(([k]) => Object.keys(phase.bestParams).includes(k))
                        .map(([k, v]) => `${k}=${typeof v === "number" ? (v < 1 ? v.toFixed(3) : v.toFixed(1)) : v}`)
                        .join(", ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {isExpanded && phase.skipped && (
        <div className="px-4 pb-4">
          <div className="bg-yellow-500/10 rounded-lg p-3 text-sm text-yellow-700 dark:text-yellow-300">
            {phase.skipReason || "Phase was skipped"}
          </div>
        </div>
      )}
    </div>
  );
}
