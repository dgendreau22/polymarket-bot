/**
 * Decision Engine
 *
 * Implements the unwind-first switching logic:
 * - When changing direction (YES->NO or NO->YES), sell existing position first
 * - Then build the new position
 *
 * From spec lines 549-589:
 * if dq > 0:  # Need MORE YES exposure
 *   if inv_no > 0:
 *     SELL NO (unwind)
 *   else:
 *     BUY YES (build)
 *
 * if dq < 0:  # Need MORE NO exposure
 *   if inv_yes > 0:
 *     SELL YES (unwind)
 *   else:
 *     BUY NO (build)
 */

import type { TimeAbove50Config } from './TimeAbove50Config';
import type { ExposureTarget } from './ExposureManager';
import type { PositionDirection } from './TimeAbove50State';

/** Trade action to execute */
export interface TradeAction {
  /** BUY or SELL */
  side: 'BUY' | 'SELL';
  /** YES or NO outcome */
  outcome: 'YES' | 'NO';
  /** Quantity to trade */
  quantity: number;
  /** True if this is an unwind (selling to flatten) */
  isUnwind: boolean;
  /** Description for logging */
  reason: string;
  /** Direction this trade moves us toward */
  targetDirection: PositionDirection;
}

export class DecisionEngine {
  constructor(private config: TimeAbove50Config) {}

  /**
   * Determine the trade action based on exposure target
   */
  decide(
    exposureTarget: ExposureTarget,
    inv_yes: number,
    inv_no: number
  ): TradeAction | null {
    const { dq, shouldAct, E_effective } = exposureTarget;

    // Don't act if change is too small
    if (!shouldAct) {
      return null;
    }

    // Determine direction based on target
    let targetDirection: PositionDirection;
    if (exposureTarget.q_star > this.config.q_step) {
      targetDirection = 'LONG_YES';
    } else if (exposureTarget.q_star < -this.config.q_step) {
      targetDirection = 'LONG_NO';
    } else {
      targetDirection = 'FLAT';
    }

    // dq > 0: Need MORE YES exposure (buy YES or sell NO)
    if (dq > 0) {
      return this.handleNeedMoreYes(dq, inv_no, E_effective, targetDirection);
    }

    // dq < 0: Need MORE NO exposure (buy NO or sell YES)
    if (dq < 0) {
      return this.handleNeedMoreNo(dq, inv_yes, E_effective, targetDirection);
    }

    return null;
  }

  /**
   * Handle case where we need more YES exposure
   *
   * Priority: sell NO first (unwind), then buy YES (build)
   */
  private handleNeedMoreYes(
    dq: number,
    inv_no: number,
    E: number,
    targetDirection: PositionDirection
  ): TradeAction {
    // If we have NO position, sell it first (unwind)
    if (inv_no > 0) {
      const sellQty = Math.min(inv_no, Math.abs(dq));
      return {
        side: 'SELL',
        outcome: 'NO',
        quantity: sellQty,
        isUnwind: true,
        reason: `Unwind: SELL ${sellQty.toFixed(0)} NO (E=${E.toFixed(3)}, dq=+${dq.toFixed(0)})`,
        targetDirection,
      };
    }

    // No NO position to unwind, buy YES instead
    const buyQty = Math.min(this.config.q_step, Math.abs(dq));
    return {
      side: 'BUY',
      outcome: 'YES',
      quantity: buyQty,
      isUnwind: false,
      reason: `Build: BUY ${buyQty.toFixed(0)} YES (E=${E.toFixed(3)}, dq=+${dq.toFixed(0)})`,
      targetDirection,
    };
  }

  /**
   * Handle case where we need more NO exposure
   *
   * Priority: sell YES first (unwind), then buy NO (build)
   */
  private handleNeedMoreNo(
    dq: number,
    inv_yes: number,
    E: number,
    targetDirection: PositionDirection
  ): TradeAction {
    // If we have YES position, sell it first (unwind)
    if (inv_yes > 0) {
      const sellQty = Math.min(inv_yes, Math.abs(dq));
      return {
        side: 'SELL',
        outcome: 'YES',
        quantity: sellQty,
        isUnwind: true,
        reason: `Unwind: SELL ${sellQty.toFixed(0)} YES (E=${E.toFixed(3)}, dq=${dq.toFixed(0)})`,
        targetDirection,
      };
    }

    // No YES position to unwind, buy NO instead
    const buyQty = Math.min(this.config.q_step, Math.abs(dq));
    return {
      side: 'BUY',
      outcome: 'NO',
      quantity: buyQty,
      isUnwind: false,
      reason: `Build: BUY ${buyQty.toFixed(0)} NO (E=${E.toFixed(3)}, dq=${dq.toFixed(0)})`,
      targetDirection,
    };
  }
}
