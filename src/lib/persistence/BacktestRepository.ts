/**
 * Backtest Repository
 *
 * CRUD operations for storing and retrieving backtest run results.
 */

import { getDatabase } from './database';
import type { BacktestRunRow } from '@/lib/backtest/types';
import type { BacktestResult } from '@/lib/backtest/types';

// ============================================================================
// Type Definitions
// ============================================================================

export interface CreateBacktestRunInput {
  id: string;
  strategySlug: string;
  sessionIds: string[];
  strategyParams: Record<string, unknown> | object;
  initialCapital: number;
  totalPnl: number;
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  tradeCount: number;
  results: BacktestResult;
}

export interface BacktestRunSummary {
  id: string;
  createdAt: string;
  strategySlug: string;
  sessionIds: string[];
  initialCapital: number;
  totalPnl: number;
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  tradeCount: number;
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Save a backtest run to the database
 */
export function saveBacktestRun(input: CreateBacktestRunInput): void {
  const db = getDatabase();

  db.prepare(`
    INSERT INTO backtest_runs (
      id, strategy_slug, session_ids, strategy_params,
      initial_capital, total_pnl, total_return, sharpe_ratio,
      max_drawdown, win_rate, trade_count, results
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.strategySlug,
    JSON.stringify(input.sessionIds),
    JSON.stringify(input.strategyParams),
    input.initialCapital,
    input.totalPnl,
    input.totalReturn,
    input.sharpeRatio,
    input.maxDrawdown,
    input.winRate,
    input.tradeCount,
    JSON.stringify(input.results)
  );
}

/**
 * Get a backtest run by ID
 */
export function getBacktestRunById(id: string): BacktestRunRow | null {
  const db = getDatabase();
  return db.prepare('SELECT * FROM backtest_runs WHERE id = ?').get(id) as BacktestRunRow | null;
}

/**
 * Get full backtest result by ID (parses JSON)
 */
export function getBacktestResultById(id: string): BacktestResult | null {
  const row = getBacktestRunById(id);
  if (!row) return null;

  try {
    return JSON.parse(row.results) as BacktestResult;
  } catch {
    return null;
  }
}

/**
 * Get all backtest runs (summaries only)
 */
export function getAllBacktestRuns(limit?: number): BacktestRunSummary[] {
  const db = getDatabase();
  let query = 'SELECT id, created_at, strategy_slug, session_ids, initial_capital, total_pnl, total_return, sharpe_ratio, max_drawdown, win_rate, trade_count FROM backtest_runs ORDER BY created_at DESC';

  if (limit) {
    query += ` LIMIT ${limit}`;
  }

  const rows = db.prepare(query).all() as Array<{
    id: string;
    created_at: string;
    strategy_slug: string;
    session_ids: string;
    initial_capital: number;
    total_pnl: number;
    total_return: number;
    sharpe_ratio: number;
    max_drawdown: number;
    win_rate: number;
    trade_count: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    strategySlug: row.strategy_slug,
    sessionIds: JSON.parse(row.session_ids) as string[],
    initialCapital: row.initial_capital,
    totalPnl: row.total_pnl,
    totalReturn: row.total_return,
    sharpeRatio: row.sharpe_ratio,
    maxDrawdown: row.max_drawdown,
    winRate: row.win_rate,
    tradeCount: row.trade_count,
  }));
}

/**
 * Get backtest runs by strategy
 */
export function getBacktestRunsByStrategy(strategySlug: string, limit?: number): BacktestRunSummary[] {
  const db = getDatabase();
  let query = 'SELECT id, created_at, strategy_slug, session_ids, initial_capital, total_pnl, total_return, sharpe_ratio, max_drawdown, win_rate, trade_count FROM backtest_runs WHERE strategy_slug = ? ORDER BY created_at DESC';

  if (limit) {
    query += ` LIMIT ${limit}`;
  }

  const rows = db.prepare(query).all(strategySlug) as Array<{
    id: string;
    created_at: string;
    strategy_slug: string;
    session_ids: string;
    initial_capital: number;
    total_pnl: number;
    total_return: number;
    sharpe_ratio: number;
    max_drawdown: number;
    win_rate: number;
    trade_count: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    strategySlug: row.strategy_slug,
    sessionIds: JSON.parse(row.session_ids) as string[],
    initialCapital: row.initial_capital,
    totalPnl: row.total_pnl,
    totalReturn: row.total_return,
    sharpeRatio: row.sharpe_ratio,
    maxDrawdown: row.max_drawdown,
    winRate: row.win_rate,
    tradeCount: row.trade_count,
  }));
}

/**
 * Delete a backtest run
 */
export function deleteBacktestRun(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM backtest_runs WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Delete all backtest runs
 */
export function deleteAllBacktestRuns(): number {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM backtest_runs').run();
  return result.changes;
}

/**
 * Get top N backtest runs by a metric
 */
export function getTopBacktestRuns(
  metric: 'total_pnl' | 'total_return' | 'sharpe_ratio' | 'win_rate',
  limit: number = 10,
  ascending: boolean = false
): BacktestRunSummary[] {
  const db = getDatabase();
  const order = ascending ? 'ASC' : 'DESC';
  const query = `
    SELECT id, created_at, strategy_slug, session_ids, initial_capital,
           total_pnl, total_return, sharpe_ratio, max_drawdown, win_rate, trade_count
    FROM backtest_runs
    ORDER BY ${metric} ${order}
    LIMIT ?
  `;

  const rows = db.prepare(query).all(limit) as Array<{
    id: string;
    created_at: string;
    strategy_slug: string;
    session_ids: string;
    initial_capital: number;
    total_pnl: number;
    total_return: number;
    sharpe_ratio: number;
    max_drawdown: number;
    win_rate: number;
    trade_count: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    strategySlug: row.strategy_slug,
    sessionIds: JSON.parse(row.session_ids) as string[],
    initialCapital: row.initial_capital,
    totalPnl: row.total_pnl,
    totalReturn: row.total_return,
    sharpeRatio: row.sharpe_ratio,
    maxDrawdown: row.max_drawdown,
    winRate: row.win_rate,
    tradeCount: row.trade_count,
  }));
}

/**
 * Get count of backtest runs
 */
export function getBacktestRunCount(): number {
  const db = getDatabase();
  const result = db.prepare('SELECT COUNT(*) as count FROM backtest_runs').get() as { count: number };
  return result.count;
}
