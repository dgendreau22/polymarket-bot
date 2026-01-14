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

  // ============================================================================
  // Data Recorder Tables (for market data analysis)
  // ============================================================================

  // Recording sessions: tracks each market recording session
  db.exec(`
    CREATE TABLE IF NOT EXISTS recording_sessions (
      id TEXT PRIMARY KEY,
      market_id TEXT NOT NULL,
      market_name TEXT NOT NULL,
      event_slug TEXT NOT NULL,
      yes_asset_id TEXT NOT NULL,
      no_asset_id TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      tick_count INTEGER NOT NULL DEFAULT 0,
      snapshot_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT
    )
  `);

  // Market ticks: raw tick data (every price change)
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_ticks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES recording_sessions(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('YES', 'NO')),
      timestamp TEXT NOT NULL,
      price TEXT NOT NULL,
      size TEXT NOT NULL DEFAULT '0',
      side TEXT NOT NULL CHECK(side IN ('BUY', 'SELL')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Market snapshots: order book snapshots (every 15 seconds)
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_snapshots (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES recording_sessions(id) ON DELETE CASCADE,
      timestamp TEXT NOT NULL,
      yes_best_bid TEXT,
      yes_best_ask TEXT,
      no_best_bid TEXT,
      no_best_ask TEXT,
      yes_bid_depth TEXT,
      yes_ask_depth TEXT,
      no_bid_depth TEXT,
      no_ask_depth TEXT,
      combined_cost TEXT,
      spread TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Indexes for data recorder tables
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_recording_sessions_market ON recording_sessions(market_id);
    CREATE INDEX IF NOT EXISTS idx_recording_sessions_event_slug ON recording_sessions(event_slug);
    CREATE INDEX IF NOT EXISTS idx_market_ticks_session ON market_ticks(session_id);
    CREATE INDEX IF NOT EXISTS idx_market_ticks_timestamp ON market_ticks(timestamp);
    CREATE INDEX IF NOT EXISTS idx_market_ticks_asset ON market_ticks(asset_id);
    CREATE INDEX IF NOT EXISTS idx_market_ticks_outcome ON market_ticks(outcome);
    CREATE INDEX IF NOT EXISTS idx_market_snapshots_session ON market_snapshots(session_id);
    CREATE INDEX IF NOT EXISTS idx_market_snapshots_timestamp ON market_snapshots(timestamp);
  `);

  // Migration: Add market_name column to bots table if it doesn't exist
  try {
    db.exec(`ALTER TABLE bots ADD COLUMN market_name TEXT`);
    console.log('[Schema] Added market_name column to bots table');
  } catch {
    // Column already exists, ignore
  }

  // Migration: Add no_asset_id column to bots table for dual-asset trading
  try {
    db.exec(`ALTER TABLE bots ADD COLUMN no_asset_id TEXT`);
    console.log('[Schema] Added no_asset_id column to bots table');
  } catch {
    // Column already exists, ignore
  }

  // Migration: Allow multiple positions per bot (for dual-asset YES/NO legs)
  // SQLite doesn't allow dropping constraints, so we need to recreate the table
  try {
    // Check if old table has UNIQUE on bot_id (by checking if we can create the new index)
    db.exec(`CREATE UNIQUE INDEX idx_positions_bot_asset ON positions(bot_id, asset_id)`);
    console.log('[Schema] Added unique index on positions(bot_id, asset_id)');

    // If we got here, the new index was created. Now we need to drop the old UNIQUE constraint.
    // Create new table without UNIQUE on bot_id
    db.exec(`
      CREATE TABLE IF NOT EXISTS positions_new (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL REFERENCES bots(id),
        market_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('YES', 'NO')),
        size TEXT NOT NULL DEFAULT '0',
        avg_entry_price TEXT NOT NULL DEFAULT '0',
        realized_pnl TEXT NOT NULL DEFAULT '0',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Copy data from old table
    db.exec(`INSERT INTO positions_new SELECT * FROM positions`);

    // Drop old table and rename new one
    db.exec(`DROP TABLE positions`);
    db.exec(`ALTER TABLE positions_new RENAME TO positions`);

    // Recreate the unique index on the new table
    db.exec(`CREATE UNIQUE INDEX idx_positions_bot_asset ON positions(bot_id, asset_id)`);

    console.log('[Schema] Migrated positions table to allow multiple positions per bot');
  } catch {
    // Index already exists or migration already done, ignore
  }

  // Migration: Add 'settlement' status to trades table
  // SQLite doesn't allow modifying CHECK constraints, so we recreate the table
  try {
    // Check if we need to migrate by trying to see if 'settlement' status exists
    // We do this by checking the table schema
    const tableInfo = db.prepare(`PRAGMA table_info(trades)`).all() as Array<{ name: string; type: string }>;
    const needsMigration = tableInfo.length > 0;

    if (needsMigration) {
      // Try inserting a test row with 'settlement' status to see if constraint allows it
      const testStmt = db.prepare(`
        INSERT INTO trades (id, bot_id, strategy_slug, market_id, asset_id, mode, side, outcome, price, quantity, total_value, status)
        VALUES ('__test_settlement__', '__test__', '__test__', '__test__', '__test__', 'dry_run', 'SELL', 'YES', '0', '0', '0', 'settlement')
      `);
      try {
        testStmt.run();
        // If successful, delete the test row - constraint already allows 'settlement'
        db.exec(`DELETE FROM trades WHERE id = '__test_settlement__'`);
      } catch {
        // Constraint failed - need to migrate
        console.log('[Schema] Migrating trades table to add settlement status...');

        // Create new table with updated CHECK constraint
        db.exec(`
          CREATE TABLE IF NOT EXISTS trades_new (
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
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'filled', 'cancelled', 'failed', 'settlement')),
            order_id TEXT,
            executed_at TEXT NOT NULL DEFAULT (datetime('now')),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);

        // Copy data from old table
        db.exec(`INSERT INTO trades_new SELECT * FROM trades`);

        // Drop old table and rename new one
        db.exec(`DROP TABLE trades`);
        db.exec(`ALTER TABLE trades_new RENAME TO trades`);

        // Recreate indexes
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_trades_bot_id ON trades(bot_id);
          CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy_slug);
          CREATE INDEX IF NOT EXISTS idx_trades_executed_at ON trades(executed_at);
          CREATE INDEX IF NOT EXISTS idx_trades_market_id ON trades(market_id);
        `);

        console.log('[Schema] Migrated trades table to include settlement status');
      }
    }
  } catch (error) {
    // Migration already done or table doesn't exist yet, ignore
    console.log('[Schema] Trades settlement migration skipped:', error);
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
    DROP TABLE IF EXISTS market_snapshots;
    DROP TABLE IF EXISTS market_ticks;
    DROP TABLE IF EXISTS recording_sessions;
  `);
  console.log('[Schema] All tables dropped');
}
