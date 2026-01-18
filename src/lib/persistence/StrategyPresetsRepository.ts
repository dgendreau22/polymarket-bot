/**
 * Strategy Presets Repository
 *
 * CRUD operations for strategy presets persistence.
 * Presets store optimized parameters from phased optimization runs.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './database';

// ============================================================================
// Types
// ============================================================================

export interface StrategyPresetRow {
  id: string;
  name: string;
  strategy_slug: string;
  description: string | null;
  params: string; // JSON
  source_optimization_id: string | null;
  final_sharpe: number | null;
  final_pnl: number | null;
  final_win_rate: number | null;
  created_at: string;
}

export interface StrategyPreset {
  id: string;
  name: string;
  strategySlug: string;
  description?: string;
  params: Record<string, number>;
  sourceOptimizationId?: string;
  finalSharpe?: number;
  finalPnl?: number;
  finalWinRate?: number;
  createdAt: string;
}

export interface CreatePresetInput {
  name: string;
  strategySlug: string;
  description?: string;
  params: Record<string, number>;
  sourceOptimizationId?: string;
  finalSharpe?: number;
  finalPnl?: number;
  finalWinRate?: number;
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new preset
 */
export function createPreset(input: CreatePresetInput): StrategyPreset {
  const db = getDatabase();
  const id = uuidv4();

  const stmt = db.prepare(`
    INSERT INTO strategy_presets (id, name, strategy_slug, description, params, source_optimization_id, final_sharpe, final_pnl, final_win_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    input.name,
    input.strategySlug,
    input.description || null,
    JSON.stringify(input.params),
    input.sourceOptimizationId || null,
    input.finalSharpe ?? null,
    input.finalPnl ?? null,
    input.finalWinRate ?? null
  );

  return getPresetById(id)!;
}

/**
 * Get a preset by ID
 */
export function getPresetById(id: string): StrategyPreset | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM strategy_presets WHERE id = ?');
  const row = stmt.get(id) as StrategyPresetRow | null;
  return row ? rowToPreset(row) : null;
}

/**
 * Get all presets for a strategy
 */
export function getPresetsByStrategy(strategySlug: string): StrategyPreset[] {
  const db = getDatabase();
  const stmt = db.prepare(
    'SELECT * FROM strategy_presets WHERE strategy_slug = ? ORDER BY created_at DESC'
  );
  const rows = stmt.all(strategySlug) as StrategyPresetRow[];
  return rows.map(rowToPreset);
}

/**
 * Get all presets
 */
export function getAllPresets(): StrategyPreset[] {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM strategy_presets ORDER BY created_at DESC');
  const rows = stmt.all() as StrategyPresetRow[];
  return rows.map(rowToPreset);
}

/**
 * Delete a preset
 */
export function deletePreset(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM strategy_presets WHERE id = ?').run(id);
  return result.changes > 0;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert database row to preset object
 */
function rowToPreset(row: StrategyPresetRow): StrategyPreset {
  return {
    id: row.id,
    name: row.name,
    strategySlug: row.strategy_slug,
    description: row.description || undefined,
    params: JSON.parse(row.params),
    sourceOptimizationId: row.source_optimization_id || undefined,
    finalSharpe: row.final_sharpe ?? undefined,
    finalPnl: row.final_pnl ?? undefined,
    finalWinRate: row.final_win_rate ?? undefined,
    createdAt: row.created_at,
  };
}
