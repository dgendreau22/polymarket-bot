/**
 * Parameter Optimizer
 *
 * Grid search optimization for Time Above 50 strategy parameters.
 *
 * Features:
 * - Generate all parameter combinations from ranges
 * - Run backtests for each combination
 * - Rank results by optimization metric
 * - Progress tracking for long-running optimizations
 */

import type { TimeAbove50Config } from '@/lib/strategies/time-above-50/TimeAbove50Config';
import { DEFAULT_CONFIG } from '@/lib/strategies/time-above-50/TimeAbove50Config';
import { BacktestEngine } from './BacktestEngine';
import type {
  ParameterRange,
  OptimizationConfig,
  OptimizationResult,
  OptimizationRunResult,
  OptimizationProgress,
  OptimizationMetric,
  BacktestConfig,
  PhaseConfig,
  PhaseResult,
  PhaseSummary,
  PhasedOptimizationConfig,
  PhasedOptimizationProgress,
  PhasedOptimizationResult,
  CompositeMetric,
  SensitivityResult,
  Phase9Stage,
} from './types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Maximum number of combinations before requiring explicit confirmation
 */
export const MAX_COMBINATIONS_DEFAULT = 10000;

/**
 * Generate all parameter combinations from ranges
 */
export function generateCombinations(
  baseParams: TimeAbove50Config,
  ranges: ParameterRange[]
): TimeAbove50Config[] {
  if (ranges.length === 0) {
    return [baseParams];
  }

  // Generate values for each parameter
  const paramValues: Map<keyof TimeAbove50Config, number[]> = new Map();

  for (const range of ranges) {
    const values: number[] = [];
    for (let v = range.min; v <= range.max + 1e-9; v += range.step) {
      values.push(Math.round(v * 1e6) / 1e6); // Avoid floating point issues
    }
    paramValues.set(range.param, values);
  }

  // Generate all combinations using cartesian product
  const combinations: TimeAbove50Config[] = [];
  const params = Array.from(paramValues.keys());

  function generateRecursive(
    index: number,
    current: Partial<TimeAbove50Config>
  ): void {
    if (index >= params.length) {
      combinations.push({ ...baseParams, ...current } as TimeAbove50Config);
      return;
    }

    const param = params[index];
    const values = paramValues.get(param)!;

    for (const value of values) {
      generateRecursive(index + 1, { ...current, [param]: value });
    }
  }

  generateRecursive(0, {});
  return combinations;
}

/**
 * Count total combinations without generating them
 */
export function countCombinations(ranges: ParameterRange[]): number {
  if (ranges.length === 0) return 1;

  let count = 1;
  for (const range of ranges) {
    const steps = Math.floor((range.max - range.min) / range.step) + 1;
    count *= steps;
  }
  return count;
}

/**
 * Get the metric value from a result for ranking
 */
function getMetricValue(
  metrics: OptimizationResult['metrics'],
  metric: OptimizationMetric
): number {
  switch (metric) {
    case 'totalPnl':
      return metrics.totalPnl;
    case 'totalReturn':
      return metrics.totalReturn;
    case 'sharpeRatio':
      return metrics.sharpeRatio;
    case 'maxDrawdown':
      return -metrics.maxDrawdown; // Lower is better, so negate
    case 'winRate':
      return metrics.winRate;
    default:
      return metrics.sharpeRatio;
  }
}

/**
 * Progress callback type for streaming updates
 */
export type ProgressCallback = (progress: OptimizationProgress) => void;

/**
 * Run grid search optimization
 */
export async function runOptimization(
  config: OptimizationConfig,
  onProgress?: ProgressCallback
): Promise<OptimizationRunResult> {
  const runId = uuidv4();
  const startTime = Date.now();
  const optimizeMetric = config.optimizeMetric || 'sharpeRatio';

  // Validate combination count
  const combinationCount = countCombinations(config.parameterRanges);
  const maxCombinations = config.maxCombinations || MAX_COMBINATIONS_DEFAULT;

  if (combinationCount > maxCombinations) {
    throw new Error(
      `Too many parameter combinations (${combinationCount}). Maximum allowed is ${maxCombinations}. ` +
        `Reduce parameter ranges or increase step sizes.`
    );
  }

  // Generate all combinations
  const baseParams = { ...DEFAULT_CONFIG, ...config.baseParams };
  const combinations = generateCombinations(baseParams, config.parameterRanges);

  const results: OptimizationResult[] = [];
  let currentBest: OptimizationResult | null = null;

  // Run backtest for each combination
  for (let i = 0; i < combinations.length; i++) {
    const params = combinations[i];

    try {
      const backtestConfig: BacktestConfig = {
        sessionIds: config.sessionIds,
        strategySlug: config.strategySlug,
        strategyParams: params,
        initialCapital: config.initialCapital,
      };

      const engine = new BacktestEngine(backtestConfig);
      const result = await engine.run();

      const optimizationResult: OptimizationResult = {
        rank: 0, // Will be set after sorting
        params,
        metrics: {
          totalPnl: result.totalPnl,
          totalReturn: result.totalReturn,
          sharpeRatio: result.sharpeRatio,
          maxDrawdown: result.maxDrawdown,
          winRate: result.winRate,
          tradeCount: result.tradeCount,
        },
      };

      results.push(optimizationResult);

      // Track best result
      if (
        !currentBest ||
        getMetricValue(optimizationResult.metrics, optimizeMetric) >
          getMetricValue(currentBest.metrics, optimizeMetric)
      ) {
        currentBest = optimizationResult;
      }

      // Report progress
      if (onProgress) {
        const elapsed = Date.now() - startTime;
        const avgTimePerCombination = elapsed / (i + 1);
        const remaining = combinations.length - (i + 1);
        const estimatedTimeRemaining = (remaining * avgTimePerCombination) / 1000;

        // Extract changed parameters for display
        const changedParams: Partial<TimeAbove50Config> = {};
        for (const range of config.parameterRanges) {
          changedParams[range.param] = params[range.param];
        }

        onProgress({
          current: i + 1,
          total: combinations.length,
          percentComplete: ((i + 1) / combinations.length) * 100,
          currentBest: currentBest
            ? {
                params: Object.fromEntries(
                  config.parameterRanges.map((r) => [
                    r.param,
                    currentBest!.params[r.param],
                  ])
                ) as Partial<TimeAbove50Config>,
                metric: getMetricValue(currentBest.metrics, optimizeMetric),
                metricName: optimizeMetric,
              }
            : undefined,
          estimatedTimeRemaining,
          status: 'running',
        });

        // Yield to event loop to allow SSE events to flush
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch (error) {
      console.error(
        `[Optimizer] Error running backtest for combination ${i + 1}:`,
        error
      );
      // Continue with next combination
    }
  }

  // Sort results by optimization metric (descending)
  results.sort(
    (a, b) =>
      getMetricValue(b.metrics, optimizeMetric) -
      getMetricValue(a.metrics, optimizeMetric)
  );

  // Assign ranks
  results.forEach((r, idx) => {
    r.rank = idx + 1;
  });

  const endTime = Date.now();

  // Send completion progress
  if (onProgress) {
    onProgress({
      current: combinations.length,
      total: combinations.length,
      percentComplete: 100,
      currentBest: results[0]
        ? {
            params: Object.fromEntries(
              config.parameterRanges.map((r) => [r.param, results[0].params[r.param]])
            ) as Partial<TimeAbove50Config>,
            metric: getMetricValue(results[0].metrics, optimizeMetric),
            metricName: optimizeMetric,
          }
        : undefined,
      status: 'completed',
    });
  }

  return {
    runId,
    config,
    results,
    combinationsTested: results.length,
    durationSeconds: (endTime - startTime) / 1000,
  };
}

/**
 * Get parameter ranges for common optimization scenarios
 */
export function getPresetRanges(preset: string): ParameterRange[] {
  switch (preset) {
    case 'signal':
      // Signal calculation parameters
      return [
        { param: 'H_tau', min: 30, max: 90, step: 15 },
        { param: 'H_d', min: 30, max: 120, step: 30 },
        { param: 'alpha', min: 0.5, max: 1.5, step: 0.25 },
        { param: 'beta', min: 0.3, max: 0.9, step: 0.2 },
      ];

    case 'thresholds':
      // Entry/exit thresholds
      return [
        { param: 'E_enter', min: 0.1, max: 0.3, step: 0.05 },
        { param: 'E_exit', min: 0.05, max: 0.15, step: 0.025 },
        { param: 'E_taker', min: 0.2, max: 0.5, step: 0.1 },
      ];

    case 'sizing':
      // Position sizing parameters
      return [
        { param: 'k', min: 1.5, max: 4.0, step: 0.5 },
        { param: 'Q_max', min: 200, max: 1000, step: 200 },
        { param: 'q_step', min: 5, max: 20, step: 5 },
      ];

    case 'timing':
      // Timing/throttle parameters
      return [
        { param: 'rebalance_interval', min: 1, max: 5, step: 1 },
        { param: 'cooldown', min: 1, max: 5, step: 1 },
        { param: 'min_hold', min: 5, max: 30, step: 5 },
      ];

    case 'quick':
      // Quick optimization with few parameters
      return [
        { param: 'H_tau', min: 30, max: 60, step: 15 },
        { param: 'E_enter', min: 0.15, max: 0.25, step: 0.05 },
        { param: 'k', min: 2.0, max: 3.0, step: 0.5 },
      ];

    default:
      return [];
  }
}

/**
 * Validate parameter ranges
 */
export function validateRanges(ranges: ParameterRange[]): string[] {
  const errors: string[] = [];

  for (const range of ranges) {
    if (range.min > range.max) {
      errors.push(`${range.param}: min (${range.min}) must be <= max (${range.max})`);
    }
    if (range.step <= 0) {
      errors.push(`${range.param}: step must be positive`);
    }
    if (range.step > range.max - range.min && range.min !== range.max) {
      errors.push(
        `${range.param}: step (${range.step}) is larger than range (${range.max - range.min})`
      );
    }
  }

  return errors;
}

// ============================================================================
// Phased Optimization
// ============================================================================

/**
 * Default composite metric weights
 */
export const DEFAULT_COMPOSITE_METRIC: CompositeMetric = {
  sharpeWeight: 0.6,
  winRateWeight: 0.3,
  profitFactorWeight: 0.1,
};

/**
 * Calculate composite score from metrics
 */
export function calculateCompositeScore(
  metrics: { sharpeRatio: number; winRate: number; profitFactor: number },
  weights: CompositeMetric = DEFAULT_COMPOSITE_METRIC
): number {
  // Normalize metrics to roughly 0-1 scale
  const normalizedSharpe = Math.max(0, metrics.sharpeRatio) / 3; // Assume max Sharpe of 3
  const normalizedWinRate = metrics.winRate; // Already 0-1
  const normalizedProfitFactor = Math.min(metrics.profitFactor, 5) / 5; // Cap at 5

  return (
    weights.sharpeWeight * normalizedSharpe +
    weights.winRateWeight * normalizedWinRate +
    weights.profitFactorWeight * normalizedProfitFactor
  );
}

/**
 * Get the 9-phase optimization configuration
 */
export function getPhasePresets(): PhaseConfig[] {
  return [
    // Phase 1: Signal Half-lives (Foundation)
    {
      phase: 1,
      name: 'Signal Half-lives',
      description: 'Control signal smoothing - foundational to all other signals',
      parameterRanges: [
        { param: 'H_tau', min: 20, max: 80, step: 10 },
        { param: 'H_d', min: 30, max: 120, step: 15 },
      ],
      optimizeMetric: 'sharpeRatio',
      topN: 3,
      earlyStopThreshold: 0.1,
      skipIfNegative: true,
    },
    // Phase 2: Entry/Exit Thresholds (Trade Gates)
    {
      phase: 2,
      name: 'Entry/Exit Thresholds',
      description: 'Gate ALL trading - must maintain E_exit < E_enter by at least 0.04',
      parameterRanges: [
        { param: 'E_enter', min: 0.12, max: 0.28, step: 0.04 },
        { param: 'E_exit', min: 0.05, max: 0.15, step: 0.025 },
      ],
      optimizeMetric: 'sharpeRatio',
      constraints: [
        // E_enter must be greater than E_exit + 0.04
        (params) => params.E_enter > params.E_exit + 0.04,
      ],
      topN: 3,
      earlyStopThreshold: 0.1,
      skipIfNegative: true,
    },
    // Phase 3: Edge Weights
    {
      phase: 3,
      name: 'Edge Weights',
      description: 'Weights that ADD linearly in E calculation',
      parameterRanges: [
        { param: 'alpha', min: 0.6, max: 1.4, step: 0.2 },
        { param: 'beta', min: 0.3, max: 0.9, step: 0.15 },
        { param: 'gamma', min: 0.15, max: 0.45, step: 0.1 },
      ],
      optimizeMetric: 'sharpeRatio',
      topN: 3,
      earlyStopThreshold: 0.1,
      skipIfNegative: false,
    },
    // Phase 4: Theta/Time Scaler
    {
      phase: 4,
      name: 'Theta/Time Scaler',
      description: 'Theta MULTIPLIES edge score - controls behavior near resolution',
      parameterRanges: [
        { param: 'T0', min: 1.5, max: 5.0, step: 0.7 },
        { param: 'theta_b', min: 1.0, max: 2.5, step: 0.3 },
      ],
      optimizeMetric: 'sharpeRatio',
      topN: 3,
      earlyStopThreshold: 0.1,
      skipIfNegative: false,
    },
    // Phase 5: Saturation Scales
    {
      phase: 5,
      name: 'Saturation Scales',
      description: 'Control tanh saturation rate - smaller = faster saturation',
      parameterRanges: [
        { param: 'd0', min: 0.008, max: 0.025, step: 0.004 },
        { param: 'd1', min: 0.005, max: 0.020, step: 0.003 },
      ],
      optimizeMetric: 'sharpeRatio',
      topN: 3,
      earlyStopThreshold: 0.1,
      skipIfNegative: false,
    },
    // Phase 6: Position Sizing
    {
      phase: 6,
      name: 'Position Sizing',
      description: 'Final position = Q_max * gamma(p) * tanh(k * E) - multiplicative',
      parameterRanges: [
        { param: 'k', min: 1.5, max: 4.0, step: 0.5 },
        { param: 'Q_max', min: 300, max: 1000, step: 100 },
      ],
      optimizeMetric: 'totalPnl', // Optimize for total PnL in sizing phase
      topN: 3,
      earlyStopThreshold: 0.1,
      skipIfNegative: false,
    },
    // Phase 7: Taker Threshold
    {
      phase: 7,
      name: 'Taker Threshold',
      description: 'When to cross spread for immediate fills',
      parameterRanges: [
        { param: 'E_taker', min: 0.22, max: 0.45, step: 0.04 },
      ],
      optimizeMetric: 'sharpeRatio',
      topN: 3,
      earlyStopThreshold: 0.1,
      skipIfNegative: false,
    },
    // Phase 8: Decision Frequency
    {
      phase: 8,
      name: 'Decision Frequency',
      description: 'Controls how often strategy can act',
      parameterRanges: [
        { param: 'rebalance_interval', min: 1.0, max: 5.0, step: 0.5 },
      ],
      optimizeMetric: 'sharpeRatio',
      topN: 3,
      earlyStopThreshold: 0.1,
      skipIfNegative: false,
    },
    // Phase 9: Cross-Validation (Smart Multi-Stage)
    {
      phase: 9,
      name: 'Cross-Validation (Smart)',
      description: 'Multi-stage refinement: sensitivity scan, pair interactions, random validation',
      parameterRanges: [], // Will be populated dynamically from previous phase winners
      optimizeMetric: 'composite',
      compositeMetric: {
        sharpeWeight: 0.6,
        winRateWeight: 0.3,
        profitFactorWeight: 0.1,
      },
      topN: 5,
      skipIfNegative: false,
      algorithm: 'multi-stage',
      maxCombinations: 250,
    },
  ];
}

/**
 * Extended parameter range with optional discrete values for Phase 9
 */
type ExtendedParameterRange = ParameterRange & { _discreteValues?: number[] };

/**
 * Generate combinations for a phase, applying constraints
 */
export function generatePhaseCombinatons(
  baseParams: Record<string, number>,
  ranges: ParameterRange[],
  constraints?: ((params: Record<string, number>) => boolean)[]
): Record<string, number>[] {
  if (ranges.length === 0) {
    return [baseParams];
  }

  // Generate values for each parameter
  const paramValues: Map<string, number[]> = new Map();

  for (const range of ranges) {
    const extRange = range as ExtendedParameterRange;

    // Use discrete values if available (for Phase 9 cross-validation)
    if (extRange._discreteValues && extRange._discreteValues.length > 0) {
      paramValues.set(range.param, extRange._discreteValues);
    } else {
      // Generate values from min/max/step
      const values: number[] = [];
      for (let v = range.min; v <= range.max + 1e-9; v += range.step) {
        values.push(Math.round(v * 1e6) / 1e6);
      }
      paramValues.set(range.param, values);
    }
  }

  // Generate all combinations
  const combinations: Record<string, number>[] = [];
  const params = Array.from(paramValues.keys());

  function generateRecursive(index: number, current: Record<string, number>): void {
    if (index >= params.length) {
      // Apply constraints
      if (constraints && constraints.length > 0) {
        const allValid = constraints.every((constraint) => constraint(current));
        if (!allValid) return;
      }
      combinations.push({ ...current });
      return;
    }

    const param = params[index];
    const values = paramValues.get(param)!;

    for (const value of values) {
      generateRecursive(index + 1, { ...current, [param]: value });
    }
  }

  generateRecursive(0, { ...baseParams });
  return combinations;
}

// ============================================================================
// Multi-Stage Phase 9 Helpers
// ============================================================================

/**
 * Run a single backtest and return the result with composite score
 */
async function runSingleBacktest(
  params: Record<string, number>,
  sessionIds: string[],
  strategySlug: string,
  initialCapital: number,
  compositeMetric?: CompositeMetric
): Promise<PhaseResult> {
  const backtestConfig: BacktestConfig = {
    sessionIds,
    strategySlug,
    strategyParams: { ...DEFAULT_CONFIG, ...params } as TimeAbove50Config,
    initialCapital,
  };

  const engine = new BacktestEngine(backtestConfig);
  const result = await engine.run();

  const phaseResult: PhaseResult = {
    params,
    metrics: {
      totalPnl: result.totalPnl,
      totalReturn: result.totalReturn,
      sharpeRatio: result.sharpeRatio,
      maxDrawdown: result.maxDrawdown,
      winRate: result.winRate,
      tradeCount: result.tradeCount,
      profitFactor: result.profitFactor,
    },
  };

  if (compositeMetric) {
    phaseResult.compositeScore = calculateCompositeScore(
      phaseResult.metrics,
      compositeMetric
    );
  }

  return phaseResult;
}

/**
 * Calculate sensitivity for each parameter by testing alternatives
 *
 * Stage B: For each parameter that has multiple candidate values, test each
 * alternative while keeping all other parameters at their best values.
 * This identifies which parameters have the most room for improvement.
 */
export async function calculateSensitivity(
  baseParams: Record<string, number>,
  paramCandidates: Map<string, number[]>,
  sessionIds: string[],
  strategySlug: string,
  initialCapital: number,
  compositeMetric: CompositeMetric,
  onProgress?: (stage: Phase9Stage, current: number, total: number, stageDesc: string) => Promise<void>
): Promise<{ sensitivities: SensitivityResult[]; allResults: PhaseResult[]; baselineScore: number }> {
  const sensitivities: SensitivityResult[] = [];
  const allResults: PhaseResult[] = [];

  // Run baseline first
  const baselineResult = await runSingleBacktest(
    baseParams, sessionIds, strategySlug, initialCapital, compositeMetric
  );
  allResults.push(baselineResult);
  const baselineScore = baselineResult.compositeScore ?? 0;

  // Count total tests for progress
  let totalTests = 0;
  for (const [param, candidates] of paramCandidates) {
    const currentBest = baseParams[param];
    const alternatives = candidates.filter(v => Math.abs(v - currentBest) > 1e-9);
    totalTests += alternatives.length;
  }

  let completedTests = 0;

  // Test each parameter's alternatives
  for (const [param, candidates] of paramCandidates) {
    const currentBest = baseParams[param];
    const alternatives = candidates.filter(v => Math.abs(v - currentBest) > 1e-9);

    if (alternatives.length === 0) {
      sensitivities.push({
        param,
        bestValue: currentBest,
        alternatives: [],
        sensitivity: 0,
        hasImprovement: false,
      });
      continue;
    }

    const alternativeResults: { value: number; delta: number }[] = [];
    let maxDelta = -Infinity;
    let hasImprovement = false;

    for (const altValue of alternatives) {
      const testParams = { ...baseParams, [param]: altValue };
      const result = await runSingleBacktest(
        testParams, sessionIds, strategySlug, initialCapital, compositeMetric
      );
      allResults.push(result);

      const delta = (result.compositeScore ?? 0) - baselineScore;
      alternativeResults.push({ value: altValue, delta });

      if (delta > maxDelta) {
        maxDelta = delta;
      }
      if (delta > 0) {
        hasImprovement = true;
      }

      completedTests++;
      if (onProgress) {
        await onProgress('sensitivity', completedTests, totalTests, `Testing ${param}`);
      }
    }

    sensitivities.push({
      param,
      bestValue: currentBest,
      alternatives: alternativeResults,
      sensitivity: Math.max(0, maxDelta),
      hasImprovement,
    });
  }

  // Sort by sensitivity (highest first)
  sensitivities.sort((a, b) => b.sensitivity - a.sensitivity);

  return { sensitivities, allResults, baselineScore };
}

/**
 * Generate pairwise combinations for the most sensitive parameters
 *
 * Stage C: For each pair of sensitive parameters, test all combinations
 * of their candidate values. This captures interaction effects efficiently.
 */
export function generatePairCombinations(
  baseParams: Record<string, number>,
  sensitivities: SensitivityResult[],
  paramCandidates: Map<string, number[]>,
  maxPairs: number = 100
): Record<string, number>[] {
  // Take top 5-7 parameters that showed sensitivity (improvement potential)
  const sensitiveParams = sensitivities
    .filter(s => s.hasImprovement || s.sensitivity > 0)
    .slice(0, 7);

  if (sensitiveParams.length < 2) {
    // Not enough sensitive params for pair testing
    return [];
  }

  const combinations: Record<string, number>[] = [];
  const pairs: [string, string][] = [];

  // Generate all pairs
  for (let i = 0; i < sensitiveParams.length; i++) {
    for (let j = i + 1; j < sensitiveParams.length; j++) {
      pairs.push([sensitiveParams[i].param, sensitiveParams[j].param]);
    }
  }

  // For each pair, test all value combinations
  for (const [param1, param2] of pairs) {
    const values1 = paramCandidates.get(param1) ?? [baseParams[param1]];
    const values2 = paramCandidates.get(param2) ?? [baseParams[param2]];

    for (const v1 of values1) {
      for (const v2 of values2) {
        // Skip if this is just the baseline
        if (Math.abs(v1 - baseParams[param1]) < 1e-9 &&
            Math.abs(v2 - baseParams[param2]) < 1e-9) {
          continue;
        }

        combinations.push({
          ...baseParams,
          [param1]: v1,
          [param2]: v2,
        });
      }
    }
  }

  // If too many combinations, prioritize by pair sensitivity
  if (combinations.length > maxPairs) {
    // Sort pairs by combined sensitivity
    const pairSensitivity = new Map<string, number>();
    for (const [p1, p2] of pairs) {
      const s1 = sensitivities.find(s => s.param === p1)?.sensitivity ?? 0;
      const s2 = sensitivities.find(s => s.param === p2)?.sensitivity ?? 0;
      pairSensitivity.set(`${p1}:${p2}`, s1 + s2);
    }

    // Keep combinations from most sensitive pairs
    const sortedPairs = [...pairs].sort((a, b) => {
      const keyA = `${a[0]}:${a[1]}`;
      const keyB = `${b[0]}:${b[1]}`;
      return (pairSensitivity.get(keyB) ?? 0) - (pairSensitivity.get(keyA) ?? 0);
    });

    const selectedCombos: Record<string, number>[] = [];
    const combosPerPair = Math.floor(maxPairs / pairs.length);

    for (const [param1, param2] of sortedPairs) {
      const pairCombos = combinations.filter(c =>
        (Math.abs(c[param1] - baseParams[param1]) > 1e-9 ||
         Math.abs(c[param2] - baseParams[param2]) > 1e-9) &&
        // Check it's specifically this pair that changed
        Object.keys(c).every(k =>
          k === param1 || k === param2 || Math.abs(c[k] - baseParams[k]) < 1e-9
        )
      );
      selectedCombos.push(...pairCombos.slice(0, combosPerPair));

      if (selectedCombos.length >= maxPairs) break;
    }

    return selectedCombos.slice(0, maxPairs);
  }

  return combinations;
}

/**
 * Generate random samples from the full parameter space
 *
 * Stage D: Random validation - sample from the full discrete parameter space
 * to confirm we haven't missed a better region.
 */
export function generateRandomSamples(
  baseParams: Record<string, number>,
  paramCandidates: Map<string, number[]>,
  count: number
): Record<string, number>[] {
  const combinations: Record<string, number>[] = [];
  const seenHashes = new Set<string>();

  // Generate random combinations
  const params = Array.from(paramCandidates.keys());

  // Try to generate 'count' unique combinations
  let attempts = 0;
  const maxAttempts = count * 10;

  while (combinations.length < count && attempts < maxAttempts) {
    attempts++;

    const combo = { ...baseParams };
    for (const param of params) {
      const candidates = paramCandidates.get(param)!;
      const randomIdx = Math.floor(Math.random() * candidates.length);
      combo[param] = candidates[randomIdx];
    }

    // Create hash to check uniqueness
    const hash = params.map(p => `${p}:${combo[p]}`).join('|');

    if (!seenHashes.has(hash)) {
      seenHashes.add(hash);
      combinations.push(combo);
    }
  }

  return combinations;
}

/**
 * Run multi-stage Phase 9 optimization
 */
export async function runMultiStagePhase9(
  config: PhasedOptimizationConfig,
  currentParams: Record<string, number>,
  paramCandidates: Map<string, number[]>,
  phase: PhaseConfig,
  phaseSummaries: PhaseSummary[],
  onProgress?: PhasedProgressCallback
): Promise<{ results: PhaseResult[]; bestParams: Record<string, number> }> {
  const allResults: PhaseResult[] = [];
  // Use mutable wrapper to avoid TypeScript closure narrowing issues
  const state = {
    bestResult: null as PhaseResult | null,
    bestParams: { ...currentParams },
  };

  const totalEstimatedCombos = phase.maxCombinations ?? 200;
  let completedCombos = 0;

  const reportProgress = async (
    stage: Phase9Stage,
    stageCurrent: number,
    stageTotal: number,
    stageDesc: string
  ) => {
    if (!onProgress) return;

    completedCombos++;
    const overallPercent = 90 + (completedCombos / totalEstimatedCombos) * 10; // Phase 9 is last ~10%

    onProgress({
      currentPhase: 9,
      totalPhases: config.phases.length,
      phaseName: phase.name,
      currentCombination: completedCombos,
      totalCombinations: totalEstimatedCombos,
      overallPercent: Math.min(overallPercent, 99),
      phasePercent: (completedCombos / totalEstimatedCombos) * 100,
      currentBest: state.bestResult ? {
        params: state.bestResult.params,
        metric: state.bestResult.compositeScore ?? 0,
        metricName: 'composite',
      } : undefined,
      status: 'running',
      completedPhases: phaseSummaries,
      stage,
      stageProgress: (stageCurrent / stageTotal) * 100,
      stageDescription: stageDesc,
    });

    await new Promise(resolve => setTimeout(resolve, 0));
  };

  const updateBest = (result: PhaseResult) => {
    const score = result.compositeScore ?? 0;
    const currentBestScore = state.bestResult ? (state.bestResult.compositeScore ?? -Infinity) : -Infinity;
    if (score > currentBestScore) {
      state.bestResult = result;
      state.bestParams = { ...result.params };
    }
  };

  console.log('[Phase 9] Starting multi-stage optimization');
  console.log(`[Phase 9] Parameter candidates: ${paramCandidates.size} params`);

  // Stage A: Baseline (1 combo)
  console.log('[Phase 9] Stage A: Running baseline...');
  if (onProgress) {
    onProgress({
      currentPhase: 9,
      totalPhases: config.phases.length,
      phaseName: phase.name,
      currentCombination: 0,
      totalCombinations: totalEstimatedCombos,
      overallPercent: 90,
      phasePercent: 0,
      status: 'running',
      completedPhases: phaseSummaries,
      stage: 'baseline',
      stageProgress: 0,
      stageDescription: 'Testing baseline configuration',
    });
  }

  // Stage B: Sensitivity Scan
  console.log('[Phase 9] Stage B: Running sensitivity scan...');
  const { sensitivities, allResults: sensitivityResults, baselineScore } = await calculateSensitivity(
    currentParams,
    paramCandidates,
    config.sessionIds,
    config.strategySlug,
    config.initialCapital,
    phase.compositeMetric ?? DEFAULT_COMPOSITE_METRIC,
    reportProgress
  );

  allResults.push(...sensitivityResults);
  for (const result of sensitivityResults) {
    updateBest(result);
  }

  console.log(`[Phase 9] Sensitivity scan complete. Found ${sensitivities.filter(s => s.hasImprovement).length} params with improvement potential`);
  const topSensitive = sensitivities.slice(0, 5);
  console.log(`[Phase 9] Top 5 sensitive params: ${topSensitive.map(s => `${s.param}(${s.sensitivity.toFixed(4)})`).join(', ')}`);

  // Stage C: Pair Interactions
  console.log('[Phase 9] Stage C: Testing pair interactions...');
  const pairCombos = generatePairCombinations(
    currentParams,
    sensitivities,
    paramCandidates,
    100
  );

  console.log(`[Phase 9] Generated ${pairCombos.length} pair combinations`);

  for (let i = 0; i < pairCombos.length; i++) {
    const combo = pairCombos[i];

    try {
      const result = await runSingleBacktest(
        combo,
        config.sessionIds,
        config.strategySlug,
        config.initialCapital,
        phase.compositeMetric
      );

      allResults.push(result);
      updateBest(result);

      await reportProgress('pairs', i + 1, pairCombos.length, 'Testing parameter pair interactions');
    } catch (error) {
      console.error(`[Phase 9] Error in pair combo ${i + 1}:`, error);
    }
  }

  // Stage D: Random Validation
  console.log('[Phase 9] Stage D: Random validation...');
  const randomCombos = generateRandomSamples(
    currentParams,
    paramCandidates,
    50
  );

  console.log(`[Phase 9] Generated ${randomCombos.length} random combinations`);

  for (let i = 0; i < randomCombos.length; i++) {
    const combo = randomCombos[i];

    try {
      const result = await runSingleBacktest(
        combo,
        config.sessionIds,
        config.strategySlug,
        config.initialCapital,
        phase.compositeMetric
      );

      allResults.push(result);
      updateBest(result);

      await reportProgress('random', i + 1, randomCombos.length, 'Random validation sampling');
    } catch (error) {
      console.error(`[Phase 9] Error in random combo ${i + 1}:`, error);
    }
  }

  console.log(`[Phase 9] Multi-stage optimization complete. Total combinations: ${allResults.length}`);
  const bestScore = state.bestResult ? (state.bestResult.compositeScore ?? 0) : 0;
  console.log(`[Phase 9] Baseline score: ${baselineScore.toFixed(4)}, Best score: ${bestScore.toFixed(4)}`);
  const improvement = (bestScore - baselineScore) / Math.max(0.0001, Math.abs(baselineScore)) * 100;
  console.log(`[Phase 9] Improvement: ${improvement.toFixed(2)}%`);

  return { results: allResults, bestParams: state.bestParams };
}

/**
 * Progress callback type for phased optimization streaming updates
 */
export type PhasedProgressCallback = (progress: PhasedOptimizationProgress) => void;

/**
 * Run phased optimization across all phases
 */
export async function runPhasedOptimization(
  config: PhasedOptimizationConfig,
  onProgress?: PhasedProgressCallback
): Promise<PhasedOptimizationResult> {
  const runId = uuidv4();
  const startTime = Date.now();
  const phaseSummaries: PhaseSummary[] = [];
  let currentParams = { ...DEFAULT_CONFIG, ...config.baseParams } as Record<string, number>;
  let totalCombinationsTested = 0;

  // Calculate total combinations across all phases for progress tracking
  let totalEstimatedCombinations = 0;
  for (const phase of config.phases) {
    if (phase.parameterRanges.length > 0) {
      totalEstimatedCombinations += countCombinations(phase.parameterRanges);
    }
  }

  // Track combinations completed across all phases
  let combinationsCompletedOverall = 0;

  for (const phase of config.phases) {
    const phaseStartTime = Date.now();

    // Skip Phase 9 cross-validation if we don't have enough data
    if (phase.phase === 9 && phaseSummaries.length < 6) {
      phaseSummaries.push({
        phase: phase.phase,
        name: phase.name,
        combinationsTested: 0,
        topResults: [],
        bestParams: {},
        durationSeconds: 0,
        skipped: true,
        skipReason: 'Not enough phases completed for cross-validation',
      });
      continue;
    }

    // For Phase 9, generate combinations from previous phase winners
    let phaseRanges = phase.parameterRanges;
    if (phase.phase === 9) {
      // Collect top 3 values ONLY for parameters that were actually optimized in each phase
      const paramCandidates: Map<string, Set<number>> = new Map();

      // Get the phase configs to know which parameters each phase optimized
      const phaseConfigs = getPhasePresets();

      for (const summary of phaseSummaries) {
        if (summary.skipped) continue;

        // Find the original phase config to get optimized parameter names
        const phaseConfig = phaseConfigs.find(p => p.phase === summary.phase);
        if (!phaseConfig) continue;

        // Only collect the parameters that were actually varied in this phase
        const optimizedParamNames = new Set<string>(phaseConfig.parameterRanges.map(r => r.param as string));

        for (const result of summary.topResults.slice(0, 3)) {
          for (const [param, value] of Object.entries(result.params)) {
            // Only include parameters that were optimized in this specific phase
            if (!optimizedParamNames.has(param)) continue;

            if (!paramCandidates.has(param)) {
              paramCandidates.set(param, new Set());
            }
            paramCandidates.get(param)!.add(value as number);
          }
        }
      }

      // Check if using multi-stage algorithm
      if (phase.algorithm === 'multi-stage') {
        console.log(`[Phase 9] Using multi-stage algorithm (max ${phase.maxCombinations ?? 250} combinations)`);

        // Convert paramCandidates to Map<string, number[]> for the multi-stage function
        const candidatesMap = new Map<string, number[]>();
        for (const [param, values] of paramCandidates) {
          candidatesMap.set(param, Array.from(values).sort((a, b) => a - b));
        }

        // Run multi-stage Phase 9
        const { results: multiStageResults, bestParams } = await runMultiStagePhase9(
          config,
          currentParams,
          candidatesMap,
          phase,
          phaseSummaries,
          onProgress
        );

        // Sort results by composite score
        multiStageResults.sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0));

        // Update current params with best from Phase 9
        Object.assign(currentParams, bestParams);

        totalCombinationsTested += multiStageResults.length;

        const phaseDuration = (Date.now() - phaseStartTime) / 1000;

        phaseSummaries.push({
          phase: phase.phase,
          name: phase.name,
          combinationsTested: multiStageResults.length,
          topResults: multiStageResults.slice(0, phase.topN),
          bestParams,
          durationSeconds: phaseDuration,
          skipped: false,
        });

        // Send phase complete progress
        if (onProgress) {
          onProgress({
            currentPhase: phase.phase,
            totalPhases: config.phases.length,
            phaseName: phase.name,
            currentCombination: multiStageResults.length,
            totalCombinations: multiStageResults.length,
            overallPercent: 100,
            phasePercent: 100,
            currentBest: multiStageResults[0]
              ? {
                  params: multiStageResults[0].params,
                  metric: multiStageResults[0].compositeScore ?? 0,
                  metricName: 'composite',
                }
              : undefined,
            status: 'phase_complete',
            completedPhases: phaseSummaries,
          });
        }

        // Skip the normal combination generation/testing - continue to next phase
        continue;
      }

      // Fallback to exhaustive search for non-multi-stage algorithm
      // Convert to ranges with discrete values
      // Use a custom approach that preserves the exact discrete values
      phaseRanges = [];
      for (const [param, values] of paramCandidates) {
        const sortedValues = Array.from(values).sort((a, b) => a - b);
        if (sortedValues.length >= 1) {
          // For discrete values, we need to construct a range that hits exactly these values
          // Store the discrete values and use them directly in combination generation
          phaseRanges.push({
            param: param as keyof TimeAbove50Config,
            min: sortedValues[0],
            max: sortedValues[sortedValues.length - 1],
            step: sortedValues.length > 1
              ? (sortedValues[sortedValues.length - 1] - sortedValues[0]) / (sortedValues.length - 1)
              : 1,
            // Store discrete values for exact matching
            _discreteValues: sortedValues,
          } as ParameterRange & { _discreteValues?: number[] });
        }
      }

      // Log expected combinations for debugging
      const expectedCombinations = phaseRanges.reduce((acc, r) => {
        const range = r as ParameterRange & { _discreteValues?: number[] };
        const count = range._discreteValues?.length || Math.floor((r.max - r.min) / r.step) + 1;
        return acc * count;
      }, 1);
      console.log(`[Phase 9] Cross-validation with ${phaseRanges.length} parameters, ~${expectedCombinations} combinations (exhaustive)`);
    }

    // Generate combinations for this phase
    const combinations = generatePhaseCombinatons(
      currentParams,
      phaseRanges,
      phase.constraints
    );

    // If no combinations, skip phase
    if (combinations.length === 0) {
      phaseSummaries.push({
        phase: phase.phase,
        name: phase.name,
        combinationsTested: 0,
        topResults: [],
        bestParams: {},
        durationSeconds: 0,
        skipped: true,
        skipReason: 'No valid parameter combinations (constraints too restrictive)',
      });
      continue;
    }

    const phaseResults: PhaseResult[] = [];
    let currentBest: PhaseResult | null = null;

    // Run backtests for each combination
    for (let i = 0; i < combinations.length; i++) {
      const params = combinations[i];

      try {
        const backtestConfig: BacktestConfig = {
          sessionIds: config.sessionIds,
          strategySlug: config.strategySlug,
          strategyParams: { ...DEFAULT_CONFIG, ...params } as TimeAbove50Config,
          initialCapital: config.initialCapital,
        };

        const engine = new BacktestEngine(backtestConfig);
        const result = await engine.run();

        const phaseResult: PhaseResult = {
          params,
          metrics: {
            totalPnl: result.totalPnl,
            totalReturn: result.totalReturn,
            sharpeRatio: result.sharpeRatio,
            maxDrawdown: result.maxDrawdown,
            winRate: result.winRate,
            tradeCount: result.tradeCount,
            profitFactor: result.profitFactor,
          },
        };

        // Calculate composite score if needed
        if (phase.optimizeMetric === 'composite') {
          phaseResult.compositeScore = calculateCompositeScore(
            phaseResult.metrics,
            phase.compositeMetric
          );
        }

        phaseResults.push(phaseResult);

        // Track best result
        const currentMetric = phase.optimizeMetric === 'composite'
          ? phaseResult.compositeScore!
          : getMetricValueFromPhaseResult(phaseResult.metrics, phase.optimizeMetric as OptimizationMetric);

        if (!currentBest) {
          currentBest = phaseResult;
        } else {
          const bestMetric = phase.optimizeMetric === 'composite'
            ? currentBest.compositeScore!
            : getMetricValueFromPhaseResult(currentBest.metrics, phase.optimizeMetric as OptimizationMetric);
          if (currentMetric > bestMetric) {
            currentBest = phaseResult;
          }
        }

        // Report progress
        if (onProgress) {
          combinationsCompletedOverall++;
          const overallPercent = totalEstimatedCombinations > 0
            ? (combinationsCompletedOverall / totalEstimatedCombinations) * 100
            : ((config.phases.indexOf(phase) + (i + 1) / combinations.length) / config.phases.length) * 100;

          onProgress({
            currentPhase: phase.phase,
            totalPhases: config.phases.length,
            phaseName: phase.name,
            currentCombination: i + 1,
            totalCombinations: combinations.length,
            overallPercent: Math.min(overallPercent, 100),
            phasePercent: ((i + 1) / combinations.length) * 100,
            currentBest: currentBest
              ? {
                  params: currentBest.params,
                  metric: phase.optimizeMetric === 'composite'
                    ? currentBest.compositeScore!
                    : getMetricValueFromPhaseResult(currentBest.metrics, phase.optimizeMetric as OptimizationMetric),
                  metricName: phase.optimizeMetric,
                }
              : undefined,
            status: 'running',
            completedPhases: phaseSummaries,
          });

          // Yield to event loop
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      } catch (error) {
        console.error(`[PhasedOptimizer] Error in phase ${phase.phase}, combination ${i + 1}:`, error);
      }
    }

    // Sort results by optimization metric
    phaseResults.sort((a, b) => {
      if (phase.optimizeMetric === 'composite') {
        return (b.compositeScore ?? 0) - (a.compositeScore ?? 0);
      }
      return (
        getMetricValueFromPhaseResult(b.metrics, phase.optimizeMetric as OptimizationMetric) -
        getMetricValueFromPhaseResult(a.metrics, phase.optimizeMetric as OptimizationMetric)
      );
    });

    // Check for early stopping
    let skipReason: string | undefined;
    let skipped = false;

    if (phase.skipIfNegative && phaseResults.length > 0) {
      const allNegative = phaseResults.every((r) => r.metrics.sharpeRatio < 0);
      if (allNegative) {
        skipped = true;
        skipReason = 'All results have negative Sharpe ratio';
      }
    }

    if (phase.earlyStopThreshold && phaseResults.length >= phase.topN) {
      const topN = phaseResults.slice(0, phase.topN);
      const maxSharpe = Math.max(...topN.map((r) => r.metrics.sharpeRatio));
      const minSharpe = Math.min(...topN.map((r) => r.metrics.sharpeRatio));
      if (maxSharpe - minSharpe < phase.earlyStopThreshold) {
        // All top results are within threshold - this is actually good, not a skip
      }
    }

    // Get best parameters to carry forward
    const topResults = phaseResults.slice(0, phase.topN);
    const bestParams: Record<string, number> = {};
    if (topResults.length > 0) {
      // Take the best result's parameters for this phase
      for (const range of phaseRanges) {
        bestParams[range.param] = topResults[0].params[range.param];
      }
      // Update currentParams with best from this phase
      Object.assign(currentParams, bestParams);
    }

    totalCombinationsTested += phaseResults.length;

    const phaseDuration = (Date.now() - phaseStartTime) / 1000;

    phaseSummaries.push({
      phase: phase.phase,
      name: phase.name,
      combinationsTested: phaseResults.length,
      topResults,
      bestParams,
      durationSeconds: phaseDuration,
      skipped,
      skipReason,
    });

    // Send phase complete progress
    if (onProgress) {
      onProgress({
        currentPhase: phase.phase,
        totalPhases: config.phases.length,
        phaseName: phase.name,
        currentCombination: combinations.length,
        totalCombinations: combinations.length,
        overallPercent: (config.phases.indexOf(phase) + 1) / config.phases.length * 100,
        phasePercent: 100,
        currentBest: topResults[0]
          ? {
              params: topResults[0].params,
              metric: phase.optimizeMetric === 'composite'
                ? topResults[0].compositeScore!
                : getMetricValueFromPhaseResult(topResults[0].metrics, phase.optimizeMetric as OptimizationMetric),
              metricName: phase.optimizeMetric,
            }
          : undefined,
        status: 'phase_complete',
        completedPhases: phaseSummaries,
      });
    }
  }

  // Run final validation with optimized parameters
  const finalBacktestConfig: BacktestConfig = {
    sessionIds: config.sessionIds,
    strategySlug: config.strategySlug,
    strategyParams: { ...DEFAULT_CONFIG, ...currentParams } as TimeAbove50Config,
    initialCapital: config.initialCapital,
  };

  const finalEngine = new BacktestEngine(finalBacktestConfig);
  const finalResult = await finalEngine.run();

  const totalDuration = (Date.now() - startTime) / 1000;

  // Send completion progress
  if (onProgress) {
    onProgress({
      currentPhase: config.phases.length,
      totalPhases: config.phases.length,
      phaseName: 'Complete',
      currentCombination: 0,
      totalCombinations: 0,
      overallPercent: 100,
      phasePercent: 100,
      status: 'completed',
      completedPhases: phaseSummaries,
    });
  }

  return {
    runId,
    config,
    phaseSummaries,
    finalParams: currentParams,
    finalMetrics: {
      totalPnl: finalResult.totalPnl,
      totalReturn: finalResult.totalReturn,
      sharpeRatio: finalResult.sharpeRatio,
      maxDrawdown: finalResult.maxDrawdown,
      winRate: finalResult.winRate,
      tradeCount: finalResult.tradeCount,
      profitFactor: finalResult.profitFactor,
    },
    totalCombinationsTested,
    totalDurationSeconds: totalDuration,
  };
}

/**
 * Helper to get metric value from PhaseResult metrics
 */
function getMetricValueFromPhaseResult(
  metrics: PhaseResult['metrics'],
  metric: OptimizationMetric
): number {
  switch (metric) {
    case 'totalPnl':
      return metrics.totalPnl;
    case 'totalReturn':
      return metrics.totalReturn;
    case 'sharpeRatio':
      return metrics.sharpeRatio;
    case 'maxDrawdown':
      return -metrics.maxDrawdown;
    case 'winRate':
      return metrics.winRate;
    default:
      return metrics.sharpeRatio;
  }
}

/**
 * Get preset ranges for specific phase
 */
export function getPhasePresetRanges(phaseNumber: number): ParameterRange[] {
  const phases = getPhasePresets();
  const phase = phases.find((p) => p.phase === phaseNumber);
  return phase?.parameterRanges || [];
}
