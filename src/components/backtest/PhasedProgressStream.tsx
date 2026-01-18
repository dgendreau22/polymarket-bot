"use client";

import { Progress } from "@/components/ui/progress";
import { Clock, TrendingUp, Loader2, CheckCircle2, SkipForward, Layers, Beaker, GitBranch, Shuffle } from "lucide-react";
import type { PhasedOptimizationProgress, PhaseSummary, Phase9Stage } from "@/lib/backtest/types";

interface PhasedProgressStreamProps {
  progress: PhasedOptimizationProgress | null;
}

// Stage display info for Phase 9 multi-stage algorithm
const STAGE_INFO: Record<Phase9Stage, { label: string; icon: React.ReactNode; color: string }> = {
  baseline: {
    label: "Baseline",
    icon: <Beaker className="w-3 h-3" />,
    color: "text-blue-500",
  },
  sensitivity: {
    label: "Sensitivity Scan",
    icon: <TrendingUp className="w-3 h-3" />,
    color: "text-yellow-500",
  },
  pairs: {
    label: "Pair Interactions",
    icon: <GitBranch className="w-3 h-3" />,
    color: "text-purple-500",
  },
  random: {
    label: "Random Validation",
    icon: <Shuffle className="w-3 h-3" />,
    color: "text-green-500",
  },
};

export function PhasedProgressStream({ progress }: PhasedProgressStreamProps) {
  if (!progress) {
    return null;
  }

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  };

  const formatMetricValue = (metric: number, metricName: string): string => {
    if (metricName === "totalPnl") return `$${metric.toFixed(2)}`;
    if (metricName === "totalReturn" || metricName === "winRate" || metricName === "maxDrawdown") {
      return `${metric.toFixed(2)}%`;
    }
    if (metricName === "composite") return metric.toFixed(3);
    return metric.toFixed(3);
  };

  const isPhase9MultiStage = progress.currentPhase === 9 && progress.stage;

  return (
    <div className="bg-card border rounded-lg">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {progress.status === "running" ? (
              <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
            ) : progress.status === "completed" ? (
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            ) : progress.status === "phase_complete" ? (
              <Layers className="w-4 h-4 text-purple-500" />
            ) : null}
            <span className="font-medium">
              {progress.status === "running"
                ? `Phase ${progress.currentPhase}: ${progress.phaseName}`
                : progress.status === "completed"
                ? "Optimization Complete!"
                : progress.status === "phase_complete"
                ? `Phase ${progress.currentPhase} Complete`
                : "Error"}
            </span>
          </div>
          <span className="text-sm text-muted-foreground">
            Phase {progress.currentPhase} of {progress.totalPhases}
          </span>
        </div>

        {/* Overall Progress */}
        <div className="mb-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Overall Progress</span>
            <span>{progress.overallPercent.toFixed(0)}%</span>
          </div>
          <Progress value={progress.overallPercent} className="h-2" />
        </div>

        {/* Phase Progress */}
        {progress.status === "running" && progress.totalCombinations > 0 && (
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Phase Progress</span>
              <span>
                {progress.currentCombination} / {progress.totalCombinations}
              </span>
            </div>
            <Progress value={progress.phasePercent} className="h-1.5 bg-muted/30" />
          </div>
        )}

        {/* Phase 9 Stage Progress */}
        {isPhase9MultiStage && progress.status === "running" && progress.stage && (
          <div className="mt-3 p-2 bg-muted/20 rounded">
            <div className="flex items-center justify-between text-xs mb-1">
              <div className="flex items-center gap-1.5">
                <span className={STAGE_INFO[progress.stage].color}>
                  {STAGE_INFO[progress.stage].icon}
                </span>
                <span className="text-muted-foreground">
                  Stage: <span className="text-foreground font-medium">{STAGE_INFO[progress.stage].label}</span>
                </span>
              </div>
              {progress.stageProgress !== undefined && (
                <span className="text-muted-foreground">
                  {progress.stageProgress.toFixed(0)}%
                </span>
              )}
            </div>
            {progress.stageProgress !== undefined && (
              <Progress
                value={progress.stageProgress}
                className={`h-1 ${progress.stage === 'sensitivity' ? 'bg-yellow-500/20' : progress.stage === 'pairs' ? 'bg-purple-500/20' : progress.stage === 'random' ? 'bg-green-500/20' : 'bg-blue-500/20'}`}
              />
            )}
            {progress.stageDescription && (
              <p className="text-xs text-muted-foreground mt-1">{progress.stageDescription}</p>
            )}
          </div>
        )}
      </div>

      {/* Stats Row */}
      <div className="p-4 flex items-center justify-between text-sm border-b">
        <div className="flex items-center gap-4">
          {progress.estimatedTimeRemaining && progress.status === "running" && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className="w-3 h-3" />
              ~{formatTime(progress.estimatedTimeRemaining)} remaining
            </span>
          )}
        </div>

        {progress.currentBest && (
          <div className="flex items-center gap-2">
            <TrendingUp className="w-3 h-3 text-green-500" />
            <span className="text-muted-foreground">Best {progress.currentBest.metricName}:</span>
            <span className="font-mono font-medium">
              {formatMetricValue(progress.currentBest.metric, progress.currentBest.metricName)}
            </span>
          </div>
        )}
      </div>

      {/* Completed Phases */}
      {progress.completedPhases && progress.completedPhases.length > 0 && (
        <div className="p-4">
          <h4 className="text-sm font-medium text-muted-foreground mb-3">
            Completed Phases
          </h4>
          <div className="space-y-2">
            {progress.completedPhases.map((phase) => (
              <PhaseRow key={phase.phase} phase={phase} />
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {progress.status === "error" && progress.errorMessage && (
        <div className="p-4 bg-destructive/10 border-t">
          <span className="text-sm text-destructive">{progress.errorMessage}</span>
        </div>
      )}
    </div>
  );
}

interface PhaseRowProps {
  phase: PhaseSummary;
}

function PhaseRow({ phase }: PhaseRowProps) {
  const bestSharpe = phase.topResults[0]?.metrics.sharpeRatio;
  const bestPnl = phase.topResults[0]?.metrics.totalPnl;

  return (
    <div
      className={`flex items-center justify-between p-2 rounded ${
        phase.skipped ? "bg-muted/30 text-muted-foreground" : "bg-green-500/10"
      }`}
    >
      <div className="flex items-center gap-2">
        {phase.skipped ? (
          <SkipForward className="w-4 h-4 text-muted-foreground" />
        ) : (
          <CheckCircle2 className="w-4 h-4 text-green-500" />
        )}
        <span className="text-sm">
          <span className="font-mono">Phase {phase.phase}</span>
          <span className="mx-1">-</span>
          <span>{phase.name}</span>
        </span>
      </div>
      <div className="flex items-center gap-4 text-sm">
        {phase.skipped ? (
          <span className="text-xs text-muted-foreground">{phase.skipReason}</span>
        ) : (
          <>
            <span className="text-muted-foreground">
              {phase.combinationsTested} tested
            </span>
            {bestSharpe !== undefined && (
              <span className="font-mono">
                Sharpe: {bestSharpe.toFixed(3)}
              </span>
            )}
            {bestPnl !== undefined && (
              <span className={`font-mono ${bestPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                ${bestPnl.toFixed(2)}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
