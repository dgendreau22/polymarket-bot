/**
 * Centralized logging system with tag-based filtering.
 *
 * Configuration is loaded from:
 * 1. data/log-config.json (hot-reloadable, server-side only)
 * 2. Environment variables (fallback)
 *
 * Usage:
 *   import { log, warn, error, debug } from '@/lib/logger';
 *   log('Bot', 'Starting bot...');
 *   warn('API', 'Request failed', { status: 500 });
 */

// Types
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogConfig {
  enabled: string[];   // Tags to show (empty = all)
  disabled: string[];  // Tags to hide (takes precedence)
  level: LogLevel;     // Minimum level (default: 'info')
}

// Log level priorities
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Default configuration
const DEFAULT_CONFIG: LogConfig = {
  enabled: [],
  disabled: [],
  level: 'info',
};

// Check if we're running on the server
const isServer = typeof window === 'undefined';

// Singleton state using globalThis for Next.js hot reload persistence
const GLOBAL_KEY = '__polymarket_logger__';

interface LoggerState {
  config: LogConfig;
  lastConfigLoad: number;
  watcherInitialized: boolean;
}

/**
 * Load configuration from file (server-only) or env vars
 */
function loadConfigSync(): LogConfig {
  // Only try file loading on server
  if (isServer) {
    try {
      // Dynamic import to avoid bundling fs in client code
      const fs = require('fs');
      const path = require('path');
      const configPath = path.join(process.cwd(), 'data', 'log-config.json');

      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(content);
        return {
          enabled: Array.isArray(parsed.enabled) ? parsed.enabled : [],
          disabled: Array.isArray(parsed.disabled) ? parsed.disabled : [],
          level: isValidLogLevel(parsed.level) ? parsed.level : 'info',
        };
      }
    } catch {
      // Fall through to env vars
    }
  }

  // Fall back to environment variables (works on both server and client)
  // Note: On client, process.env values are replaced at build time
  return {
    enabled: parseEnvList(process.env.NEXT_PUBLIC_LOG_ENABLED || process.env.LOG_ENABLED),
    disabled: parseEnvList(process.env.NEXT_PUBLIC_LOG_DISABLED || process.env.LOG_DISABLED),
    level: isValidLogLevel(process.env.NEXT_PUBLIC_LOG_LEVEL || process.env.LOG_LEVEL)
      ? (process.env.NEXT_PUBLIC_LOG_LEVEL || process.env.LOG_LEVEL) as LogLevel
      : 'info',
  };
}

/**
 * Parse comma-separated env var into array
 */
function parseEnvList(value: string | undefined): string[] {
  if (!value || value.trim() === '') return [];
  return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Check if a value is a valid log level
 */
function isValidLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && ['debug', 'info', 'warn', 'error'].includes(value);
}

function getState(): LoggerState {
  if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
    (globalThis as Record<string, unknown>)[GLOBAL_KEY] = {
      config: loadConfigSync(),
      lastConfigLoad: Date.now(),
      watcherInitialized: false,
    };
    initFileWatcher();
  }
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as LoggerState;
}

/**
 * Initialize file watcher for hot reload (server-only)
 */
function initFileWatcher(): void {
  if (!isServer) return; // Skip on client

  const state = (globalThis as Record<string, unknown>)[GLOBAL_KEY] as LoggerState;
  if (!state || state.watcherInitialized) return;
  state.watcherInitialized = true;

  try {
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(process.cwd(), 'data', 'log-config.json');

    // Use fs.watchFile for polling-based watching (more reliable across platforms)
    fs.watchFile(configPath, { interval: 2000 }, () => {
      reloadConfig();
    });
  } catch {
    // Watching failed, config changes will require restart
  }
}

/**
 * Reload configuration from file
 */
export function reloadConfig(): void {
  const state = getState();
  state.config = loadConfigSync();
  state.lastConfigLoad = Date.now();
}

/**
 * Get current configuration
 */
export function getConfig(): LogConfig {
  return { ...getState().config };
}

/**
 * Check if a tag should be logged based on current config
 */
function shouldLog(tag: string, level: LogLevel): boolean {
  const state = getState();
  const config = state.config;

  // Check log level first
  if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[config.level]) {
    return false;
  }

  // Check disabled list (takes precedence)
  if (config.disabled.length > 0) {
    for (const disabled of config.disabled) {
      if (tagMatches(tag, disabled)) {
        return false;
      }
    }
  }

  // Check enabled list (if non-empty, only show enabled tags)
  if (config.enabled.length > 0) {
    for (const enabled of config.enabled) {
      if (tagMatches(tag, enabled)) {
        return true;
      }
    }
    return false; // Not in enabled list
  }

  return true; // Show all by default
}

/**
 * Check if a tag matches a pattern
 * Supports partial matching: "Bot" matches "Bot", "Bot:abc123", etc.
 */
function tagMatches(tag: string, pattern: string): boolean {
  // Exact match
  if (tag === pattern) return true;
  // Pattern is prefix (e.g., "Bot" matches "Bot:abc123")
  if (tag.startsWith(pattern + ':') || tag.startsWith(pattern + ' ')) return true;
  // Tag starts with pattern
  if (tag.startsWith(pattern)) return true;
  return false;
}

/**
 * Format log message with tag
 */
function formatMessage(tag: string, message: string): string {
  return `[${tag}] ${message}`;
}

/**
 * Core logging function
 */
function logWithLevel(level: LogLevel, tag: string, message: string, ...args: unknown[]): void {
  if (!shouldLog(tag, level)) return;

  const formatted = formatMessage(tag, message);

  switch (level) {
    case 'debug':
    case 'info':
      console.log(formatted, ...args);
      break;
    case 'warn':
      console.warn(formatted, ...args);
      break;
    case 'error':
      console.error(formatted, ...args);
      break;
  }
}

// Public API

/**
 * Log an info message
 */
export function log(tag: string, message: string, ...args: unknown[]): void {
  logWithLevel('info', tag, message, ...args);
}

/**
 * Log a debug message
 */
export function debug(tag: string, message: string, ...args: unknown[]): void {
  logWithLevel('debug', tag, message, ...args);
}

/**
 * Log a warning message
 */
export function warn(tag: string, message: string, ...args: unknown[]): void {
  logWithLevel('warn', tag, message, ...args);
}

/**
 * Log an error message
 */
export function error(tag: string, message: string, ...args: unknown[]): void {
  logWithLevel('error', tag, message, ...args);
}

/**
 * Create a tagged logger for a specific component
 * Useful for reducing repetition when logging from a single file
 */
export function createLogger(defaultTag: string) {
  return {
    log: (message: string, ...args: unknown[]) => log(defaultTag, message, ...args),
    debug: (message: string, ...args: unknown[]) => debug(defaultTag, message, ...args),
    warn: (message: string, ...args: unknown[]) => warn(defaultTag, message, ...args),
    error: (message: string, ...args: unknown[]) => error(defaultTag, message, ...args),
    // Allow overriding tag for specific messages
    withTag: (tag: string) => ({
      log: (message: string, ...args: unknown[]) => log(tag, message, ...args),
      debug: (message: string, ...args: unknown[]) => debug(tag, message, ...args),
      warn: (message: string, ...args: unknown[]) => warn(tag, message, ...args),
      error: (message: string, ...args: unknown[]) => error(tag, message, ...args),
    }),
  };
}
