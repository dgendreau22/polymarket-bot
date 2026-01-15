/**
 * Signal Factory
 *
 * Creates StrategySignal objects with properly formatted prices.
 * Uses tick-size rounding to prevent order rejection.
 */

import type { StrategySignal } from '../../bots/types';
import type { TradeAction } from './DecisionEngine';

export class SignalFactory {
  /**
   * Create a StrategySignal from a trade action
   */
  createSignal(
    action: TradeAction,
    yesPrices: { bestBid: number; bestAsk: number },
    noPrices: { bestBid: number; bestAsk: number },
    tickSize: number,
    edgeScore: number
  ): StrategySignal {
    // Get the appropriate price based on side and outcome
    const orderPrice = this.getOrderPrice(
      action.side,
      action.outcome,
      yesPrices,
      noPrices
    );

    // Round to tick size
    const price = this.roundToTick(orderPrice, tickSize);

    // Calculate confidence based on edge strength
    const confidence = this.calculateConfidence(edgeScore, action.isUnwind);

    return {
      action: action.side,
      side: action.outcome,
      price,
      quantity: String(action.quantity),
      reason: action.reason,
      confidence,
    };
  }

  /**
   * Determine order price based on side and outcome
   *
   * Maker-only (passive) strategy:
   * - BUY orders: Place at best bid (provide liquidity, wait to be filled)
   * - SELL orders: Place at best ask (provide liquidity, wait to be filled)
   *
   * Orders sit in the book and may not fill immediately.
   */
  private getOrderPrice(
    side: 'BUY' | 'SELL',
    outcome: 'YES' | 'NO',
    yesPrices: { bestBid: number; bestAsk: number },
    noPrices: { bestBid: number; bestAsk: number }
  ): number {
    const prices = outcome === 'YES' ? yesPrices : noPrices;

    if (side === 'BUY') {
      // BUY: place at best bid (passive maker order)
      return prices.bestBid;
    } else {
      // SELL: place at best ask (passive maker order)
      return prices.bestAsk;
    }
  }

  /**
   * Round price to tick size with proper decimal places
   */
  private roundToTick(price: number, tickSize: number): string {
    // Validate tickSize to prevent division by zero
    const safeTickSize = tickSize > 0 ? tickSize : 0.01;
    const rounded = Math.round(price / safeTickSize) * safeTickSize;
    const decimals = safeTickSize >= 1 ? 0 : Math.max(0, Math.ceil(-Math.log10(safeTickSize)));
    return rounded.toFixed(decimals);
  }

  /**
   * Calculate confidence based on edge strength
   *
   * - Unwinds get high confidence (risk-reducing)
   * - Strong edge (|E| > 0.25) gets high confidence
   * - Weak edge gets moderate confidence
   */
  private calculateConfidence(edgeScore: number, isUnwind: boolean): number {
    if (isUnwind) {
      // Unwinds are always high confidence (risk-reducing)
      return 0.95;
    }

    const absE = Math.abs(edgeScore);
    if (absE >= 0.25) {
      return 0.90;
    } else if (absE >= 0.18) {
      return 0.80;
    } else {
      return 0.70;
    }
  }
}
