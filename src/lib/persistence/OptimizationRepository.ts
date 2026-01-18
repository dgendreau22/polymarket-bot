/**
 * Optimization Repository
 *
 * CRUD operations for storing and retrieving optimization run results.
 */

import { getDatabase } from './database';
import { v4 as uuidv4 } from 'uuid';
import type {
  OptimizationRunRow,
  PhaseResultRow,
  PhasedOptimizationResult,
  PhaseSummary,
} from '@/lib/backtest/types';

// ============================================================================
// Type Definitions
// ============================================================================

export interface CreateOptimizationRunInput {
  id: string;
  strategySlug: string;
  sessionIds: string[];
  optimizationType: 'grid' | 'phased';
  phasesConfig: unknown[];
  initialCapital: number;
  totalCombinationsTested: number;
  durationSeconds: number;
  finalParams: Record<string, number>;
  finalSharpe: number;
  finalPnl: number;
  finalWinRate: number;
  results: PhasedOptimizationResult;
}

export interface OptimizationRunSummary {
  id: string;
  createdAt: string;
  strategySlug: string;
  sessionIds: string[];
  optimizationType: 'grid' | 'phased';
  initialCapital: number;
  totalCombinationsTested: number;
  durationSeconds: number;
  finalSharpe: number;
  finalPnl: number;
  finalWinRate: number;
}

export interface PhaseResultSummary {
  id: string;
  optimizationRunId: string;
  phaseNumber: number;
  phaseName: string;
  combinationsTested: number;
  durationSeconds: number;
  bestParams: Record<string, number>;
  bestSharpe: number;
  bestPnl: number;
  skipped: boolean;
  skipReason: string | null;
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Save an optimization run to the database
 */
export function saveOptimizationRun(input: CreateOptimizationRunInput): void {
  const db = getDatabase();

  db.prepare(`
    INSERT INTO optimization_runs (
      id, strategy_slug, session_ids, optimization_type, phases_config,
      initial_capital, total_combinations_tested, duration_seconds,
      final_params, final_sharpe, final_pnl, final_win_rate, results
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.strategySlug,
    JSON.stringify(input.sessionIds),
    input.optimizationType,
    JSON.stringify(input.phasesConfig),
    input.initialCapital,
    input.totalCombinationsTested,
    input.durationSeconds,
    JSON.stringify(input.finalParams),
    input.finalSharpe,
    input.finalPnl,
    input.finalWinRate,
    JSON.stringify(input.results)
  );
}

/**
 * Save phase results for an optimization run
 */
export function savePhaseResults(
  optimizationRunId: string,
  phaseSummaries: PhaseSummary[]
): void {
  const db = getDatabase();

  const stmt = db.prepare(`
    INSERT INTO phase_results (
      id, optimization_run_id, phase_number, phase_name,
      combinations_tested, duration_seconds, best_params,
      best_sharpe, best_pnl, skipped, skip_reason, top_results
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const summary of phaseSummaries) {
    const bestSharpe = summary.topResults[0]?.metrics.sharpeRatio ?? 0;
    const bestPnl = summary.topResults[0]?.metrics.totalPnl ?? 0;

    stmt.run(
      uuidv4(),
      optimizationRunId,
      summary.phase,
      summary.name,
      summary.combinationsTested,
      summary.durationSeconds,
      JSON.stringify(summary.bestParams),
      bestSharpe,
      bestPnl,
      summary.skipped ? 1 : 0,
      summary.skipReason || null,
      JSON.stringify(summary.topResults)
    );
  }
}

/**
 * Get an optimization run by ID
 */
export function getOptimizationRunById(id: string): OptimizationRunRow | null {
  const db = getDatabase();
  return db.prepare('SELECT * FROM optimization_runs WHERE id = ?').get(id) as OptimizationRunRow | null;
}

/**
 * Get full optimization result by ID (parses JSON)
 */
export function getOptimizationResultById(id: string): PhasedOptimizationResult | null {
  const row = getOptimizationRunById(id);
  if (!row) return null;

  try {
    return JSON.parse(row.results) as PhasedOptimizationResult;
  } catch {
    return null;
  }
}

/**
 * Get phase results for an optimization run
 */
export function getPhaseResultsByRunId(optimizationRunId: string): PhaseResultSummary[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM phase_results
    WHERE optimization_run_id = ?
    ORDER BY phase_number ASC
  `).all(optimizationRunId) as PhaseResultRow[];

  return rows.map((row) => ({
    id: row.id,
    optimizationRunId: row.optimization_run_id,
    phaseNumber: row.phase_number,
    phaseName: row.phase_name,
    combinationsTested: row.combinations_tested,
    durationSeconds: row.duration_seconds,
    bestParams: JSON.parse(row.best_params) as Record<string, number>,
    bestSharpe: row.best_sharpe,
    bestPnl: row.best_pnl,
    skipped: row.skipped === 1,
    skipReason: row.skip_reason,
  }));
}

/**
 * Get all optimization runs (summaries only)
 */
export function getAllOptimizationRuns(limit?: number): OptimizationRunSummary[] {
  const db = getDatabase();
  let query = `
    SELECT id, created_at, strategy_slug, session_ids, optimization_type,
           initial_capital, total_combinations_tested, duration_seconds,
           final_sharpe, final_pnl, final_win_rate
    FROM optimization_runs
    ORDER BY created_at DESC
  `;

  if (limit) {
    query += ` LIMIT ${limit}`;
  }

  const rows = db.prepare(query).all() as Array<{
    id: string;
    created_at: string;
    strategy_slug: string;
    session_ids: string;
    optimization_type: 'grid' | 'phased';
    initial_capital: number;
    total_combinations_tested: number;
    duration_seconds: number;
    final_sharpe: number;
    final_pnl: number;
    final_win_rate: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    strategySlug: row.strategy_slug,
    sessionIds: JSON.parse(row.session_ids) as string[],
    optimizationType: row.optimization_type,
    initialCapital: row.initial_capital,
    totalCombinationsTested: row.total_combinations_tested,
    durationSeconds: row.duration_seconds,
    finalSharpe: row.final_sharpe,
    finalPnl: row.final_pnl,
    finalWinRate: row.final_win_rate,
  }));
}

/**
 * Get optimization runs by type (grid or phased)
 */
export function getOptimizationRunsByType(
  optimizationType: 'grid' | 'phased',
  limit?: number
): OptimizationRunSummary[] {
  const db = getDatabase();
  let query = `
    SELECT id, created_at, strategy_slug, session_ids, optimization_type,
           initial_capital, total_combinations_tested, duration_seconds,
           final_sharpe, final_pnl, final_win_rate
    FROM optimization_runs
    WHERE optimization_type = ?
    ORDER BY created_at DESC
  `;

  if (limit) {
    query += ` LIMIT ${limit}`;
  }

  const rows = db.prepare(query).all(optimizationType) as Array<{
    id: string;
    created_at: string;
    strategy_slug: string;
    session_ids: string;
    optimization_type: 'grid' | 'phased';
    initial_capital: number;
    total_combinations_tested: number;
    duration_seconds: number;
    final_sharpe: number;
    final_pnl: number;
    final_win_rate: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    strategySlug: row.strategy_slug,
    sessionIds: JSON.parse(row.session_ids) as string[],
    optimizationType: row.optimization_type,
    initialCapital: row.initial_capital,
    totalCombinationsTested: row.total_combinations_tested,
    durationSeconds: row.duration_seconds,
    finalSharpe: row.final_sharpe,
    finalPnl: row.final_pnl,
    finalWinRate: row.final_win_rate,
  }));
}

/**
 * Delete an optimization run and its phase results
 */
export function deleteOptimizationRun(id: string): boolean {
  const db = getDatabase();
  // Phase results are deleted via CASCADE
  const result = db.prepare('DELETE FROM optimization_runs WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Delete all optimization runs
 */
export function deleteAllOptimizationRuns(): number {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM optimization_runs').run();
  return result.changes;
}

/**
 * Get top optimization runs by final Sharpe ratio
 */
export function getTopOptimizationRuns(limit: number = 10): OptimizationRunSummary[] {
  const db = getDatabase();
  const query = `
    SELECT id, created_at, strategy_slug, session_ids, optimization_type,
           initial_capital, total_combinations_tested, duration_seconds,
           final_sharpe, final_pnl, final_win_rate
    FROM optimization_runs
    ORDER BY final_sharpe DESC
    LIMIT ?
  `;

  const rows = db.prepare(query).all(limit) as Array<{
    id: string;
    created_at: string;
    strategy_slug: string;
    session_ids: string;
    optimization_type: 'grid' | 'phased';
    initial_capital: number;
    total_combinations_tested: number;
    duration_seconds: number;
    final_sharpe: number;
    final_pnl: number;
    final_win_rate: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    strategySlug: row.strategy_slug,
    sessionIds: JSON.parse(row.session_ids) as string[],
    optimizationType: row.optimization_type,
    initialCapital: row.initial_capital,
    totalCombinationsTested: row.total_combinations_tested,
    durationSeconds: row.duration_seconds,
    finalSharpe: row.final_sharpe,
    finalPnl: row.final_pnl,
    finalWinRate: row.final_win_rate,
  }));
}

/**
 * Get count of optimization runs
 */
export function getOptimizationRunCount(): number {
  const db = getDatabase();
  const result = db.prepare('SELECT COUNT(*) as count FROM optimization_runs').get() as { count: number };
  return result.count;
}

/**
 * Get final params from an optimization run
 */
export function getFinalParamsById(id: string): Record<string, number> | null {
  const row = getOptimizationRunById(id);
  if (!row) return null;

  try {
    return JSON.parse(row.final_params) as Record<string, number>;
  } catch {
    return null;
  }
}
