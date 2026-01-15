/**
 * TimeAbove50 Strategy State Management
 *
 * Manages per-bot state including:
 * - tau: Time-above estimator [0,1]
 * - dbar: Smoothed displacement
 * - Price history for chop calculation
 * - Timing state for throttles
 * - Direction tracking for min_hold enforcement
 */

/** Price history entry */
export interface PricePoint {
  timestamp: number;
  price: number;
}

/** Direction of current position */
export type PositionDirection = 'LONG_YES' | 'LONG_NO' | 'FLAT';

/** Per-bot state */
export interface BotState {
  // Signal state
  tau: number;                    // Time-above estimator [0,1]
  dbar: number;                   // Smoothed displacement
  priceHistory: PricePoint[];     // Rolling price history for chop

  // Timing state
  lastDecisionTime: number;       // For rebalance_interval throttle
  lastFillTime: number;           // For cooldown after fills
  lastDirectionChangeTime: number; // For min_hold enforcement

  // Direction tracking
  currentDirection: PositionDirection;
}

/** Max price history length (prevent memory exhaustion) */
const MAX_PRICE_HISTORY = 5000;

/**
 * Manages per-bot state for the TimeAbove50 strategy
 */
export class TimeAbove50State {
  private stateMap: Map<string, BotState> = new Map();

  /**
   * Get state for a bot, initializing if needed
   */
  getState(botId: string): BotState {
    if (!this.stateMap.has(botId)) {
      this.initializeState(botId);
    }
    return this.stateMap.get(botId)!;
  }

  /**
   * Initialize state with defaults
   */
  initializeState(botId: string): void {
    this.stateMap.set(botId, {
      tau: 0.5,          // Neutral starting point
      dbar: 0,           // No displacement
      priceHistory: [],
      lastDecisionTime: 0,
      lastFillTime: 0,
      lastDirectionChangeTime: 0,
      currentDirection: 'FLAT',
    });
  }

  /**
   * Update tau (time-above estimator)
   */
  updateTau(botId: string, newTau: number): void {
    const state = this.getState(botId);
    state.tau = Math.max(0, Math.min(1, newTau));
  }

  /**
   * Update dbar (smoothed displacement)
   */
  updateDbar(botId: string, newDbar: number): void {
    const state = this.getState(botId);
    state.dbar = newDbar;
  }

  /**
   * Add a price point to history
   */
  addPricePoint(botId: string, timestamp: number, price: number): void {
    const state = this.getState(botId);

    // Append new point
    state.priceHistory.push({ timestamp, price });

    // Truncate if too long (keep most recent)
    if (state.priceHistory.length > MAX_PRICE_HISTORY) {
      state.priceHistory = state.priceHistory.slice(-MAX_PRICE_HISTORY);
    }
  }

  /**
   * Get price history within a time window
   */
  getPriceHistory(botId: string, windowSeconds: number, now: number): PricePoint[] {
    const state = this.getState(botId);
    const cutoff = now - windowSeconds * 1000;
    return state.priceHistory.filter(p => p.timestamp >= cutoff);
  }

  /**
   * Record that a decision was made
   */
  recordDecision(botId: string, timestamp: number): void {
    const state = this.getState(botId);
    state.lastDecisionTime = timestamp;
  }

  /**
   * Record that a fill occurred
   */
  recordFill(botId: string, timestamp: number): void {
    const state = this.getState(botId);
    state.lastFillTime = timestamp;
  }

  /**
   * Update current direction and record time if changed
   */
  updateDirection(botId: string, newDirection: PositionDirection, timestamp: number): void {
    const state = this.getState(botId);
    if (state.currentDirection !== newDirection) {
      state.lastDirectionChangeTime = timestamp;
      state.currentDirection = newDirection;
    }
  }

  /**
   * Check if rebalance interval has passed
   */
  canRebalance(botId: string, intervalSeconds: number, now: number): boolean {
    const state = this.getState(botId);
    return now - state.lastDecisionTime >= intervalSeconds * 1000;
  }

  /**
   * Check if cooldown has passed
   */
  isCooldownPassed(botId: string, cooldownSeconds: number, now: number): boolean {
    const state = this.getState(botId);
    return now - state.lastFillTime >= cooldownSeconds * 1000;
  }

  /**
   * Check if min hold has passed for direction change
   */
  canChangeDirection(
    botId: string,
    minHoldSeconds: number,
    now: number
  ): boolean {
    const state = this.getState(botId);
    return now - state.lastDirectionChangeTime >= minHoldSeconds * 1000;
  }

  /**
   * Get current direction
   */
  getDirection(botId: string): PositionDirection {
    return this.getState(botId).currentDirection;
  }

  /**
   * Get tau value
   */
  getTau(botId: string): number {
    return this.getState(botId).tau;
  }

  /**
   * Get dbar value
   */
  getDbar(botId: string): number {
    return this.getState(botId).dbar;
  }

  /**
   * Clean up state for a deleted bot (prevents memory leaks)
   */
  cleanup(botId: string): void {
    this.stateMap.delete(botId);
  }
}
