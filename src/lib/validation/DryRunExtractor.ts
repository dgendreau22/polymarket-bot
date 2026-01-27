/**
 * Dry-Run Data Extractor
 *
 * Extracts dry-run trade data from the database for comparison with backtest results.
 * Matches recording sessions with corresponding bots and their trades.
 */

import { getDatabase } from '../persistence/database';
import { rowToConfig } from '../persistence/BotRepository';
import { rowToTrade } from '../persistence/TradeRepository';
import type { Trade, BotConfig, BotRow, TradeRow } from '../bots/types';
import type { RecordingSessionRow } from '../persistence/DataRepository';
import type { SessionWithDryRunData } from './types';

// ============================================================================
// Session Queries
// ============================================================================

/**
 * Get all recording sessions for a specific date
 * @param date Date string in YYYY-MM-DD format
 */
export function getSessionsForDate(date: string): RecordingSessionRow[] {
  const db = getDatabase();

  // Query sessions where start_time begins with the given date
  // Format: 2026-01-18T...
  const datePrefix = `${date}%`;

  const sessions = db.prepare(`
    SELECT * FROM recording_sessions
    WHERE start_time LIKE ?
    ORDER BY start_time ASC
  `).all(datePrefix) as RecordingSessionRow[];

  return sessions;
}

/**
 * Get all recording sessions
 */
export function getAllSessions(limit?: number): RecordingSessionRow[] {
  const db = getDatabase();

  let query = 'SELECT * FROM recording_sessions ORDER BY start_time DESC';
  if (limit) {
    query += ` LIMIT ${limit}`;
  }

  return db.prepare(query).all() as RecordingSessionRow[];
}

// ============================================================================
// Bot Matching
// ============================================================================

/**
 * Find bots that traded on a specific market during a session's time window
 *
 * Matching criteria:
 * 1. Bot market_id matches session market_id
 * 2. Bot has trades within the session time window
 * 3. Bot mode is 'dry_run' (we're comparing dry-run to backtest)
 */
export function findBotForSession(session: RecordingSessionRow): BotConfig | null {
  const db = getDatabase();

  // First, try to find bots with matching market_id
  const bots = db.prepare(`
    SELECT DISTINCT b.*
    FROM bots b
    INNER JOIN trades t ON b.id = t.bot_id
    WHERE b.market_id = ?
      AND b.mode = 'dry_run'
      AND t.executed_at >= ?
      AND t.executed_at <= ?
      AND t.status = 'filled'
    ORDER BY b.created_at DESC
  `).all(session.market_id, session.start_time, session.end_time) as BotRow[];

  if (bots.length === 0) {
    return null;
  }

  // Return the most relevant bot (most recent with trades in window)
  return rowToConfig(bots[0]);
}

/**
 * Find all bots that could potentially match a session
 * (Less strict matching - for debugging)
 */
export function findPotentialBotsForSession(session: RecordingSessionRow): BotConfig[] {
  const db = getDatabase();

  // Find bots with matching market_id regardless of trade timing
  const bots = db.prepare(`
    SELECT * FROM bots
    WHERE market_id = ?
      AND mode = 'dry_run'
    ORDER BY created_at DESC
  `).all(session.market_id) as BotRow[];

  return bots.map(rowToConfig);
}

// ============================================================================
// Trade Extraction
// ============================================================================

/**
 * Get all filled trades for a bot within a time window
 */
export function getTradesForSession(
  botId: string,
  startTime: string,
  endTime: string
): Trade[] {
  const db = getDatabase();

  const trades = db.prepare(`
    SELECT
      trades.*,
      bots.name as bot_name
    FROM trades
    LEFT JOIN bots ON trades.bot_id = bots.id
    WHERE trades.bot_id = ?
      AND trades.executed_at >= ?
      AND trades.executed_at <= ?
      AND trades.status = 'filled'
    ORDER BY trades.executed_at ASC
  `).all(botId, startTime, endTime) as TradeRow[];

  return trades.map(rowToTrade);
}

/**
 * Get all trades for a bot (no time filter)
 */
export function getAllTradesForBot(botId: string): Trade[] {
  const db = getDatabase();

  const trades = db.prepare(`
    SELECT
      trades.*,
      bots.name as bot_name
    FROM trades
    LEFT JOIN bots ON trades.bot_id = bots.id
    WHERE trades.bot_id = ?
      AND trades.status = 'filled'
    ORDER BY trades.executed_at ASC
  `).all(botId) as TradeRow[];

  return trades.map(rowToTrade);
}

/**
 * Get strategy config from a bot
 */
export function getStrategyConfig(botId: string): Record<string, unknown> | null {
  const db = getDatabase();

  const bot = db.prepare('SELECT config FROM bots WHERE id = ?').get(botId) as { config: string | null } | undefined;

  if (!bot || !bot.config) {
    return null;
  }

  try {
    return JSON.parse(bot.config);
  } catch {
    return null;
  }
}

// ============================================================================
// Composite Extraction
// ============================================================================

/**
 * Extract all dry-run data for sessions on a given date
 */
export function extractDryRunDataForDate(date: string): SessionWithDryRunData[] {
  const sessions = getSessionsForDate(date);
  const results: SessionWithDryRunData[] = [];

  for (const session of sessions) {
    const bot = findBotForSession(session);

    if (bot) {
      const trades = getTradesForSession(bot.id, session.start_time, session.end_time);
      const strategyConfig = getStrategyConfig(bot.id);

      results.push({
        session,
        bot,
        trades,
        strategyConfig,
      });
    } else {
      // Include session even without bot for completeness
      results.push({
        session,
        bot: null,
        trades: [],
        strategyConfig: null,
      });
    }
  }

  return results;
}

/**
 * Extract dry-run data for a specific session by ID
 */
export function extractDryRunDataForSession(sessionId: string): SessionWithDryRunData | null {
  const db = getDatabase();

  const session = db.prepare('SELECT * FROM recording_sessions WHERE id = ?')
    .get(sessionId) as RecordingSessionRow | null;

  if (!session) {
    return null;
  }

  const bot = findBotForSession(session);

  if (bot) {
    const trades = getTradesForSession(bot.id, session.start_time, session.end_time);
    const strategyConfig = getStrategyConfig(bot.id);

    return {
      session,
      bot,
      trades,
      strategyConfig,
    };
  }

  return {
    session,
    bot: null,
    trades: [],
    strategyConfig: null,
  };
}

// ============================================================================
// Statistics Helpers
// ============================================================================

/**
 * Get trade counts by market for a date range
 */
export function getTradeCountsByMarket(startDate: string, endDate: string): Map<string, number> {
  const db = getDatabase();

  const results = db.prepare(`
    SELECT market_id, COUNT(*) as count
    FROM trades
    WHERE executed_at >= ? AND executed_at <= ?
      AND status = 'filled'
      AND mode = 'dry_run'
    GROUP BY market_id
  `).all(startDate, endDate) as Array<{ market_id: string; count: number }>;

  const map = new Map<string, number>();
  for (const r of results) {
    map.set(r.market_id, r.count);
  }
  return map;
}

/**
 * Get summary of available dry-run data for a date
 */
export function getDryRunSummaryForDate(date: string): {
  sessionCount: number;
  sessionsWithBots: number;
  totalTrades: number;
  marketIds: string[];
} {
  const sessions = getSessionsForDate(date);
  let sessionsWithBots = 0;
  let totalTrades = 0;
  const marketIds = new Set<string>();

  for (const session of sessions) {
    marketIds.add(session.market_id);
    const bot = findBotForSession(session);
    if (bot) {
      sessionsWithBots++;
      const trades = getTradesForSession(bot.id, session.start_time, session.end_time);
      totalTrades += trades.length;
    }
  }

  return {
    sessionCount: sessions.length,
    sessionsWithBots,
    totalTrades,
    marketIds: Array.from(marketIds),
  };
}
