"use client";

import { Progress } from "@/components/ui/progress";
import { Clock, TrendingUp, Loader2 } from "lucide-react";
import type { OptimizationProgress } from "@/lib/backtest/types";

interface ProgressStreamProps {
  progress: OptimizationProgress | null;
}

export function ProgressStream({ progress }: ProgressStreamProps) {
  if (!progress) {
    return null;
  }

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  };

  return (
    <div className="bg-card border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {progress.status === "running" && (
            <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
          )}
          <span className="font-medium">
            {progress.status === "running"
              ? "Optimization in progress..."
              : progress.status === "completed"
              ? "Optimization complete!"
              : "Error"}
          </span>
        </div>
        <span className="text-sm text-muted-foreground">
          {progress.current} / {progress.total} combinations
        </span>
      </div>

      <Progress value={progress.percentComplete} className="h-2 mb-3" />

      <div className="flex items-center justify-between text-sm">
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
              {progress.currentBest.metricName === "totalPnl"
                ? `$${progress.currentBest.metric.toFixed(2)}`
                : progress.currentBest.metricName === "totalReturn" ||
                  progress.currentBest.metricName === "winRate" ||
                  progress.currentBest.metricName === "maxDrawdown"
                ? `${progress.currentBest.metric.toFixed(2)}%`
                : progress.currentBest.metric.toFixed(3)}
            </span>
          </div>
        )}
      </div>

      {progress.status === "error" && progress.errorMessage && (
        <div className="mt-3 p-2 bg-destructive/10 rounded text-sm text-destructive">
          {progress.errorMessage}
        </div>
      )}
    </div>
  );
}
