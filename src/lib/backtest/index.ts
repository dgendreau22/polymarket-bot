/**
 * Backtest Module
 *
 * Exports for backtesting the Time Above 50 strategy against recorded market data.
 */

// Types
export type {
  BacktestConfig,
  BacktestResult,
  BacktestTrade,
  BalanceSnapshot,
  SessionBreakdown,
  ParameterRange,
  OptimizationConfig,
  OptimizationMetric,
  OptimizationResult,
  OptimizationRunResult,
  OptimizationProgress,
  BacktestRunRow,
  ConsensusPricePoint,
  ProcessedTick,
  SimulatedPosition,
  // Phased optimization types
  CompositeMetric,
  PhaseConfig,
  PhaseResult,
  PhaseSummary,
  PhasedOptimizationConfig,
  PhasedOptimizationProgress,
  PhasedOptimizationResult,
  OptimizationRunRow,
  PhaseResultRow,
} from './types';

// Engine
export { BacktestEngine, runBacktest } from './BacktestEngine';

// PnL Calculator
export {
  calculateMetrics,
  calculateSharpeRatio,
  calculateMaxDrawdown,
  calculateWinRate,
  calculateProfitFactor,
  calculateSessionMetrics,
  calculateRollingSharpe,
  calculateEquityCurveStats,
  type PnLMetrics,
  type SessionMetrics,
  type EquityCurveStats,
} from './PnLCalculator';

// Parameter Optimizer
export {
  runOptimization,
  generateCombinations,
  countCombinations,
  getPresetRanges,
  validateRanges,
  MAX_COMBINATIONS_DEFAULT,
  type ProgressCallback,
  // Phased optimization
  runPhasedOptimization,
  getPhasePresets,
  getPhasePresetRanges,
  generatePhaseCombinatons,
  calculateCompositeScore,
  DEFAULT_COMPOSITE_METRIC,
  type PhasedProgressCallback,
} from './ParameterOptimizer';
