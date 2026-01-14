/**
 * Bot Repository
 *
 * CRUD operations for bot persistence.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './database';
import type {
  BotConfig,
  BotRow,
  BotState,
  BotMode,
  Position,
  PositionRow,
} from '../bots/types';

// ============================================================================
// Bot CRUD
// ============================================================================

/**
 * Create a new bot
 */
export function createBot(config: Omit<BotConfig, 'id'> & { id?: string }): BotRow {
  const db = getDatabase();
  const id = config.id || uuidv4();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO bots (id, name, strategy_slug, market_id, market_name, asset_id, no_asset_id, mode, state, config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'stopped', ?, ?, ?)
  `);

  stmt.run(
    id,
    config.name,
    config.strategySlug,
    config.marketId,
    config.marketName || null,
    config.assetId || null,
    config.noAssetId || null,
    config.mode,
    config.strategyConfig ? JSON.stringify(config.strategyConfig) : null,
    now,
    now
  );

  return getBotById(id)!;
}

/**
 * Get a bot by ID
 */
export function getBotById(id: string): BotRow | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM bots WHERE id = ?');
  return stmt.get(id) as BotRow | null;
}

/**
 * Get all bots
 */
export function getAllBots(filters?: {
  state?: BotState;
  mode?: BotMode;
  strategySlug?: string;
}): BotRow[] {
  const db = getDatabase();
  let query = 'SELECT * FROM bots';
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.state) {
    conditions.push('state = ?');
    params.push(filters.state);
  }
  if (filters?.mode) {
    conditions.push('mode = ?');
    params.push(filters.mode);
  }
  if (filters?.strategySlug) {
    conditions.push('strategy_slug = ?');
    params.push(filters.strategySlug);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY created_at DESC';

  const stmt = db.prepare(query);
  return stmt.all(...params) as BotRow[];
}

/**
 * Update bot state
 */
export function updateBotState(
  id: string,
  state: BotState,
  timestamps?: { startedAt?: string; stoppedAt?: string }
): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  let query = 'UPDATE bots SET state = ?, updated_at = ?';
  const params: unknown[] = [state, now];

  if (timestamps?.startedAt) {
    query += ', started_at = ?';
    params.push(timestamps.startedAt);
  }
  if (timestamps?.stoppedAt) {
    query += ', stopped_at = ?';
    params.push(timestamps.stoppedAt);
  }

  query += ' WHERE id = ?';
  params.push(id);

  db.prepare(query).run(...params);
}

/**
 * Update bot config
 */
export function updateBotConfig(id: string, config: Record<string, unknown>): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  db.prepare('UPDATE bots SET config = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(config),
    now,
    id
  );
}

/**
 * Delete a bot
 */
export function deleteBot(id: string): boolean {
  const db = getDatabase();

  // Check if bot exists and is stopped
  const bot = getBotById(id);
  if (!bot) {
    return false;
  }
  if (bot.state !== 'stopped') {
    throw new Error('Cannot delete a running bot. Stop it first.');
  }

  // Delete associated trades and positions
  db.prepare('DELETE FROM trades WHERE bot_id = ?').run(id);
  db.prepare('DELETE FROM positions WHERE bot_id = ?').run(id);
  db.prepare('DELETE FROM bots WHERE id = ?').run(id);

  return true;
}

// ============================================================================
// Position CRUD
// ============================================================================

/**
 * Get or create position for a bot and asset
 * Now supports multiple positions per bot (e.g., YES and NO for dual-asset bots)
 */
export function getOrCreatePosition(
  botId: string,
  marketId: string,
  assetId: string,
  outcome: 'YES' | 'NO' = 'YES'
): PositionRow {
  const db = getDatabase();

  // Query by both bot_id AND asset_id to support multiple positions per bot
  let position = db
    .prepare('SELECT * FROM positions WHERE bot_id = ? AND asset_id = ?')
    .get(botId, assetId) as PositionRow | null;

  if (!position) {
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO positions (id, bot_id, market_id, asset_id, outcome, size, avg_entry_price, realized_pnl, updated_at)
      VALUES (?, ?, ?, ?, ?, '0', '0', '0', ?)
    `).run(id, botId, marketId, assetId, outcome, now);

    position = db.prepare('SELECT * FROM positions WHERE id = ?').get(id) as PositionRow;
  }

  return position;
}

/**
 * Update position for a bot and asset
 * Now requires assetId to support multiple positions per bot
 */
export function updatePosition(
  botId: string,
  assetId: string,
  updates: Partial<Pick<Position, 'size' | 'avgEntryPrice' | 'realizedPnl' | 'outcome'>>
): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  const setClauses: string[] = ['updated_at = ?'];
  const params: unknown[] = [now];

  if (updates.size !== undefined) {
    setClauses.push('size = ?');
    params.push(updates.size);
  }
  if (updates.avgEntryPrice !== undefined) {
    setClauses.push('avg_entry_price = ?');
    params.push(updates.avgEntryPrice);
  }
  if (updates.realizedPnl !== undefined) {
    setClauses.push('realized_pnl = ?');
    params.push(updates.realizedPnl);
  }
  if (updates.outcome !== undefined) {
    setClauses.push('outcome = ?');
    params.push(updates.outcome);
  }

  params.push(botId, assetId);

  db.prepare(`UPDATE positions SET ${setClauses.join(', ')} WHERE bot_id = ? AND asset_id = ?`).run(...params);
}

/**
 * Get position for a bot and specific asset
 */
export function getPosition(botId: string, assetId?: string): PositionRow | null {
  const db = getDatabase();
  if (assetId) {
    return db.prepare('SELECT * FROM positions WHERE bot_id = ? AND asset_id = ?').get(botId, assetId) as PositionRow | null;
  }
  // Fallback: return first position (for backwards compatibility with single-asset bots)
  return db.prepare('SELECT * FROM positions WHERE bot_id = ?').get(botId) as PositionRow | null;
}

/**
 * Get all positions for a bot
 * Returns array of positions (for dual-asset bots with YES and NO positions)
 */
export function getPositionsByBotId(botId: string): PositionRow[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM positions WHERE bot_id = ?').all(botId) as PositionRow[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert BotRow to BotConfig
 */
export function rowToConfig(row: BotRow): BotConfig {
  return {
    id: row.id,
    name: row.name,
    strategySlug: row.strategy_slug,
    marketId: row.market_id,
    marketName: row.market_name || undefined,
    assetId: row.asset_id || undefined,
    noAssetId: row.no_asset_id || undefined,
    mode: row.mode,
    strategyConfig: row.config ? JSON.parse(row.config) : undefined,
  };
}

/**
 * Convert PositionRow to Position
 */
export function rowToPosition(row: PositionRow): Position {
  return {
    marketId: row.market_id,
    assetId: row.asset_id,
    outcome: row.outcome,
    size: row.size,
    avgEntryPrice: row.avg_entry_price,
    realizedPnl: row.realized_pnl,
  };
}
