/**
 * PnL Calculator
 *
 * Calculates comprehensive metrics from backtest trades including:
 * - Total PnL and return
 * - Sharpe ratio (annualized)
 * - Maximum drawdown
 * - Win rate
 * - Profit factor
 */

import type { BacktestTrade, BalanceSnapshot } from './types';

/**
 * Calculate all PnL metrics from trades and balance history
 */
export interface PnLMetrics {
  totalPnl: number;
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  tradeCount: number;
  avgTradePnl: number;
  maxWin: number;
  maxLoss: number;
  profitFactor: number;
}

/**
 * Calculate all metrics from backtest results
 */
export function calculateMetrics(
  trades: BacktestTrade[],
  balanceHistory: BalanceSnapshot[],
  initialCapital: number,
  finalBalance: number
): PnLMetrics {
  const tradePnls = trades
    .filter((t) => t.side === 'SELL' && t.pnl !== 0)
    .map((t) => t.pnl);

  const totalPnl = finalBalance - initialCapital;
  const totalReturn = initialCapital > 0 ? (totalPnl / initialCapital) * 100 : 0;

  return {
    totalPnl,
    totalReturn,
    sharpeRatio: calculateSharpeRatio(balanceHistory),
    maxDrawdown: calculateMaxDrawdown(balanceHistory),
    winRate: calculateWinRate(tradePnls),
    tradeCount: trades.length,
    avgTradePnl: tradePnls.length > 0 ? tradePnls.reduce((a, b) => a + b, 0) / tradePnls.length : 0,
    maxWin: tradePnls.length > 0 ? Math.max(0, ...tradePnls) : 0,
    maxLoss: tradePnls.length > 0 ? Math.min(0, ...tradePnls) : 0,
    profitFactor: calculateProfitFactor(tradePnls),
  };
}

/**
 * Calculate Sharpe ratio (annualized)
 *
 * Uses the balance history to compute returns, then calculates:
 * Sharpe = (mean return - risk free rate) / std dev of returns
 *
 * Assumes risk-free rate of 0 for simplicity.
 * Annualization factor assumes 252 trading days equivalent.
 */
export function calculateSharpeRatio(balanceHistory: BalanceSnapshot[]): number {
  if (balanceHistory.length < 2) return 0;

  // Calculate returns between each balance snapshot
  const returns: number[] = [];
  for (let i = 1; i < balanceHistory.length; i++) {
    const prevEquity = balanceHistory[i - 1].equity;
    const currEquity = balanceHistory[i].equity;
    if (prevEquity > 0) {
      returns.push((currEquity - prevEquity) / prevEquity);
    }
  }

  if (returns.length < 2) return 0;

  // Calculate mean and standard deviation
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const squaredDiffs = returns.map((r) => Math.pow(r - meanReturn, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  // Calculate time-based annualization factor
  // Estimate periods per year based on snapshot frequency
  const firstTimestamp = balanceHistory[0].timestamp;
  const lastTimestamp = balanceHistory[balanceHistory.length - 1].timestamp;
  const durationMs = lastTimestamp - firstTimestamp;
  const durationYears = durationMs / (365.25 * 24 * 60 * 60 * 1000);

  if (durationYears === 0) return 0;

  const periodsPerYear = returns.length / durationYears;
  const annualizationFactor = Math.sqrt(periodsPerYear);

  // Sharpe = annualized excess return / annualized volatility
  return (meanReturn * annualizationFactor) / (stdDev * annualizationFactor);
}

/**
 * Calculate maximum drawdown percentage
 *
 * Maximum drawdown is the largest peak-to-trough decline in equity.
 */
export function calculateMaxDrawdown(balanceHistory: BalanceSnapshot[]): number {
  if (balanceHistory.length < 2) return 0;

  let maxEquity = balanceHistory[0].equity;
  let maxDrawdown = 0;

  for (const snapshot of balanceHistory) {
    if (snapshot.equity > maxEquity) {
      maxEquity = snapshot.equity;
    }
    const drawdown = maxEquity > 0 ? (maxEquity - snapshot.equity) / maxEquity : 0;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return maxDrawdown * 100; // Return as percentage
}

/**
 * Calculate win rate (percentage of profitable trades)
 */
export function calculateWinRate(tradePnls: number[]): number {
  if (tradePnls.length === 0) return 0;

  const winners = tradePnls.filter((pnl) => pnl > 0).length;
  return (winners / tradePnls.length) * 100;
}

/**
 * Calculate profit factor (gross profit / gross loss)
 *
 * A profit factor > 1 means the strategy is profitable.
 */
export function calculateProfitFactor(tradePnls: number[]): number {
  const grossProfit = tradePnls
    .filter((pnl) => pnl > 0)
    .reduce((sum, pnl) => sum + pnl, 0);
  const grossLoss = Math.abs(
    tradePnls.filter((pnl) => pnl < 0).reduce((sum, pnl) => sum + pnl, 0)
  );

  if (grossLoss === 0) {
    return grossProfit > 0 ? Infinity : 0;
  }

  return grossProfit / grossLoss;
}

/**
 * Calculate per-session metrics
 */
export interface SessionMetrics {
  sessionId: string;
  pnl: number;
  tradeCount: number;
  winRate: number;
}

export function calculateSessionMetrics(
  trades: BacktestTrade[],
  sessionId: string
): SessionMetrics {
  const sessionTrades = trades.filter((t) => t.sessionId === sessionId);
  const pnls = sessionTrades.filter((t) => t.side === 'SELL').map((t) => t.pnl);
  const totalPnl = pnls.reduce((sum, pnl) => sum + pnl, 0);

  return {
    sessionId,
    pnl: totalPnl,
    tradeCount: sessionTrades.length,
    winRate: calculateWinRate(pnls),
  };
}

/**
 * Calculate rolling Sharpe ratio over a window
 */
export function calculateRollingSharpe(
  balanceHistory: BalanceSnapshot[],
  windowSize: number
): number[] {
  const result: number[] = [];

  for (let i = windowSize; i <= balanceHistory.length; i++) {
    const window = balanceHistory.slice(i - windowSize, i);
    result.push(calculateSharpeRatio(window));
  }

  return result;
}

/**
 * Calculate equity curve statistics
 */
export interface EquityCurveStats {
  peakEquity: number;
  peakTimestamp: number;
  troughEquity: number;
  troughTimestamp: number;
  recoveryTimestamp: number | null;
  longestDrawdownDurationMs: number;
}

export function calculateEquityCurveStats(
  balanceHistory: BalanceSnapshot[]
): EquityCurveStats {
  if (balanceHistory.length === 0) {
    return {
      peakEquity: 0,
      peakTimestamp: 0,
      troughEquity: 0,
      troughTimestamp: 0,
      recoveryTimestamp: null,
      longestDrawdownDurationMs: 0,
    };
  }

  let peakEquity = balanceHistory[0].equity;
  let peakTimestamp = balanceHistory[0].timestamp;
  let troughEquity = balanceHistory[0].equity;
  let troughTimestamp = balanceHistory[0].timestamp;

  let currentDrawdownStart: number | null = null;
  let longestDrawdownDurationMs = 0;
  let recoveryTimestamp: number | null = null;

  for (const snapshot of balanceHistory) {
    if (snapshot.equity > peakEquity) {
      // New peak - record potential recovery
      if (currentDrawdownStart !== null) {
        const drawdownDuration = snapshot.timestamp - currentDrawdownStart;
        if (drawdownDuration > longestDrawdownDurationMs) {
          longestDrawdownDurationMs = drawdownDuration;
          recoveryTimestamp = snapshot.timestamp;
        }
        currentDrawdownStart = null;
      }
      peakEquity = snapshot.equity;
      peakTimestamp = snapshot.timestamp;
    } else if (snapshot.equity < troughEquity) {
      troughEquity = snapshot.equity;
      troughTimestamp = snapshot.timestamp;
      if (currentDrawdownStart === null) {
        currentDrawdownStart = peakTimestamp;
      }
    }
  }

  // Check if still in drawdown at end
  if (currentDrawdownStart !== null) {
    const lastTimestamp = balanceHistory[balanceHistory.length - 1].timestamp;
    const drawdownDuration = lastTimestamp - currentDrawdownStart;
    if (drawdownDuration > longestDrawdownDurationMs) {
      longestDrawdownDurationMs = drawdownDuration;
    }
  }

  return {
    peakEquity,
    peakTimestamp,
    troughEquity,
    troughTimestamp,
    recoveryTimestamp,
    longestDrawdownDurationMs,
  };
}
