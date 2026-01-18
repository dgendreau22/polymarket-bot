/**
 * Backtest Engine Types
 *
 * Interfaces for backtesting the Time Above 50 strategy against recorded market data.
 */

import type { TimeAbove50Config } from '@/lib/strategies/time-above-50/TimeAbove50Config';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for a single backtest run
 */
export interface BacktestConfig {
  /** Recording session IDs to use for backtest */
  sessionIds: string[];
  /** Strategy to backtest (currently only 'time-above-50') */
  strategySlug: string;
  /** Strategy parameters */
  strategyParams: TimeAbove50Config;
  /** Starting capital in dollars */
  initialCapital: number;
  /** Optional: End time to cut off backtest (ISO string) */
  endTimeOverride?: string;
}

/**
 * Parameter range specification for grid search optimization
 */
export interface ParameterRange {
  /** Parameter name from TimeAbove50Config */
  param: keyof TimeAbove50Config;
  /** Minimum value */
  min: number;
  /** Maximum value */
  max: number;
  /** Step size for grid search */
  step: number;
}

/**
 * Configuration for optimization run
 */
export interface OptimizationConfig {
  /** Recording session IDs to use */
  sessionIds: string[];
  /** Strategy to optimize */
  strategySlug: string;
  /** Base parameters (non-optimized values) */
  baseParams: TimeAbove50Config;
  /** Parameters to optimize with ranges */
  parameterRanges: ParameterRange[];
  /** Starting capital */
  initialCapital: number;
  /** Metric to optimize (default: 'sharpeRatio') */
  optimizeMetric?: OptimizationMetric;
  /** Maximum parameter combinations to run (default: 10000) */
  maxCombinations?: number;
}

export type OptimizationMetric =
  | 'totalPnl'
  | 'totalReturn'
  | 'sharpeRatio'
  | 'maxDrawdown'
  | 'winRate';

// ============================================================================
// Result Types
// ============================================================================

/**
 * A single simulated trade during backtest
 */
export interface BacktestTrade {
  /** Unique ID */
  id: string;
  /** Timestamp of trade (ISO string) */
  timestamp: string;
  /** BUY or SELL */
  side: 'BUY' | 'SELL';
  /** YES or NO outcome */
  outcome: 'YES' | 'NO';
  /** Price at which trade was executed */
  price: number;
  /** Quantity of shares */
  quantity: number;
  /** Total value (price * quantity) */
  value: number;
  /** PnL for this trade (only for SELL) */
  pnl: number;
  /** Reason for trade (signal description) */
  reason: string;
  /** Session ID this trade occurred in */
  sessionId: string;
}

/**
 * Balance snapshot for equity curve
 */
export interface BalanceSnapshot {
  /** Timestamp (Unix ms) */
  timestamp: number;
  /** Account balance at this point */
  balance: number;
  /** Equity (balance + position value) */
  equity: number;
}

/**
 * Per-session breakdown of results
 */
export interface SessionBreakdown {
  /** Session ID */
  sessionId: string;
  /** Session market name */
  marketName: string;
  /** PnL for this session */
  pnl: number;
  /** Number of trades */
  tradeCount: number;
  /** Win rate for this session */
  winRate: number;
  /** Duration in minutes */
  durationMinutes: number;
}

/**
 * Complete result of a backtest run
 */
export interface BacktestResult {
  /** Run ID */
  runId: string;
  /** Strategy parameters used */
  strategyParams: TimeAbove50Config;
  /** Initial capital */
  initialCapital: number;
  /** Final balance after all trades */
  finalBalance: number;
  /** Total PnL (finalBalance - initialCapital) */
  totalPnl: number;
  /** Return percentage */
  totalReturn: number;
  /** Sharpe ratio (annualized) */
  sharpeRatio: number;
  /** Maximum drawdown percentage */
  maxDrawdown: number;
  /** Win rate (percentage of profitable trades) */
  winRate: number;
  /** Total number of trades */
  tradeCount: number;
  /** Average trade PnL */
  avgTradePnl: number;
  /** Largest winning trade */
  maxWin: number;
  /** Largest losing trade */
  maxLoss: number;
  /** Profit factor (gross profit / gross loss) */
  profitFactor: number;
  /** All simulated trades */
  trades: BacktestTrade[];
  /** Balance history for equity curve */
  balanceHistory: BalanceSnapshot[];
  /** Breakdown by session */
  sessionBreakdown: SessionBreakdown[];
  /** Duration of backtest in seconds */
  backtestDurationSeconds: number;
  /** Number of ticks processed */
  ticksProcessed: number;
}

/**
 * Optimization result (one entry per parameter combination)
 */
export interface OptimizationResult {
  /** Rank by optimization metric */
  rank: number;
  /** Parameters used */
  params: TimeAbove50Config;
  /** Abbreviated result (key metrics only) */
  metrics: {
    totalPnl: number;
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    tradeCount: number;
  };
}

/**
 * Complete optimization run results
 */
export interface OptimizationRunResult {
  /** Run ID */
  runId: string;
  /** Configuration used */
  config: OptimizationConfig;
  /** All results ranked by optimization metric */
  results: OptimizationResult[];
  /** Total combinations tested */
  combinationsTested: number;
  /** Duration in seconds */
  durationSeconds: number;
}

// ============================================================================
// Database Row Types
// ============================================================================

/**
 * Database row for backtest_runs table
 */
export interface BacktestRunRow {
  id: string;
  created_at: string;
  strategy_slug: string;
  session_ids: string; // JSON array
  strategy_params: string; // JSON
  initial_capital: number;
  total_pnl: number;
  total_return: number;
  sharpe_ratio: number;
  max_drawdown: number;
  win_rate: number;
  trade_count: number;
  results: string; // Full BacktestResult JSON
}

// ============================================================================
// Progress Types (for SSE streaming)
// ============================================================================

/**
 * Progress update sent during optimization
 */
export interface OptimizationProgress {
  /** Current combination being tested */
  current: number;
  /** Total combinations to test */
  total: number;
  /** Percentage complete */
  percentComplete: number;
  /** Current best result (if any) */
  currentBest?: {
    params: Partial<TimeAbove50Config>;
    metric: number;
    metricName: string;
  };
  /** Estimated time remaining in seconds */
  estimatedTimeRemaining?: number;
  /** Status message */
  status: 'running' | 'completed' | 'error';
  /** Error message (if status is 'error') */
  errorMessage?: string;
}

// ============================================================================
// Internal Types (used by engine)
// ============================================================================

/**
 * Processed tick for backtest simulation
 */
export interface ProcessedTick {
  /** Timestamp (Unix ms) */
  timestamp: number;
  /** YES or NO */
  outcome: 'YES' | 'NO';
  /** Price */
  price: number;
  /** Size */
  size: number;
  /** Session ID */
  sessionId: string;
}

/**
 * Consensus price point derived from ticks
 */
export interface ConsensusPricePoint {
  /** Timestamp (Unix ms) */
  timestamp: number;
  /** Consensus price */
  price: number;
  /** YES price (VWAP from ticks) */
  yesPrice: number;
  /** NO price (VWAP from ticks) */
  noPrice: number;
  /** Session ID */
  sessionId: string;
  /** YES best bid (from snapshot, if available) */
  yesBid?: number;
  /** YES best ask (from snapshot, if available) */
  yesAsk?: number;
  /** NO best bid (from snapshot, if available) */
  noBid?: number;
  /** NO best ask (from snapshot, if available) */
  noAsk?: number;
  /** Actual spread (ask - bid) for YES */
  yesSpread?: number;
  /** Actual spread (ask - bid) for NO */
  noSpread?: number;
}

/**
 * Processed snapshot data for backtest pricing
 */
export interface SnapshotPrice {
  /** Timestamp (Unix ms) */
  timestamp: number;
  /** YES best bid */
  yesBid: number;
  /** YES best ask */
  yesAsk: number;
  /** NO best bid */
  noBid: number;
  /** NO best ask */
  noAsk: number;
  /** YES spread (ask - bid) */
  yesSpread: number;
  /** NO spread (ask - bid) */
  noSpread: number;
  /** Spread-weighted consensus price */
  consensusPrice: number;
  /** Session ID */
  sessionId: string;
}

/**
 * Position state during simulation
 */
export interface SimulatedPosition {
  /** YES shares held */
  yesShares: number;
  /** NO shares held */
  noShares: number;
  /** Average entry price for YES */
  yesAvgEntry: number;
  /** Average entry price for NO */
  noAvgEntry: number;
  /** Net position (yesShares - noShares) */
  netPosition: number;
}

// ============================================================================
// Phased Optimization Types
// ============================================================================

/**
 * Composite metric for multi-objective optimization
 */
export interface CompositeMetric {
  /** Weight for Sharpe ratio (default: 0.6) */
  sharpeWeight: number;
  /** Weight for win rate (default: 0.3) */
  winRateWeight: number;
  /** Weight for profit factor (default: 0.1) */
  profitFactorWeight: number;
}

/**
 * Constraint function for parameter combinations
 * Returns true if the combination is valid
 */
export type ParameterConstraint = (params: Record<string, number>) => boolean;

/**
 * Algorithm type for parameter optimization
 */
export type OptimizationAlgorithm = 'exhaustive' | 'multi-stage';

/**
 * Configuration for a single optimization phase
 */
export interface PhaseConfig {
  /** Phase number (1-9) */
  phase: number;
  /** Phase name for display */
  name: string;
  /** Brief description of what this phase optimizes */
  description: string;
  /** Parameters to optimize in this phase */
  parameterRanges: ParameterRange[];
  /** Metric to optimize (default: sharpeRatio) */
  optimizeMetric: OptimizationMetric | 'composite';
  /** Composite metric config (required if optimizeMetric is 'composite') */
  compositeMetric?: CompositeMetric;
  /** Constraints to filter valid parameter combinations */
  constraints?: ParameterConstraint[];
  /** Number of top results to carry forward */
  topN: number;
  /** Early stopping threshold (stop if top N results have Sharpe within this range) */
  earlyStopThreshold?: number;
  /** Skip phase if all results have negative Sharpe */
  skipIfNegative?: boolean;
  /** Algorithm for optimization (default: 'exhaustive') */
  algorithm?: OptimizationAlgorithm;
  /** Maximum combinations to test (for 'multi-stage' algorithm) */
  maxCombinations?: number;
}

/**
 * Result for a single parameter combination within a phase
 */
export interface PhaseResult {
  /** Parameters tested */
  params: Record<string, number>;
  /** All metrics for this combination */
  metrics: {
    totalPnl: number;
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    tradeCount: number;
    profitFactor: number;
  };
  /** Composite score (if using composite metric) */
  compositeScore?: number;
}

/**
 * Summary of a completed phase
 */
export interface PhaseSummary {
  /** Phase number */
  phase: number;
  /** Phase name */
  name: string;
  /** Number of combinations tested */
  combinationsTested: number;
  /** Top results from this phase */
  topResults: PhaseResult[];
  /** Best parameters to carry forward */
  bestParams: Record<string, number>;
  /** Duration of this phase in seconds */
  durationSeconds: number;
  /** Whether phase was skipped due to early stopping or negative results */
  skipped: boolean;
  /** Skip reason if skipped */
  skipReason?: string;
}

/**
 * Configuration for full phased optimization run
 */
export interface PhasedOptimizationConfig {
  /** Recording session IDs to use */
  sessionIds: string[];
  /** Strategy to optimize */
  strategySlug: string;
  /** Base parameters (non-optimized values) */
  baseParams: Record<string, unknown>;
  /** Phase configurations */
  phases: PhaseConfig[];
  /** Starting capital */
  initialCapital: number;
  /** Maximum parameter combinations per phase */
  maxCombinationsPerPhase?: number;
}

/**
 * Stage type for multi-stage Phase 9 optimization
 */
export type Phase9Stage = 'baseline' | 'sensitivity' | 'pairs' | 'random';

/**
 * Sensitivity result for a single parameter
 */
export interface SensitivityResult {
  /** Parameter name */
  param: string;
  /** Current best value for this parameter */
  bestValue: number;
  /** Alternative values tested with their delta from baseline */
  alternatives: { value: number; delta: number }[];
  /** Sensitivity score - max improvement potential (higher = more sensitive) */
  sensitivity: number;
  /** Whether any alternative improved over baseline */
  hasImprovement: boolean;
}

/**
 * Progress update for phased optimization
 */
export interface PhasedOptimizationProgress {
  /** Current phase number */
  currentPhase: number;
  /** Total phases */
  totalPhases: number;
  /** Phase name */
  phaseName: string;
  /** Current combination within phase */
  currentCombination: number;
  /** Total combinations in this phase */
  totalCombinations: number;
  /** Overall percent complete */
  overallPercent: number;
  /** Phase percent complete */
  phasePercent: number;
  /** Current best in this phase */
  currentBest?: {
    params: Record<string, number>;
    metric: number;
    metricName: string;
  };
  /** Status */
  status: 'running' | 'completed' | 'error' | 'phase_complete';
  /** Completed phases */
  completedPhases: PhaseSummary[];
  /** Estimated time remaining in seconds */
  estimatedTimeRemaining?: number;
  /** Error message (if status is 'error') */
  errorMessage?: string;
  /** Current stage for multi-stage optimization (Phase 9) */
  stage?: Phase9Stage;
  /** Stage progress (0-100%) within current stage */
  stageProgress?: number;
  /** Stage description for display */
  stageDescription?: string;
}

/**
 * Complete result of phased optimization
 */
export interface PhasedOptimizationResult {
  /** Run ID */
  runId: string;
  /** Configuration used */
  config: PhasedOptimizationConfig;
  /** Results for each phase */
  phaseSummaries: PhaseSummary[];
  /** Final optimized parameters (merged from all phases) */
  finalParams: Record<string, number>;
  /** Final metrics with optimized parameters */
  finalMetrics: {
    totalPnl: number;
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    tradeCount: number;
    profitFactor: number;
  };
  /** Total combinations tested across all phases */
  totalCombinationsTested: number;
  /** Total duration in seconds */
  totalDurationSeconds: number;
}

// ============================================================================
// Database Row Types for Optimization Runs
// ============================================================================

/**
 * Database row for optimization_runs table
 */
export interface OptimizationRunRow {
  id: string;
  created_at: string;
  strategy_slug: string;
  session_ids: string; // JSON array
  optimization_type: 'grid' | 'phased';
  phases_config: string; // JSON PhaseConfig[]
  initial_capital: number;
  total_combinations_tested: number;
  duration_seconds: number;
  final_params: string; // JSON
  final_sharpe: number;
  final_pnl: number;
  final_win_rate: number;
  results: string; // Full result JSON
}

/**
 * Database row for phase_results table
 */
export interface PhaseResultRow {
  id: string;
  optimization_run_id: string;
  phase_number: number;
  phase_name: string;
  combinations_tested: number;
  duration_seconds: number;
  best_params: string; // JSON
  best_sharpe: number;
  best_pnl: number;
  skipped: number; // SQLite boolean
  skip_reason: string | null;
  top_results: string; // JSON PhaseResult[]
}
