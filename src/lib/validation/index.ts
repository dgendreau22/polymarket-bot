/**
 * Trade Validation Module
 *
 * Exports for comparing dry-run trades with backtest results to validate
 * strategy behavior consistency.
 */

// Types
export type {
  MatchType,
  DiscrepancySource,
  AlignedTradePair,
  DiscrepancySummary,
  SessionComparisonReport,
  AggregateComparisonReport,
  ComparisonConfig,
  SessionWithDryRunData,
  SessionWithBacktestData,
} from './types';

export { DEFAULT_COMPARISON_CONFIG } from './types';

// Dry-Run Extractor
export {
  getSessionsForDate,
  getAllSessions,
  findBotForSession,
  findPotentialBotsForSession,
  getTradesForSession,
  getAllTradesForBot,
  getStrategyConfig,
  extractDryRunDataForDate,
  extractDryRunDataForSession,
  getTradeCountsByMarket,
  getDryRunSummaryForDate,
} from './DryRunExtractor';

// Trade Comparator
export {
  alignTrades,
  calculateMetrics,
  analyzeDiscrepancies,
  compareSession,
  compareWithBacktestResult,
  compareAllSessionsForDate,
  compareSingleSession,
} from './TradeComparator';
