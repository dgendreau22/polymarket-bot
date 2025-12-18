/**
 * Trade Repository
 *
 * CRUD operations for trade persistence.
 */

import { getDatabase } from './database';
import type { Trade, TradeRow, TradeFilters, BotMode } from '../bots/types';

// ============================================================================
// Trade CRUD
// ============================================================================

/**
 * Create a new trade
 */
export function createTrade(trade: Trade): TradeRow {
  const db = getDatabase();

  const stmt = db.prepare(`
    INSERT INTO trades (
      id, bot_id, strategy_slug, market_id, asset_id, mode,
      side, outcome, price, quantity, total_value, fee, pnl,
      status, order_id, executed_at, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    trade.id,
    trade.botId,
    trade.strategySlug,
    trade.marketId,
    trade.assetId,
    trade.mode,
    trade.side,
    trade.outcome,
    trade.price,
    trade.quantity,
    trade.totalValue,
    trade.fee,
    trade.pnl,
    trade.status,
    trade.orderId || null,
    trade.executedAt.toISOString(),
    trade.createdAt.toISOString()
  );

  return getTradeById(trade.id)!;
}

/**
 * Get a trade by ID
 */
export function getTradeById(id: string): TradeRow | null {
  const db = getDatabase();
  return db.prepare('SELECT * FROM trades WHERE id = ?').get(id) as TradeRow | null;
}

/**
 * Get trades with filters
 */
export function getTrades(filters?: TradeFilters): TradeRow[] {
  const db = getDatabase();
  let query = `
    SELECT
      trades.*,
      bots.name as bot_name
    FROM trades
    LEFT JOIN bots ON trades.bot_id = bots.id
  `;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.botId) {
    conditions.push('trades.bot_id = ?');
    params.push(filters.botId);
  }
  if (filters?.strategySlug) {
    conditions.push('trades.strategy_slug = ?');
    params.push(filters.strategySlug);
  }
  if (filters?.marketId) {
    conditions.push('trades.market_id = ?');
    params.push(filters.marketId);
  }
  if (filters?.mode) {
    conditions.push('trades.mode = ?');
    params.push(filters.mode);
  }
  if (filters?.side) {
    conditions.push('trades.side = ?');
    params.push(filters.side);
  }
  if (filters?.outcome) {
    conditions.push('trades.outcome = ?');
    params.push(filters.outcome);
  }
  if (filters?.status) {
    conditions.push('trades.status = ?');
    params.push(filters.status);
  }
  if (filters?.startDate) {
    conditions.push('trades.executed_at >= ?');
    params.push(filters.startDate.toISOString());
  }
  if (filters?.endDate) {
    conditions.push('trades.executed_at <= ?');
    params.push(filters.endDate.toISOString());
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY trades.executed_at DESC';

  if (filters?.limit) {
    query += ' LIMIT ?';
    params.push(filters.limit);
  }
  if (filters?.offset) {
    query += ' OFFSET ?';
    params.push(filters.offset);
  }

  return db.prepare(query).all(...params) as TradeRow[];
}

/**
 * Get trades for a specific bot
 */
export function getTradesByBotId(botId: string, limit?: number): TradeRow[] {
  return getTrades({ botId, limit });
}

/**
 * Get trades for a specific strategy
 */
export function getTradesByStrategy(strategySlug: string, limit?: number): TradeRow[] {
  return getTrades({ strategySlug, limit });
}

/**
 * Update trade status
 */
export function updateTradeStatus(
  id: string,
  status: Trade['status'],
  updates?: { pnl?: string; orderId?: string }
): void {
  const db = getDatabase();

  let query = 'UPDATE trades SET status = ?';
  const params: unknown[] = [status];

  if (updates?.pnl !== undefined) {
    query += ', pnl = ?';
    params.push(updates.pnl);
  }
  if (updates?.orderId !== undefined) {
    query += ', order_id = ?';
    params.push(updates.orderId);
  }

  query += ' WHERE id = ?';
  params.push(id);

  db.prepare(query).run(...params);
}

/**
 * Get trade count by filters
 */
export function getTradeCount(filters?: Omit<TradeFilters, 'limit' | 'offset'>): number {
  const db = getDatabase();
  let query = 'SELECT COUNT(*) as count FROM trades';
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.botId) {
    conditions.push('bot_id = ?');
    params.push(filters.botId);
  }
  if (filters?.strategySlug) {
    conditions.push('strategy_slug = ?');
    params.push(filters.strategySlug);
  }
  if (filters?.marketId) {
    conditions.push('market_id = ?');
    params.push(filters.marketId);
  }
  if (filters?.mode) {
    conditions.push('mode = ?');
    params.push(filters.mode);
  }
  if (filters?.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  const result = db.prepare(query).get(...params) as { count: number };
  return result.count;
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get trade statistics for a bot
 */
export function getBotTradeStats(botId: string): {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnl: string;
  avgTradeSize: string;
} {
  const db = getDatabase();

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_trades,
      SUM(CASE WHEN CAST(pnl AS REAL) > 0 THEN 1 ELSE 0 END) as winning_trades,
      SUM(CASE WHEN CAST(pnl AS REAL) < 0 THEN 1 ELSE 0 END) as losing_trades,
      COALESCE(SUM(CAST(pnl AS REAL)), 0) as total_pnl,
      COALESCE(AVG(CAST(total_value AS REAL)), 0) as avg_trade_size
    FROM trades
    WHERE bot_id = ? AND status = 'filled'
  `).get(botId) as {
    total_trades: number;
    winning_trades: number;
    losing_trades: number;
    total_pnl: number;
    avg_trade_size: number;
  };

  return {
    totalTrades: stats.total_trades,
    winningTrades: stats.winning_trades || 0,
    losingTrades: stats.losing_trades || 0,
    totalPnl: stats.total_pnl.toFixed(6),
    avgTradeSize: stats.avg_trade_size.toFixed(6),
  };
}

/**
 * Get trade statistics for a strategy
 */
export function getStrategyTradeStats(strategySlug: string): {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: string;
  avgTradeSize: string;
  profitFactor: number;
} {
  const db = getDatabase();

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_trades,
      SUM(CASE WHEN CAST(pnl AS REAL) > 0 THEN 1 ELSE 0 END) as winning_trades,
      SUM(CASE WHEN CAST(pnl AS REAL) < 0 THEN 1 ELSE 0 END) as losing_trades,
      COALESCE(SUM(CAST(pnl AS REAL)), 0) as total_pnl,
      COALESCE(AVG(CAST(total_value AS REAL)), 0) as avg_trade_size,
      COALESCE(SUM(CASE WHEN CAST(pnl AS REAL) > 0 THEN CAST(pnl AS REAL) ELSE 0 END), 0) as gross_profit,
      COALESCE(ABS(SUM(CASE WHEN CAST(pnl AS REAL) < 0 THEN CAST(pnl AS REAL) ELSE 0 END)), 0) as gross_loss
    FROM trades
    WHERE strategy_slug = ? AND status = 'filled'
  `).get(strategySlug) as {
    total_trades: number;
    winning_trades: number;
    losing_trades: number;
    total_pnl: number;
    avg_trade_size: number;
    gross_profit: number;
    gross_loss: number;
  };

  const winRate = stats.total_trades > 0
    ? ((stats.winning_trades || 0) / stats.total_trades) * 100
    : 0;

  const profitFactor = stats.gross_loss > 0
    ? stats.gross_profit / stats.gross_loss
    : stats.gross_profit > 0 ? Infinity : 0;

  return {
    totalTrades: stats.total_trades,
    winningTrades: stats.winning_trades || 0,
    losingTrades: stats.losing_trades || 0,
    winRate,
    totalPnl: stats.total_pnl.toFixed(6),
    avgTradeSize: stats.avg_trade_size.toFixed(6),
    profitFactor: isFinite(profitFactor) ? profitFactor : 0,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert TradeRow to Trade
 */
export function rowToTrade(row: TradeRow): Trade {
  return {
    id: row.id,
    botId: row.bot_id,
    botName: row.bot_name || undefined,
    strategySlug: row.strategy_slug,
    marketId: row.market_id,
    assetId: row.asset_id,
    mode: row.mode,
    side: row.side,
    outcome: row.outcome,
    price: row.price,
    quantity: row.quantity,
    totalValue: row.total_value,
    fee: row.fee,
    pnl: row.pnl,
    status: row.status,
    orderId: row.order_id || undefined,
    executedAt: new Date(row.executed_at),
    createdAt: new Date(row.created_at),
  };
}
