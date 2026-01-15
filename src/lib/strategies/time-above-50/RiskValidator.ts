/**
 * Risk Validator
 *
 * Validates trading actions against risk rules:
 * - Spread gates: block entries when spread too wide
 * - Throttles: enforce rebalance_interval, cooldown, min_hold
 */

import type { TimeAbove50Config } from './TimeAbove50Config';
import type { TimeAbove50State, PositionDirection } from './TimeAbove50State';

/** Result of a risk check */
export interface RiskCheckResult {
  /** True if action is allowed */
  allowed: boolean;
  /** Reason for denial (if not allowed) */
  reason?: string;
}

export class RiskValidator {
  constructor(private config: TimeAbove50Config) {}

  /**
   * Check spread gates
   *
   * - Block new entries if spread_c > spread_max_entry
   * - Block all activity if spread_c > spread_halt
   */
  checkSpreadGates(
    spread_c: number,
    isExpanding: boolean
  ): RiskCheckResult {
    // Halt threshold: block everything
    if (spread_c > this.config.spread_halt) {
      return {
        allowed: false,
        reason: `Spread halt: spread_c=${spread_c.toFixed(4)} > ${this.config.spread_halt}`,
      };
    }

    // Entry threshold: only block expansions
    if (spread_c > this.config.spread_max_entry && isExpanding) {
      return {
        allowed: false,
        reason: `Spread gate: spread_c=${spread_c.toFixed(4)} > ${this.config.spread_max_entry}`,
      };
    }

    return { allowed: true };
  }

  /**
   * Check all throttles (rebalance_interval, cooldown)
   */
  checkThrottles(
    botId: string,
    state: TimeAbove50State,
    now: number
  ): RiskCheckResult {
    // Check rebalance interval
    if (!state.canRebalance(botId, this.config.rebalance_interval, now)) {
      return {
        allowed: false,
        reason: `Rebalance interval: ${this.config.rebalance_interval}s not elapsed`,
      };
    }

    // Check cooldown after fill
    if (!state.isCooldownPassed(botId, this.config.cooldown, now)) {
      return {
        allowed: false,
        reason: `Cooldown: ${this.config.cooldown}s not elapsed since last fill`,
      };
    }

    return { allowed: true };
  }

  /**
   * Check if direction change is allowed (min_hold)
   *
   * Skip check if:
   * - Current direction is FLAT
   * - Proposed direction matches current
   * - This is a risk-reducing action
   */
  checkMinHold(
    botId: string,
    state: TimeAbove50State,
    proposedDirection: PositionDirection,
    isExpanding: boolean,
    now: number
  ): RiskCheckResult {
    const currentDirection = state.getDirection(botId);

    // FLAT can transition to anything
    if (currentDirection === 'FLAT') {
      return { allowed: true };
    }

    // Same direction is always allowed
    if (currentDirection === proposedDirection) {
      return { allowed: true };
    }

    // Risk-reducing (not expanding) actions bypass min_hold
    if (!isExpanding) {
      return { allowed: true };
    }

    // Check min hold for direction flip
    if (!state.canChangeDirection(botId, this.config.min_hold, now)) {
      return {
        allowed: false,
        reason: `Min hold: ${this.config.min_hold}s not elapsed since direction change`,
      };
    }

    return { allowed: true };
  }

  /**
   * Run all risk checks
   */
  validateAll(
    botId: string,
    state: TimeAbove50State,
    spread_c: number,
    isExpanding: boolean,
    proposedDirection: PositionDirection,
    now: number
  ): RiskCheckResult {
    // Check throttles first (most common denial)
    const throttleCheck = this.checkThrottles(botId, state, now);
    if (!throttleCheck.allowed) {
      return throttleCheck;
    }

    // Check spread gates
    const spreadCheck = this.checkSpreadGates(spread_c, isExpanding);
    if (!spreadCheck.allowed) {
      return spreadCheck;
    }

    // Check min hold for direction changes
    const holdCheck = this.checkMinHold(
      botId,
      state,
      proposedDirection,
      isExpanding,
      now
    );
    if (!holdCheck.allowed) {
      return holdCheck;
    }

    return { allowed: true };
  }
}
