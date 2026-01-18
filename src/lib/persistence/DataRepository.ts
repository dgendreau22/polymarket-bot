/**
 * Data Repository
 *
 * CRUD operations for market data recording (sessions, ticks, snapshots).
 */

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './database';

// Re-export candle utilities for backwards compatibility
export { aggregateTicksToCandles, type CandleData } from '@/lib/utils/candles';

// ============================================================================
// Type Definitions
// ============================================================================

export interface RecordingSessionRow {
  id: string;
  market_id: string;
  market_name: string;
  event_slug: string;
  yes_asset_id: string;
  no_asset_id: string;
  start_time: string;
  end_time: string;
  tick_count: number;
  snapshot_count: number;
  created_at: string;
  ended_at: string | null;
}

export interface MarketTickRow {
  id: string;
  session_id: string;
  asset_id: string;
  outcome: 'YES' | 'NO';
  timestamp: string;
  price: string;
  size: string;
  side: 'BUY' | 'SELL';
  created_at: string;
}

export interface MarketSnapshotRow {
  id: string;
  session_id: string;
  timestamp: string;
  yes_best_bid: string | null;
  yes_best_ask: string | null;
  no_best_bid: string | null;
  no_best_ask: string | null;
  yes_bid_depth: string | null;
  yes_ask_depth: string | null;
  no_bid_depth: string | null;
  no_ask_depth: string | null;
  combined_cost: string | null;
  spread: string | null;
  created_at: string;
}

export interface SessionStats {
  tickCount: number;
  snapshotCount: number;
  priceRange: { yes: [number, number]; no: [number, number] };
  avgVolume: { yes: number; no: number };
  combinedCostRange: [number, number];
  volatility: { yes: number; no: number };
}

// ============================================================================
// Recording Session CRUD
// ============================================================================

/**
 * Create a new recording session
 */
export function createRecordingSession(session: {
  marketId: string;
  marketName: string;
  eventSlug: string;
  yesAssetId: string;
  noAssetId: string;
  startTime: string;
  endTime: string;
}): RecordingSessionRow {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO recording_sessions (id, market_id, market_name, event_slug, yes_asset_id, no_asset_id, start_time, end_time, tick_count, snapshot_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
  `).run(
    id,
    session.marketId,
    session.marketName,
    session.eventSlug,
    session.yesAssetId,
    session.noAssetId,
    session.startTime,
    session.endTime,
    now
  );

  return getRecordingSessionById(id)!;
}

/**
 * Get a recording session by ID
 */
export function getRecordingSessionById(id: string): RecordingSessionRow | null {
  const db = getDatabase();
  return db.prepare('SELECT * FROM recording_sessions WHERE id = ?').get(id) as RecordingSessionRow | null;
}

/**
 * Get all recording sessions
 */
export function getAllRecordingSessions(limit?: number): RecordingSessionRow[] {
  const db = getDatabase();
  if (limit) {
    return db.prepare('SELECT * FROM recording_sessions ORDER BY created_at DESC LIMIT ?')
      .all(limit) as RecordingSessionRow[];
  }
  return db.prepare('SELECT * FROM recording_sessions ORDER BY created_at DESC')
    .all() as RecordingSessionRow[];
}

/**
 * Get recording session by event slug
 */
export function getRecordingSessionByEventSlug(eventSlug: string): RecordingSessionRow | null {
  const db = getDatabase();
  return db.prepare('SELECT * FROM recording_sessions WHERE event_slug = ?').get(eventSlug) as RecordingSessionRow | null;
}

/**
 * Update session stats (tick count, snapshot count, ended_at)
 */
export function updateSessionStats(
  id: string,
  updates: { tickCount?: number; snapshotCount?: number; endedAt?: string }
): void {
  const db = getDatabase();
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (updates.tickCount !== undefined) {
    setClauses.push('tick_count = ?');
    params.push(updates.tickCount);
  }
  if (updates.snapshotCount !== undefined) {
    setClauses.push('snapshot_count = ?');
    params.push(updates.snapshotCount);
  }
  if (updates.endedAt !== undefined) {
    setClauses.push('ended_at = ?');
    params.push(updates.endedAt);
  }

  if (setClauses.length === 0) return;

  params.push(id);
  db.prepare(`UPDATE recording_sessions SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
}

/**
 * Increment session tick count
 */
export function incrementTickCount(sessionId: string): void {
  const db = getDatabase();
  db.prepare('UPDATE recording_sessions SET tick_count = tick_count + 1 WHERE id = ?').run(sessionId);
}

/**
 * Increment session snapshot count
 */
export function incrementSnapshotCount(sessionId: string): void {
  const db = getDatabase();
  db.prepare('UPDATE recording_sessions SET snapshot_count = snapshot_count + 1 WHERE id = ?').run(sessionId);
}

/**
 * Delete a recording session and all associated data
 */
export function deleteRecordingSession(id: string): boolean {
  const db = getDatabase();
  const session = getRecordingSessionById(id);
  if (!session) return false;

  // Cascade delete handled by foreign key, but explicit for safety
  db.prepare('DELETE FROM market_ticks WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM market_snapshots WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM recording_sessions WHERE id = ?').run(id);

  return true;
}

// ============================================================================
// Market Tick CRUD
// ============================================================================

/**
 * Save a single tick
 */
export function saveTick(tick: {
  sessionId: string;
  assetId: string;
  outcome: 'YES' | 'NO';
  timestamp: string;
  price: string;
  size: string;
  side: 'BUY' | 'SELL';
}): void {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO market_ticks (id, session_id, asset_id, outcome, timestamp, price, size, side, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, tick.sessionId, tick.assetId, tick.outcome, tick.timestamp, tick.price, tick.size, tick.side, now);
}

/**
 * Save multiple ticks in a transaction (for batch inserts)
 */
export function saveTicksBatch(ticks: Array<{
  sessionId: string;
  assetId: string;
  outcome: 'YES' | 'NO';
  timestamp: string;
  price: string;
  size: string;
  side: 'BUY' | 'SELL';
}>): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO market_ticks (id, session_id, asset_id, outcome, timestamp, price, size, side, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items: typeof ticks) => {
    for (const tick of items) {
      insert.run(uuidv4(), tick.sessionId, tick.assetId, tick.outcome, tick.timestamp, tick.price, tick.size, tick.side, now);
    }
  });

  insertMany(ticks);
}

/**
 * Get ticks for a session
 */
export function getTicksBySession(sessionId: string, outcome?: 'YES' | 'NO'): MarketTickRow[] {
  const db = getDatabase();
  if (outcome) {
    return db.prepare('SELECT * FROM market_ticks WHERE session_id = ? AND outcome = ? ORDER BY timestamp ASC')
      .all(sessionId, outcome) as MarketTickRow[];
  }
  return db.prepare('SELECT * FROM market_ticks WHERE session_id = ? ORDER BY timestamp ASC')
    .all(sessionId) as MarketTickRow[];
}

/**
 * Get ticks in a time range
 */
export function getTicksInTimeRange(
  sessionId: string,
  startTime: string,
  endTime: string,
  outcome?: 'YES' | 'NO'
): MarketTickRow[] {
  const db = getDatabase();
  if (outcome) {
    return db.prepare(`
      SELECT * FROM market_ticks
      WHERE session_id = ? AND outcome = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `).all(sessionId, outcome, startTime, endTime) as MarketTickRow[];
  }
  return db.prepare(`
    SELECT * FROM market_ticks
    WHERE session_id = ? AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `).all(sessionId, startTime, endTime) as MarketTickRow[];
}

/**
 * Get tick count for a session
 */
export function getTickCount(sessionId: string): number {
  const db = getDatabase();
  const result = db.prepare('SELECT COUNT(*) as count FROM market_ticks WHERE session_id = ?').get(sessionId) as { count: number };
  return result.count;
}

/**
 * Get all ticks across all sessions
 */
export function getAllTicks(outcome?: 'YES' | 'NO'): MarketTickRow[] {
  const db = getDatabase();
  if (outcome) {
    return db.prepare('SELECT * FROM market_ticks WHERE outcome = ? ORDER BY timestamp ASC')
      .all(outcome) as MarketTickRow[];
  }
  return db.prepare('SELECT * FROM market_ticks ORDER BY timestamp ASC')
    .all() as MarketTickRow[];
}

// ============================================================================
// Market Snapshot CRUD
// ============================================================================

/**
 * Save a market snapshot
 */
export function saveSnapshot(snapshot: {
  sessionId: string;
  timestamp: string;
  yesBestBid?: string;
  yesBestAsk?: string;
  noBestBid?: string;
  noBestAsk?: string;
  yesBidDepth?: string[];
  yesAskDepth?: string[];
  noBidDepth?: string[];
  noAskDepth?: string[];
  combinedCost?: string;
  spread?: string;
}): void {
  const db = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO market_snapshots (
      id, session_id, timestamp,
      yes_best_bid, yes_best_ask, no_best_bid, no_best_ask,
      yes_bid_depth, yes_ask_depth, no_bid_depth, no_ask_depth,
      combined_cost, spread, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    snapshot.sessionId,
    snapshot.timestamp,
    snapshot.yesBestBid ?? null,
    snapshot.yesBestAsk ?? null,
    snapshot.noBestBid ?? null,
    snapshot.noBestAsk ?? null,
    snapshot.yesBidDepth ? JSON.stringify(snapshot.yesBidDepth) : null,
    snapshot.yesAskDepth ? JSON.stringify(snapshot.yesAskDepth) : null,
    snapshot.noBidDepth ? JSON.stringify(snapshot.noBidDepth) : null,
    snapshot.noAskDepth ? JSON.stringify(snapshot.noAskDepth) : null,
    snapshot.combinedCost ?? null,
    snapshot.spread ?? null,
    now
  );
}

/**
 * Get snapshots for a session
 */
export function getSnapshotsBySession(sessionId: string): MarketSnapshotRow[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM market_snapshots WHERE session_id = ? ORDER BY timestamp ASC')
    .all(sessionId) as MarketSnapshotRow[];
}

/**
 * Get the latest snapshot for a session
 */
export function getLatestSnapshot(sessionId: string): MarketSnapshotRow | null {
  const db = getDatabase();
  return db.prepare('SELECT * FROM market_snapshots WHERE session_id = ? ORDER BY timestamp DESC LIMIT 1')
    .get(sessionId) as MarketSnapshotRow | null;
}

/**
 * Get snapshot count for a session
 */
export function getSnapshotCount(sessionId: string): number {
  const db = getDatabase();
  const result = db.prepare('SELECT COUNT(*) as count FROM market_snapshots WHERE session_id = ?').get(sessionId) as { count: number };
  return result.count;
}

/**
 * Get all snapshots for multiple sessions, ordered by timestamp
 */
export function getSnapshotsForSessions(sessionIds: string[]): MarketSnapshotRow[] {
  if (sessionIds.length === 0) return [];

  const db = getDatabase();
  const placeholders = sessionIds.map(() => '?').join(', ');
  return db.prepare(`
    SELECT * FROM market_snapshots
    WHERE session_id IN (${placeholders})
    ORDER BY timestamp ASC
  `).all(...sessionIds) as MarketSnapshotRow[];
}

// ============================================================================
// Statistics & Aggregation
// ============================================================================

/**
 * Calculate statistics for a session
 */
export function calculateSessionStats(sessionId: string): SessionStats {
  const db = getDatabase();

  // Get tick statistics
  const yesStats = db.prepare(`
    SELECT
      COUNT(*) as count,
      MIN(CAST(price AS REAL)) as min_price,
      MAX(CAST(price AS REAL)) as max_price,
      AVG(CAST(size AS REAL)) as avg_volume
    FROM market_ticks
    WHERE session_id = ? AND outcome = 'YES'
  `).get(sessionId) as { count: number; min_price: number | null; max_price: number | null; avg_volume: number | null };

  const noStats = db.prepare(`
    SELECT
      COUNT(*) as count,
      MIN(CAST(price AS REAL)) as min_price,
      MAX(CAST(price AS REAL)) as max_price,
      AVG(CAST(size AS REAL)) as avg_volume
    FROM market_ticks
    WHERE session_id = ? AND outcome = 'NO'
  `).get(sessionId) as { count: number; min_price: number | null; max_price: number | null; avg_volume: number | null };

  // Get snapshot statistics
  const snapshotStats = db.prepare(`
    SELECT
      COUNT(*) as count,
      MIN(CAST(combined_cost AS REAL)) as min_combined,
      MAX(CAST(combined_cost AS REAL)) as max_combined
    FROM market_snapshots
    WHERE session_id = ? AND combined_cost IS NOT NULL
  `).get(sessionId) as { count: number; min_combined: number | null; max_combined: number | null };

  // Calculate volatility (standard deviation of prices)
  const yesVolatility = calculateVolatility(sessionId, 'YES');
  const noVolatility = calculateVolatility(sessionId, 'NO');

  return {
    tickCount: (yesStats.count || 0) + (noStats.count || 0),
    snapshotCount: snapshotStats.count || 0,
    priceRange: {
      yes: [yesStats.min_price ?? 0, yesStats.max_price ?? 0],
      no: [noStats.min_price ?? 0, noStats.max_price ?? 0],
    },
    avgVolume: {
      yes: yesStats.avg_volume ?? 0,
      no: noStats.avg_volume ?? 0,
    },
    combinedCostRange: [
      snapshotStats.min_combined ?? 0,
      snapshotStats.max_combined ?? 0,
    ],
    volatility: {
      yes: yesVolatility,
      no: noVolatility,
    },
  };
}

/**
 * Calculate price volatility (standard deviation)
 */
function calculateVolatility(sessionId: string, outcome: 'YES' | 'NO'): number {
  const db = getDatabase();

  // SQLite doesn't have built-in STDEV, so we calculate it manually
  const prices = db.prepare(`
    SELECT CAST(price AS REAL) as price
    FROM market_ticks
    WHERE session_id = ? AND outcome = ?
  `).all(sessionId, outcome) as Array<{ price: number }>;

  if (prices.length < 2) return 0;

  const mean = prices.reduce((sum, p) => sum + p.price, 0) / prices.length;
  const squaredDiffs = prices.map(p => Math.pow(p.price - mean, 2));
  const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / prices.length;

  return Math.sqrt(variance);
}

