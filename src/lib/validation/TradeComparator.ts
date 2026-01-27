/**
 * Trade Comparator
 *
 * Compares dry-run trades with backtest trades to validate consistency.
 * Uses time-window matching to align trades and calculate discrepancy metrics.
 */

import type { Trade } from '../bots/types';
import type { BacktestTrade, BacktestResult } from '../backtest/types';
import type { RecordingSessionRow } from '../persistence/DataRepository';
import {
  type AlignedTradePair,
  type MatchType,
  type DiscrepancySource,
  type DiscrepancySummary,
  type SessionComparisonReport,
  type AggregateComparisonReport,
  type ComparisonConfig,
  type SessionWithDryRunData,
  DEFAULT_COMPARISON_CONFIG,
} from './types';
import { extractDryRunDataForDate, extractDryRunDataForSession } from './DryRunExtractor';
import { getBacktestResultById } from '../persistence/BacktestRepository';

// ============================================================================
// Trade Alignment
// ============================================================================

/**
 * Convert dry-run Trade to a common format for comparison
 */
function normalizeDryRunTrade(trade: Trade): {
  timestamp: number;
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO';
  price: number;
  quantity: number;
  pnl: number;
  id: string;
} {
  return {
    timestamp: trade.executedAt.getTime(),
    side: trade.side,
    outcome: trade.outcome,
    price: parseFloat(trade.price),
    quantity: parseFloat(trade.quantity),
    pnl: parseFloat(trade.pnl),
    id: trade.id,
  };
}

/**
 * Convert backtest trade to a common format for comparison
 */
function normalizeBacktestTrade(trade: BacktestTrade): {
  timestamp: number;
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO';
  price: number;
  quantity: number;
  pnl: number;
  id: string;
} {
  return {
    timestamp: new Date(trade.timestamp).getTime(),
    side: trade.side,
    outcome: trade.outcome,
    price: trade.price,
    quantity: trade.quantity,
    pnl: trade.pnl,
    id: trade.id,
  };
}

/**
 * Align dry-run trades with backtest trades using time-window matching
 *
 * Algorithm:
 * 1. Sort both lists by timestamp
 * 2. For each dry-run trade, find closest backtest trade within time window
 * 3. Match by (side, outcome) first, then by time proximity
 * 4. Mark unmatched trades from both sides
 */
export function alignTrades(
  dryRunTrades: Trade[],
  backtestTrades: BacktestTrade[],
  config: ComparisonConfig = DEFAULT_COMPARISON_CONFIG
): AlignedTradePair[] {
  const pairs: AlignedTradePair[] = [];
  let pairIndex = 0;

  // Normalize and sort
  const normalizedDry = dryRunTrades
    .map(normalizeDryRunTrade)
    .sort((a, b) => a.timestamp - b.timestamp);

  const normalizedBt = backtestTrades
    .map(normalizeBacktestTrade)
    .sort((a, b) => a.timestamp - b.timestamp);

  // Track which backtest trades have been matched
  const matchedBtIndices = new Set<number>();

  // Match dry-run trades to backtest trades
  for (const dryTrade of normalizedDry) {
    let bestMatch: { btIndex: number; timeDelta: number; priceDelta: number } | null = null;

    for (let i = 0; i < normalizedBt.length; i++) {
      if (matchedBtIndices.has(i)) continue;

      const btTrade = normalizedBt[i];
      const timeDelta = Math.abs(dryTrade.timestamp - btTrade.timestamp);

      // Skip if outside time window
      if (timeDelta > config.timeWindowMs) continue;

      // Must match side and outcome
      if (dryTrade.side !== btTrade.side || dryTrade.outcome !== btTrade.outcome) continue;

      const priceDelta = Math.abs(dryTrade.price - btTrade.price) / dryTrade.price * 100;

      // Check if this is a better match
      if (!bestMatch || timeDelta < bestMatch.timeDelta) {
        bestMatch = { btIndex: i, timeDelta, priceDelta };
      }
    }

    if (bestMatch) {
      matchedBtIndices.add(bestMatch.btIndex);
      const btTrade = normalizedBt[bestMatch.btIndex];
      const originalBtTrade = backtestTrades.find(t => t.id === btTrade.id)!;
      const originalDryTrade = dryRunTrades.find(t => t.id === dryTrade.id)!;

      // Determine match type
      let matchType: MatchType;
      if (bestMatch.timeDelta <= config.exactTimeThresholdMs &&
          bestMatch.priceDelta <= config.exactPriceThresholdPercent) {
        matchType = 'EXACT';
      } else if (bestMatch.timeDelta <= config.closeTimeThresholdMs &&
                 bestMatch.priceDelta <= config.closePriceThresholdPercent) {
        matchType = 'CLOSE';
      } else {
        matchType = 'CLOSE'; // Still considered a match, just not exact
      }

      pairs.push({
        dryRunTrade: originalDryTrade,
        backtestTrade: originalBtTrade,
        timeDeltaMs: bestMatch.timeDelta,
        priceDeltaPercent: bestMatch.priceDelta,
        matchType,
        pairIndex: pairIndex++,
      });
    } else {
      // Unmatched dry-run trade
      const originalDryTrade = dryRunTrades.find(t => t.id === dryTrade.id)!;
      pairs.push({
        dryRunTrade: originalDryTrade,
        backtestTrade: null,
        timeDeltaMs: null,
        priceDeltaPercent: null,
        matchType: 'UNMATCHED_DRY',
        pairIndex: pairIndex++,
      });
    }
  }

  // Add unmatched backtest trades
  for (let i = 0; i < normalizedBt.length; i++) {
    if (!matchedBtIndices.has(i)) {
      const btTrade = normalizedBt[i];
      const originalBtTrade = backtestTrades.find(t => t.id === btTrade.id)!;
      pairs.push({
        dryRunTrade: null,
        backtestTrade: originalBtTrade,
        timeDeltaMs: null,
        priceDeltaPercent: null,
        matchType: 'UNMATCHED_BT',
        pairIndex: pairIndex++,
      });
    }
  }

  // Sort by time (matched pairs by dry-run time, unmatched by their own time)
  pairs.sort((a, b) => {
    const timeA = a.dryRunTrade?.executedAt.getTime() ||
                  (a.backtestTrade ? new Date(a.backtestTrade.timestamp).getTime() : 0);
    const timeB = b.dryRunTrade?.executedAt.getTime() ||
                  (b.backtestTrade ? new Date(b.backtestTrade.timestamp).getTime() : 0);
    return timeA - timeB;
  });

  // Re-index after sorting
  pairs.forEach((p, i) => p.pairIndex = i);

  return pairs;
}

// ============================================================================
// Metrics Calculation
// ============================================================================

/**
 * Calculate comparison metrics from aligned trade pairs
 */
export function calculateMetrics(pairs: AlignedTradePair[]): {
  matchedCount: number;
  unmatchedDryCount: number;
  unmatchedBtCount: number;
  matchRate: number;
  avgTimeDeltaMs: number;
  maxTimeDeltaMs: number;
  avgPriceDeltaPercent: number;
  maxPriceDeltaPercent: number;
  dryRunPnl: number;
  backtestPnl: number;
  pnlDeltaPercent: number;
} {
  const matched = pairs.filter(p => p.matchType === 'EXACT' || p.matchType === 'CLOSE');
  const unmatchedDry = pairs.filter(p => p.matchType === 'UNMATCHED_DRY');
  const unmatchedBt = pairs.filter(p => p.matchType === 'UNMATCHED_BT');

  // Time deltas
  const timeDeltas = matched
    .filter(p => p.timeDeltaMs !== null)
    .map(p => p.timeDeltaMs!);

  const avgTimeDeltaMs = timeDeltas.length > 0
    ? timeDeltas.reduce((a, b) => a + b, 0) / timeDeltas.length
    : 0;

  const maxTimeDeltaMs = timeDeltas.length > 0 ? Math.max(...timeDeltas) : 0;

  // Price deltas
  const priceDeltas = matched
    .filter(p => p.priceDeltaPercent !== null)
    .map(p => p.priceDeltaPercent!);

  const avgPriceDeltaPercent = priceDeltas.length > 0
    ? priceDeltas.reduce((a, b) => a + b, 0) / priceDeltas.length
    : 0;

  const maxPriceDeltaPercent = priceDeltas.length > 0 ? Math.max(...priceDeltas) : 0;

  // PnL calculations
  const dryRunPnl = pairs
    .filter(p => p.dryRunTrade !== null)
    .reduce((sum, p) => sum + parseFloat(p.dryRunTrade!.pnl), 0);

  const backtestPnl = pairs
    .filter(p => p.backtestTrade !== null)
    .reduce((sum, p) => sum + p.backtestTrade!.pnl, 0);

  const pnlDeltaPercent = backtestPnl !== 0
    ? Math.abs(dryRunPnl - backtestPnl) / Math.abs(backtestPnl) * 100
    : (dryRunPnl !== 0 ? 100 : 0);

  // Match rate
  const totalDry = matched.length + unmatchedDry.length;
  const matchRate = totalDry > 0 ? (matched.length / totalDry) * 100 : 0;

  return {
    matchedCount: matched.length,
    unmatchedDryCount: unmatchedDry.length,
    unmatchedBtCount: unmatchedBt.length,
    matchRate,
    avgTimeDeltaMs,
    maxTimeDeltaMs,
    avgPriceDeltaPercent,
    maxPriceDeltaPercent,
    dryRunPnl,
    backtestPnl,
    pnlDeltaPercent,
  };
}

// ============================================================================
// Discrepancy Analysis
// ============================================================================

/**
 * Analyze discrepancies and categorize root causes
 */
export function analyzeDiscrepancies(pairs: AlignedTradePair[]): DiscrepancySummary[] {
  const discrepancies: Map<DiscrepancySource, DiscrepancySummary> = new Map();

  // Helper to add or update discrepancy
  const addDiscrepancy = (
    source: DiscrepancySource,
    description: string,
    magnitude: number,
    pair: AlignedTradePair
  ) => {
    const existing = discrepancies.get(source);
    if (existing) {
      existing.count++;
      existing.avgMagnitude = (existing.avgMagnitude * (existing.count - 1) + magnitude) / existing.count;
      if (existing.examples.length < 3) {
        existing.examples.push(pair);
      }
    } else {
      discrepancies.set(source, {
        source,
        description,
        count: 1,
        avgMagnitude: magnitude,
        examples: [pair],
      });
    }
  };

  for (const pair of pairs) {
    // Analyze unmatched dry-run trades
    if (pair.matchType === 'UNMATCHED_DRY' && pair.dryRunTrade) {
      // Could be due to order model differences - dry-run uses limit orders
      addDiscrepancy(
        'ORDER_MODEL_DIFF',
        'Dry-run trade has no backtest match (limit order filled without corresponding backtest signal)',
        0,
        pair
      );
    }

    // Analyze unmatched backtest trades
    if (pair.matchType === 'UNMATCHED_BT' && pair.backtestTrade) {
      // Could be timing/state difference
      addDiscrepancy(
        'FILL_TIMING_DIFF',
        'Backtest trade has no dry-run match (immediate execution in backtest, pending/unfilled in dry-run)',
        0,
        pair
      );
    }

    // Analyze matched pairs with significant price differences
    if ((pair.matchType === 'EXACT' || pair.matchType === 'CLOSE') &&
        pair.priceDeltaPercent !== null &&
        pair.priceDeltaPercent > 0.5) {
      addDiscrepancy(
        'PRICE_SOURCE_DIFF',
        'Significant price difference between dry-run and backtest (VWAP vs bid/ask weighted)',
        pair.priceDeltaPercent,
        pair
      );
    }

    // Analyze matched pairs with significant time differences
    if ((pair.matchType === 'EXACT' || pair.matchType === 'CLOSE') &&
        pair.timeDeltaMs !== null &&
        pair.timeDeltaMs > 2000) {
      addDiscrepancy(
        'FILL_TIMING_DIFF',
        'Significant timing difference between dry-run and backtest execution',
        pair.timeDeltaMs,
        pair
      );
    }

    // Check for spread impact on matched pairs
    if ((pair.matchType === 'EXACT' || pair.matchType === 'CLOSE') &&
        pair.dryRunTrade &&
        pair.backtestTrade) {
      const dryPrice = parseFloat(pair.dryRunTrade.price);
      const btPrice = pair.backtestTrade.price;
      const side = pair.dryRunTrade.side;

      // BUY at higher price in dry-run (paid spread)
      // SELL at lower price in dry-run (paid spread)
      if ((side === 'BUY' && dryPrice > btPrice * 1.005) ||
          (side === 'SELL' && dryPrice < btPrice * 0.995)) {
        addDiscrepancy(
          'SPREAD_IMPACT',
          'Dry-run price reflects spread crossing, backtest uses mid-price',
          Math.abs(dryPrice - btPrice) / btPrice * 100,
          pair
        );
      }
    }
  }

  return Array.from(discrepancies.values()).sort((a, b) => b.count - a.count);
}

// ============================================================================
// Session Comparison
// ============================================================================

/**
 * Compare a single session's dry-run trades with backtest trades
 */
export function compareSession(
  session: RecordingSessionRow,
  dryRunTrades: Trade[],
  backtestTrades: BacktestTrade[],
  config: ComparisonConfig = DEFAULT_COMPARISON_CONFIG,
  botId?: string,
  botName?: string,
  backtestRunId?: string
): SessionComparisonReport {
  const pairs = alignTrades(dryRunTrades, backtestTrades, config);
  const metrics = calculateMetrics(pairs);
  const discrepancies = analyzeDiscrepancies(pairs);

  return {
    sessionId: session.id,
    marketName: session.market_name,
    marketId: session.market_id,
    startTime: session.start_time,
    endTime: session.end_time,

    dryRunTradeCount: dryRunTrades.length,
    backtestTradeCount: backtestTrades.length,
    matchedTradeCount: metrics.matchedCount,
    matchRate: metrics.matchRate,

    dryRunPnl: metrics.dryRunPnl,
    backtestPnl: metrics.backtestPnl,
    pnlDeltaPercent: metrics.pnlDeltaPercent,

    avgTimeDeltaMs: metrics.avgTimeDeltaMs,
    maxTimeDeltaMs: metrics.maxTimeDeltaMs,
    avgPriceDeltaPercent: metrics.avgPriceDeltaPercent,
    maxPriceDeltaPercent: metrics.maxPriceDeltaPercent,

    tradePairs: pairs,
    discrepancies,

    botId,
    botName,
    backtestRunId,
  };
}

/**
 * Compare dry-run data with a backtest result
 */
export function compareWithBacktestResult(
  dryRunData: SessionWithDryRunData,
  backtestResult: BacktestResult,
  config: ComparisonConfig = DEFAULT_COMPARISON_CONFIG
): SessionComparisonReport {
  // Find backtest trades for this session
  const sessionBacktestTrades = backtestResult.trades.filter(
    t => t.sessionId === dryRunData.session.id
  );

  return compareSession(
    dryRunData.session,
    dryRunData.trades,
    sessionBacktestTrades,
    config,
    dryRunData.bot?.id,
    dryRunData.bot?.name,
    backtestResult.runId
  );
}

// ============================================================================
// Aggregate Comparison
// ============================================================================

/**
 * Compare all sessions for a date against backtest results
 */
export function compareAllSessionsForDate(
  date: string,
  backtestRunId: string,
  config: ComparisonConfig = DEFAULT_COMPARISON_CONFIG
): AggregateComparisonReport {
  // Get backtest result
  const backtestResult = getBacktestResultById(backtestRunId);
  if (!backtestResult) {
    throw new Error(`Backtest run ${backtestRunId} not found`);
  }

  // Get dry-run data for all sessions
  const dryRunData = extractDryRunDataForDate(date);

  // Compare each session
  const sessionReports: SessionComparisonReport[] = [];
  const allPairs: AlignedTradePair[] = [];

  for (const data of dryRunData) {
    // Find backtest trades for this session
    const sessionBacktestTrades = backtestResult.trades.filter(
      t => t.sessionId === data.session.id
    );

    // Skip if no backtest trades for this session
    if (sessionBacktestTrades.length === 0 && data.trades.length === 0) {
      continue;
    }

    const report = compareSession(
      data.session,
      data.trades,
      sessionBacktestTrades,
      config,
      data.bot?.id,
      data.bot?.name,
      backtestRunId
    );

    sessionReports.push(report);
    allPairs.push(...report.tradePairs);
  }

  // Calculate aggregate metrics
  const totalDryRunTrades = sessionReports.reduce((sum, r) => sum + r.dryRunTradeCount, 0);
  const totalBacktestTrades = sessionReports.reduce((sum, r) => sum + r.backtestTradeCount, 0);
  const totalMatchedTrades = sessionReports.reduce((sum, r) => sum + r.matchedTradeCount, 0);
  const totalDryRunPnl = sessionReports.reduce((sum, r) => sum + r.dryRunPnl, 0);
  const totalBacktestPnl = sessionReports.reduce((sum, r) => sum + r.backtestPnl, 0);

  const overallMatchRate = totalDryRunTrades > 0
    ? (totalMatchedTrades / totalDryRunTrades) * 100
    : 0;

  const overallPnlDeltaPercent = totalBacktestPnl !== 0
    ? Math.abs(totalDryRunPnl - totalBacktestPnl) / Math.abs(totalBacktestPnl) * 100
    : (totalDryRunPnl !== 0 ? 100 : 0);

  // Calculate overall timing/price averages
  const matchedReports = sessionReports.filter(r => r.matchedTradeCount > 0);
  const overallAvgTimeDeltaMs = matchedReports.length > 0
    ? matchedReports.reduce((sum, r) => sum + r.avgTimeDeltaMs * r.matchedTradeCount, 0) /
      matchedReports.reduce((sum, r) => sum + r.matchedTradeCount, 0)
    : 0;

  const overallAvgPriceDeltaPercent = matchedReports.length > 0
    ? matchedReports.reduce((sum, r) => sum + r.avgPriceDeltaPercent * r.matchedTradeCount, 0) /
      matchedReports.reduce((sum, r) => sum + r.matchedTradeCount, 0)
    : 0;

  // Aggregate discrepancies
  const aggregatedDiscrepancies = analyzeDiscrepancies(allPairs);

  // Validate against thresholds
  const failureReasons: string[] = [];

  const tradeCountDelta = totalBacktestTrades !== 0
    ? Math.abs(totalDryRunTrades - totalBacktestTrades) / totalBacktestTrades * 100
    : 0;

  if (tradeCountDelta > config.maxTradeCountDeltaPercent) {
    failureReasons.push(`Trade count delta ${tradeCountDelta.toFixed(1)}% exceeds ${config.maxTradeCountDeltaPercent}% threshold`);
  }

  if (overallMatchRate < config.minDirectionAlignmentRate) {
    failureReasons.push(`Match rate ${overallMatchRate.toFixed(1)}% below ${config.minDirectionAlignmentRate}% threshold`);
  }

  if (overallPnlDeltaPercent > config.maxPnlDeltaPercent) {
    failureReasons.push(`PnL delta ${overallPnlDeltaPercent.toFixed(1)}% exceeds ${config.maxPnlDeltaPercent}% threshold`);
  }

  if (overallAvgTimeDeltaMs > config.maxAvgTimeDeltaMs) {
    failureReasons.push(`Avg time delta ${overallAvgTimeDeltaMs.toFixed(0)}ms exceeds ${config.maxAvgTimeDeltaMs}ms threshold`);
  }

  return {
    comparisonDate: date,
    sessionCount: dryRunData.length,
    sessionsWithBots: dryRunData.filter(d => d.bot !== null).length,

    totalDryRunTrades,
    totalBacktestTrades,
    totalMatchedTrades,
    overallMatchRate,

    totalDryRunPnl,
    totalBacktestPnl,
    overallPnlDeltaPercent,

    overallAvgTimeDeltaMs,
    overallAvgPriceDeltaPercent,

    passed: failureReasons.length === 0,
    failureReasons,

    sessionReports,
    aggregatedDiscrepancies,
  };
}

/**
 * Compare a single session with its backtest result
 */
export function compareSingleSession(
  sessionId: string,
  backtestRunId: string,
  config: ComparisonConfig = DEFAULT_COMPARISON_CONFIG
): SessionComparisonReport | null {
  const backtestResult = getBacktestResultById(backtestRunId);
  if (!backtestResult) {
    throw new Error(`Backtest run ${backtestRunId} not found`);
  }

  const dryRunData = extractDryRunDataForSession(sessionId);
  if (!dryRunData) {
    return null;
  }

  return compareWithBacktestResult(dryRunData, backtestResult, config);
}
