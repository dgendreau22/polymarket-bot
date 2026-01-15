/**
 * SQLite Database Connection
 *
 * Provides a singleton database connection for persisting bot state and trades.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { initializeSchema } from './schema';
import { log } from '@/lib/logger';

// Use global to persist across Next.js hot reloads in development
const globalForDb = globalThis as unknown as {
  db: Database.Database | undefined;
};

/**
 * Get the database instance (singleton)
 */
export function getDatabase(): Database.Database {
  if (!globalForDb.db) {
    const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'polymarket-bot.db');

    globalForDb.db = new Database(dbPath);

    // Enable WAL mode for better concurrent access
    globalForDb.db.pragma('journal_mode = WAL');

    // Initialize schema if needed
    initializeSchema(globalForDb.db);

    log('Database', `Connected to SQLite at ${dbPath}`);
  }

  return globalForDb.db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (globalForDb.db) {
    globalForDb.db.close();
    globalForDb.db = undefined;
    log('Database', 'Connection closed');
  }
}

/**
 * Run a transaction
 */
export function runTransaction<T>(fn: (db: Database.Database) => T): T {
  const database = getDatabase();
  return database.transaction(fn)(database);
}
