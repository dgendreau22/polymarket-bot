/**
 * Database Schema
 *
 * Defines and initializes the SQLite tables for bot state and trade persistence.
 */

import type Database from 'better-sqlite3';

/**
 * Initialize the database schema
 */
export function initializeSchema(db: Database.Database): void {
  // Bots table: stores bot instances and their current state
  db.exec(`
    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      strategy_slug TEXT NOT NULL,
      market_id TEXT NOT NULL,
      asset_id TEXT,
      mode TEXT NOT NULL CHECK(mode IN ('live', 'dry_run')),
      state TEXT NOT NULL DEFAULT 'stopped' CHECK(state IN ('running', 'stopped', 'paused')),
      config TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      stopped_at TEXT
    )
  `);

  // Trades table: stores all executed trades (live and dry run)
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id),
      strategy_slug TEXT NOT NULL,
      market_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('live', 'dry_run')),
      side TEXT NOT NULL CHECK(side IN ('BUY', 'SELL')),
      outcome TEXT NOT NULL CHECK(outcome IN ('YES', 'NO')),
      price TEXT NOT NULL,
      quantity TEXT NOT NULL,
      total_value TEXT NOT NULL,
      fee TEXT DEFAULT '0',
      pnl TEXT DEFAULT '0',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'filled', 'cancelled', 'failed')),
      order_id TEXT,
      executed_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Positions table: tracks current position per bot
  db.exec(`
    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) UNIQUE,
      market_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('YES', 'NO')),
      size TEXT NOT NULL DEFAULT '0',
      avg_entry_price TEXT NOT NULL DEFAULT '0',
      realized_pnl TEXT NOT NULL DEFAULT '0',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Limit orders table: tracks active limit orders for bots
  db.exec(`
    CREATE TABLE IF NOT EXISTS limit_orders (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('BUY', 'SELL')),
      outcome TEXT NOT NULL CHECK(outcome IN ('YES', 'NO')),
      price TEXT NOT NULL,
      quantity TEXT NOT NULL,
      filled_quantity TEXT NOT NULL DEFAULT '0',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'partially_filled', 'filled', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Create indexes for performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_trades_bot_id ON trades(bot_id);
    CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy_slug);
    CREATE INDEX IF NOT EXISTS idx_trades_executed_at ON trades(executed_at);
    CREATE INDEX IF NOT EXISTS idx_trades_market_id ON trades(market_id);
    CREATE INDEX IF NOT EXISTS idx_bots_state ON bots(state);
    CREATE INDEX IF NOT EXISTS idx_bots_strategy ON bots(strategy_slug);
    CREATE INDEX IF NOT EXISTS idx_limit_orders_bot_id ON limit_orders(bot_id);
    CREATE INDEX IF NOT EXISTS idx_limit_orders_asset_id ON limit_orders(asset_id);
    CREATE INDEX IF NOT EXISTS idx_limit_orders_status ON limit_orders(status);
    CREATE INDEX IF NOT EXISTS idx_limit_orders_price ON limit_orders(price);
  `);

  // Migration: Add market_name column to bots table if it doesn't exist
  try {
    db.exec(`ALTER TABLE bots ADD COLUMN market_name TEXT`);
    console.log('[Schema] Added market_name column to bots table');
  } catch {
    // Column already exists, ignore
  }

  console.log('[Schema] Database tables initialized');
}

/**
 * Drop all tables (for testing/reset)
 */
export function dropAllTables(db: Database.Database): void {
  db.exec(`
    DROP TABLE IF EXISTS limit_orders;
    DROP TABLE IF EXISTS positions;
    DROP TABLE IF EXISTS trades;
    DROP TABLE IF EXISTS bots;
  `);
  console.log('[Schema] All tables dropped');
}
