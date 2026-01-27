/**
 * Trade Comparison Validation Types
 *
 * Types for comparing dry-run trades with backtest trades to validate
 * consistency between real-time and historical simulations.
 */

import type { Trade, BotConfig } from '../bots/types';
import type { BacktestTrade, BacktestResult } from '../backtest/types';
import type { RecordingSessionRow } from '../persistence/DataRepository';

// ============================================================================
// Match Types
// ============================================================================

/**
 * Classification of how a trade pair matches
 */
export type MatchType =
  | 'EXACT'           // Same side, outcome, within 2s and 1% price delta
  | 'CLOSE'           // Same side, outcome, within 5s and 3% price delta
  | 'UNMATCHED_DRY'   // Dry-run trade with no backtest match
  | 'UNMATCHED_BT';   // Backtest trade with no dry-run match

/**
 * Root cause categories for discrepancies
 */
export type DiscrepancySource =
  | 'PRICE_SOURCE_DIFF'   // Consensus price calculated differently (VWAP vs bid/ask weighted)
  | 'FILL_TIMING_DIFF'    // Dry-run pending orders fill later than backtest immediate execution
  | 'SPREAD_IMPACT'       // Dry-run uses actual bid/ask, backtest uses VWAP mid-price
  | 'STATE_COLD_START'    // Backtest starts with fresh tau/dbar vs warmed-up dry-run state
  | 'ORDER_MODEL_DIFF'    // Limit order model vs immediate execution
  | 'UNKNOWN';            // Cannot determine root cause

// ============================================================================
// Trade Alignment Types
// ============================================================================

/**
 * A paired comparison between a dry-run trade and backtest trade
 */
export interface AlignedTradePair {
  /** Dry-run trade (null if unmatched backtest) */
  dryRunTrade: Trade | null;
  /** Backtest trade (null if unmatched dry-run) */
  backtestTrade: BacktestTrade | null;
  /** Time difference in milliseconds (null if unmatched) */
  timeDeltaMs: number | null;
  /** Price difference as percentage (null if unmatched) */
  priceDeltaPercent: number | null;
  /** Match classification */
  matchType: MatchType;
  /** Pair sequence number for display */
  pairIndex: number;
}

/**
 * Summary of a specific discrepancy
 */
export interface DiscrepancySummary {
  /** Root cause category */
  source: DiscrepancySource;
  /** Human-readable description */
  description: string;
  /** Number of occurrences */
  count: number;
  /** Average magnitude (time delta or price delta) */
  avgMagnitude: number;
  /** Example trade pairs exhibiting this discrepancy */
  examples: AlignedTradePair[];
}

// ============================================================================
// Session Comparison Types
// ============================================================================

/**
 * Complete comparison report for a single recording session
 */
export interface SessionComparisonReport {
  /** Recording session ID */
  sessionId: string;
  /** Market name for display */
  marketName: string;
  /** Market ID */
  marketId: string;
  /** Session start time */
  startTime: string;
  /** Session end time */
  endTime: string;

  // Trade counts
  /** Number of dry-run trades found */
  dryRunTradeCount: number;
  /** Number of backtest trades found */
  backtestTradeCount: number;
  /** Number of successfully matched pairs */
  matchedTradeCount: number;
  /** Match rate as percentage */
  matchRate: number;

  // PnL comparison
  /** Total PnL from dry-run trades */
  dryRunPnl: number;
  /** Total PnL from backtest trades */
  backtestPnl: number;
  /** PnL difference as percentage */
  pnlDeltaPercent: number;

  // Timing metrics
  /** Average time delta in ms for matched pairs */
  avgTimeDeltaMs: number;
  /** Max time delta in ms */
  maxTimeDeltaMs: number;

  // Price metrics
  /** Average price delta percent for matched pairs */
  avgPriceDeltaPercent: number;
  /** Max price delta percent */
  maxPriceDeltaPercent: number;

  /** All aligned trade pairs */
  tradePairs: AlignedTradePair[];
  /** Categorized discrepancies */
  discrepancies: DiscrepancySummary[];

  // Source data references
  /** Bot ID used for dry-run (if found) */
  botId?: string;
  /** Bot name */
  botName?: string;
  /** Backtest run ID used */
  backtestRunId?: string;
}

/**
 * Aggregate report across all sessions
 */
export interface AggregateComparisonReport {
  /** Date of comparison */
  comparisonDate: string;
  /** Total sessions compared */
  sessionCount: number;
  /** Sessions with matching bots found */
  sessionsWithBots: number;

  // Aggregate trade counts
  /** Total dry-run trades */
  totalDryRunTrades: number;
  /** Total backtest trades */
  totalBacktestTrades: number;
  /** Total matched pairs */
  totalMatchedTrades: number;
  /** Overall match rate */
  overallMatchRate: number;

  // Aggregate PnL
  /** Total dry-run PnL */
  totalDryRunPnl: number;
  /** Total backtest PnL */
  totalBacktestPnl: number;
  /** Overall PnL delta percent */
  overallPnlDeltaPercent: number;

  // Aggregate timing
  /** Overall average time delta */
  overallAvgTimeDeltaMs: number;
  /** Overall average price delta */
  overallAvgPriceDeltaPercent: number;

  // Validation status
  /** Whether comparison passes thresholds */
  passed: boolean;
  /** Failure reasons if not passed */
  failureReasons: string[];

  /** Per-session reports */
  sessionReports: SessionComparisonReport[];
  /** Aggregated discrepancies across all sessions */
  aggregatedDiscrepancies: DiscrepancySummary[];
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Comparison configuration/thresholds
 */
export interface ComparisonConfig {
  /** Time window for matching trades (ms) */
  timeWindowMs: number;
  /** Time threshold for EXACT match (ms) */
  exactTimeThresholdMs: number;
  /** Time threshold for CLOSE match (ms) */
  closeTimeThresholdMs: number;
  /** Price threshold for EXACT match (percent) */
  exactPriceThresholdPercent: number;
  /** Price threshold for CLOSE match (percent) */
  closePriceThresholdPercent: number;

  // Validation thresholds
  /** Maximum acceptable trade count delta percent */
  maxTradeCountDeltaPercent: number;
  /** Minimum acceptable direction alignment rate */
  minDirectionAlignmentRate: number;
  /** Maximum acceptable PnL delta percent per session */
  maxPnlDeltaPercent: number;
  /** Maximum acceptable average time delta (ms) */
  maxAvgTimeDeltaMs: number;
}

/**
 * Default comparison configuration
 */
export const DEFAULT_COMPARISON_CONFIG: ComparisonConfig = {
  timeWindowMs: 5000,         // 5 seconds
  exactTimeThresholdMs: 2000, // 2 seconds
  closeTimeThresholdMs: 5000, // 5 seconds
  exactPriceThresholdPercent: 1.0,
  closePriceThresholdPercent: 3.0,

  maxTradeCountDeltaPercent: 10,
  minDirectionAlignmentRate: 85,
  maxPnlDeltaPercent: 25,
  maxAvgTimeDeltaMs: 5000,
};

// ============================================================================
// Data Extraction Types
// ============================================================================

/**
 * Session with associated dry-run data
 */
export interface SessionWithDryRunData {
  session: RecordingSessionRow;
  bot: BotConfig | null;
  trades: Trade[];
  strategyConfig: Record<string, unknown> | null;
}

/**
 * Session with associated backtest data
 */
export interface SessionWithBacktestData {
  sessionId: string;
  backtestRunId: string;
  result: BacktestResult;
  trades: BacktestTrade[];
}
