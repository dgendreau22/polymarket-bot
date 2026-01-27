"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import {
  SessionSelector,
  GridSearchForm,
  ProgressStream,
  ResultsDisplay,
  PhasedOptimizationForm,
  PhasedProgressStream,
  PhasedResultsDisplay,
} from "@/components/backtest";
import {
  FlaskConical,
  Play,
  Loader2,
  ArrowLeft,
  Zap,
  Settings2,
  Square,
  Layers,
} from "lucide-react";
import type {
  BacktestResult,
  ParameterRange,
  OptimizationMetric,
  OptimizationProgress,
  OptimizationResult,
  PhasedOptimizationProgress,
  PhaseSummary,
} from "@/lib/backtest/types";

type Mode = "single" | "optimize" | "phased";

export default function BacktestPage() {
  // Session selection
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);

  // Mode toggle
  const [mode, setMode] = useState<Mode>("single");

  // Grid search state
  const [parameterRanges, setParameterRanges] = useState<ParameterRange[]>([]);
  const [optimizeMetric, setOptimizeMetric] = useState<OptimizationMetric>("sharpeRatio");
  const [initialCapital, setInitialCapital] = useState(1000);

  // Phased optimization state
  const [selectedPhases, setSelectedPhases] = useState<number[]>([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const [phasedProgress, setPhasedProgress] = useState<PhasedOptimizationProgress | null>(null);
  const [phasedResult, setPhasedResult] = useState<{
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
    optimizationRunId?: string;
    strategySlug?: string;
  } | null>(null);

  // Execution state
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<OptimizationProgress | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [optimizationResults, setOptimizationResults] = useState<OptimizationResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const canRun =
    selectedSessions.length > 0 &&
    !running &&
    (mode === "single" || mode === "phased" || parameterRanges.length > 0) &&
    (mode !== "phased" || selectedPhases.length > 0);

  const combinationCount =
    parameterRanges.length === 0
      ? 1
      : parameterRanges.reduce((count, range) => {
          const steps = Math.floor((range.max - range.min) / range.step) + 1;
          return count * Math.max(1, steps);
        }, 1);

  const runSingleBacktest = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/backtest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionIds: selectedSessions,
          initialCapital,
          saveResult: true,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setResult(data.result);
      } else {
        setError(data.error || "Backtest failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backtest failed");
    } finally {
      setRunning(false);
    }
  }, [selectedSessions, initialCapital]);

  const runOptimization = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    setOptimizationResults(null);
    // Clear previous progress immediately, then set initial state
    setProgress(null);
    // Use setTimeout to ensure React processes the null state first
    await new Promise(resolve => setTimeout(resolve, 0));
    setProgress({ current: 0, total: combinationCount, percentComplete: 0, status: "running" });

    // Create abort controller for this run
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const res = await fetch("/api/backtest/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionIds: selectedSessions,
          parameterRanges,
          initialCapital,
          optimizeMetric,
        }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Optimization failed");
      }

      // Read SSE stream
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === "result") {
                // Final result
                setOptimizationResults(data.topResults);
                setProgress((prev) =>
                  prev ? { ...prev, status: "completed", percentComplete: 100 } : null
                );
                // Clear progress after showing completion briefly
                setTimeout(() => setProgress(null), 2000);
              } else if (data.status) {
                // Progress update
                setProgress(data);
              }
            } catch {
              // Ignore JSON parse errors for partial data
            }
          }
        }
      }
    } catch (err) {
      // Check if this was an abort
      if (err instanceof Error && err.name === "AbortError") {
        setProgress((prev) =>
          prev ? { ...prev, status: "completed", percentComplete: prev.percentComplete } : null
        );
        // Don't show error for user-initiated abort
      } else {
        setError(err instanceof Error ? err.message : "Optimization failed");
        setProgress((prev) =>
          prev
            ? { ...prev, status: "error", errorMessage: err instanceof Error ? err.message : "Unknown error" }
            : null
        );
      }
    } finally {
      setRunning(false);
      abortControllerRef.current = null;
    }
  }, [selectedSessions, parameterRanges, initialCapital, optimizeMetric, combinationCount]);

  const runPhasedOptimization = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    setPhasedResult(null);
    setPhasedProgress(null);
    await new Promise(resolve => setTimeout(resolve, 0));
    setPhasedProgress({
      currentPhase: 1,
      totalPhases: selectedPhases.length,
      phaseName: "Starting...",
      currentCombination: 0,
      totalCombinations: 0,
      overallPercent: 0,
      phasePercent: 0,
      status: "running",
      completedPhases: [],
    });

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const res = await fetch("/api/backtest/phased", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionIds: selectedSessions,
          phases: selectedPhases,
          initialCapital,
          saveResult: true,
        }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Phased optimization failed");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === "result") {
                setPhasedResult({
                  finalParams: data.finalParams,
                  finalMetrics: data.finalMetrics,
                  phaseSummaries: data.phaseSummaries,
                  totalCombinationsTested: data.totalCombinationsTested,
                  totalDurationSeconds: data.totalDurationSeconds,
                  optimizationRunId: data.optimizationRunId,
                  strategySlug: data.strategySlug,
                });
                setPhasedProgress((prev) =>
                  prev ? { ...prev, status: "completed", overallPercent: 100 } : null
                );
                setTimeout(() => setPhasedProgress(null), 2000);
              } else if (data.status) {
                setPhasedProgress(data);
              }
            } catch {
              // Ignore JSON parse errors
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setPhasedProgress((prev) =>
          prev ? { ...prev, status: "completed" } : null
        );
      } else {
        setError(err instanceof Error ? err.message : "Phased optimization failed");
        setPhasedProgress((prev) =>
          prev
            ? { ...prev, status: "error", errorMessage: err instanceof Error ? err.message : "Unknown error" }
            : null
        );
      }
    } finally {
      setRunning(false);
      abortControllerRef.current = null;
    }
  }, [selectedSessions, selectedPhases, initialCapital]);

  const stopOptimization = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const handleRun = () => {
    if (mode === "single") {
      runSingleBacktest();
    } else if (mode === "phased") {
      runPhasedOptimization();
    } else {
      runOptimization();
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Dashboard
              </Link>
              <div className="flex items-center gap-2">
                <FlaskConical className="w-5 h-5 text-purple-500" />
                <h1 className="text-xl font-bold">Backtesting</h1>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* Mode Toggle */}
              <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                <button
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm transition-colors ${
                    mode === "single"
                      ? "bg-background shadow-sm font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setMode("single")}
                >
                  <Play className="w-3 h-3" />
                  Single
                </button>
                <button
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm transition-colors ${
                    mode === "optimize"
                      ? "bg-background shadow-sm font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setMode("optimize")}
                >
                  <Settings2 className="w-3 h-3" />
                  Grid
                </button>
                <button
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm transition-colors ${
                    mode === "phased"
                      ? "bg-background shadow-sm font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setMode("phased")}
                >
                  <Layers className="w-3 h-3" />
                  Phased
                </button>
              </div>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-8">
        {/* Error Banner */}
        {error && (
          <div className="bg-destructive/10 border border-destructive rounded-lg p-4 mb-6">
            <span className="text-destructive">{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6 items-start lg:items-stretch">
          {/* Session Selector */}
          <SessionSelector
            selectedSessions={selectedSessions}
            onSelectionChange={setSelectedSessions}
          />

          {/* Grid Search Form (only in grid optimize mode) */}
          {mode === "optimize" && (
            <GridSearchForm
              onRangesChange={setParameterRanges}
              onMetricChange={setOptimizeMetric}
              onCapitalChange={setInitialCapital}
              initialCapital={initialCapital}
              optimizeMetric={optimizeMetric}
            />
          )}

          {/* Phased Optimization Form */}
          {mode === "phased" && (
            <PhasedOptimizationForm
              onPhasesChange={setSelectedPhases}
              onCapitalChange={setInitialCapital}
              initialCapital={initialCapital}
            />
          )}

          {/* Single Mode Settings */}
          {mode === "single" && (
            <div className="bg-card border rounded-lg p-6">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-5 h-5 text-yellow-500" />
                <h3 className="font-semibold">Single Backtest</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Run a single backtest with the default Time Above 50 parameters.
                Select one or more recording sessions to test against.
              </p>
              <div className="flex items-center gap-2">
                <label className="text-sm">Initial Capital:</label>
                <input
                  type="number"
                  value={initialCapital}
                  onChange={(e) => setInitialCapital(parseFloat(e.target.value) || 1000)}
                  className="w-24 px-2 py-1 border rounded text-sm"
                />
              </div>
            </div>
          )}
        </div>

        {/* Run/Stop Buttons */}
        <div className="flex justify-center gap-3 mb-6">
          <Button
            size="lg"
            onClick={handleRun}
            disabled={!canRun || (mode === "optimize" && combinationCount > 10000)}
          >
            {running ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {mode === "phased" ? "Running Phased Optimization..." : mode === "optimize" ? "Optimizing..." : "Running..."}
              </>
            ) : (
              <>
                {mode === "phased" ? (
                  <>
                    <Layers className="w-4 h-4 mr-2" />
                    Run Phased Optimization ({selectedPhases.length} phases)
                  </>
                ) : mode === "optimize" ? (
                  <>
                    <Settings2 className="w-4 h-4 mr-2" />
                    Run Grid Optimization ({combinationCount.toLocaleString()} combinations)
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    Run Backtest
                  </>
                )}
              </>
            )}
          </Button>
          {running && (mode === "optimize" || mode === "phased") && (
            <Button
              size="lg"
              variant="destructive"
              onClick={stopOptimization}
            >
              <Square className="w-4 h-4 mr-2" />
              Stop
            </Button>
          )}
        </div>

        {/* Progress */}
        {progress && mode === "optimize" && (
          <div className="mb-6"><ProgressStream progress={progress} /></div>
        )}
        {phasedProgress && mode === "phased" && (
          <div className="mb-6"><PhasedProgressStream progress={phasedProgress} /></div>
        )}

        {/* Results */}
        {mode === "phased" && phasedResult ? (
          <PhasedResultsDisplay
            finalParams={phasedResult.finalParams}
            finalMetrics={phasedResult.finalMetrics}
            phaseSummaries={phasedResult.phaseSummaries}
            totalCombinationsTested={phasedResult.totalCombinationsTested}
            totalDurationSeconds={phasedResult.totalDurationSeconds}
            strategySlug={phasedResult.strategySlug}
            optimizationRunId={phasedResult.optimizationRunId}
          />
        ) : (
          <ResultsDisplay
            result={result}
            optimizationResults={optimizationResults}
            optimizeMetric={optimizeMetric}
            parameterNames={parameterRanges.map((r) => r.param)}
          />
        )}
      </div>
    </div>
  );
}
