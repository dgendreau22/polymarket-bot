/**
 * Strategy Metrics Repository
 *
 * CRUD operations for strategy metrics persistence (TimeAbove50 parameter charting).
 */

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './database';

// ============================================================================
// Types
// ============================================================================

/** Strategy metric data point */
export interface StrategyMetric {
  id: string;
  botId: string;
  timestamp: number;
  tau: number | null;
  edge: number | null;
  qStar: number | null;
  theta: number | null;
  delta: number | null;
  price: number | null;
  positionYes: number;
  positionNo: number;
  totalPnl: number | null;
}

/** Database row representation */
export interface StrategyMetricRow {
  id: string;
  bot_id: string;
  timestamp: number;
  tau: number | null;
  edge: number | null;
  q_star: number | null;
  theta: number | null;
  delta: number | null;
  price: number | null;
  position_yes: number;
  position_no: number;
  total_pnl: number | null;
}

/** Input for creating a new metric (id is auto-generated) */
export type CreateStrategyMetricInput = Omit<StrategyMetric, 'id'>;

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new strategy metric
 */
export function createStrategyMetric(input: CreateStrategyMetricInput): StrategyMetric {
  const db = getDatabase();
  const id = uuidv4();

  const stmt = db.prepare(`
    INSERT INTO strategy_metrics (
      id, bot_id, timestamp, tau, edge, q_star, theta, delta,
      price, position_yes, position_no, total_pnl
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    input.botId,
    input.timestamp,
    input.tau,
    input.edge,
    input.qStar,
    input.theta,
    input.delta,
    input.price,
    input.positionYes,
    input.positionNo,
    input.totalPnl
  );

  return { id, ...input };
}

/**
 * Get all metrics for a bot in chronological order
 */
export function getMetricsByBotId(botId: string): StrategyMetricRow[] {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT * FROM strategy_metrics
    WHERE bot_id = ?
    ORDER BY timestamp ASC
  `);

  return stmt.all(botId) as StrategyMetricRow[];
}

/**
 * Get recent metrics for a bot (limited count, chronological order)
 */
export function getRecentMetricsByBotId(botId: string, limit: number = 100): StrategyMetricRow[] {
  const db = getDatabase();

  // Get most recent N records, but return in chronological order
  const stmt = db.prepare(`
    SELECT * FROM (
      SELECT * FROM strategy_metrics
      WHERE bot_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    ) ORDER BY timestamp ASC
  `);

  return stmt.all(botId, limit) as StrategyMetricRow[];
}

/**
 * Get metric count for a bot
 */
export function getMetricCountByBotId(botId: string): number {
  const db = getDatabase();

  const result = db.prepare(`
    SELECT COUNT(*) as count FROM strategy_metrics WHERE bot_id = ?
  `).get(botId) as { count: number };

  return result.count;
}

/**
 * Delete all metrics for a bot
 * (Note: CASCADE delete handles this automatically when bot is deleted)
 */
export function deleteMetricsByBotId(botId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM strategy_metrics WHERE bot_id = ?').run(botId);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert StrategyMetricRow to StrategyMetric
 */
export function rowToMetric(row: StrategyMetricRow): StrategyMetric {
  return {
    id: row.id,
    botId: row.bot_id,
    timestamp: row.timestamp,
    tau: row.tau,
    edge: row.edge,
    qStar: row.q_star,
    theta: row.theta,
    delta: row.delta,
    price: row.price,
    positionYes: row.position_yes,
    positionNo: row.position_no,
    totalPnl: row.total_pnl,
  };
}
