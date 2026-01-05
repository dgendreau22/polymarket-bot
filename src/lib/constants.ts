/**
 * Application Constants
 *
 * Centralized constants to avoid magic numbers scattered across the codebase.
 */

/**
 * Timing constants (milliseconds)
 */
export const TIMING = {
  /** Execution cycle interval for bots (30 seconds) */
  EXECUTION_CYCLE_MS: 30000,

  /** Interval for checking market status (60 seconds) */
  MARKET_CHECK_INTERVAL_MS: 60000,

  /** Minimum interval between market searches (5 seconds) */
  MIN_SEARCH_INTERVAL_MS: 5000,

  /** Market search interval (30 seconds) */
  SEARCH_INTERVAL_MS: 30000,

  /** WebSocket reconnect interval (5 seconds) */
  WS_RECONNECT_INTERVAL_MS: 5000,

  /** Default WebSocket max reconnect attempts */
  WS_MAX_RECONNECT_ATTEMPTS: 10,
} as const;

/**
 * Precision constants for floating point comparisons
 */
export const PRECISION = {
  /** Tolerance for floating point equality checks */
  FLOAT_TOLERANCE: 0.000001,
} as const;

/**
 * Order matching constants
 */
export const ORDER_MATCHING = {
  /** Tolerance for considering an order fully filled */
  FILL_TOLERANCE: 0.000001,
} as const;
