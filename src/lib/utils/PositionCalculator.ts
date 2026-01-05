/**
 * Position Calculator
 *
 * Centralized position calculation logic for BUY and SELL operations.
 * Ensures consistent calculations across Bot.ts and LimitOrderMatcher.ts.
 */

import { PRECISION } from '../constants';

/**
 * Result of a position update calculation
 */
export interface PositionUpdate {
  newSize: number;
  newAvgPrice: number;
  realizedPnl: number;
}

/**
 * Calculate new position after a BUY trade
 *
 * @param currentSize - Current position size
 * @param currentAvg - Current average entry price
 * @param buySize - Size of the buy trade
 * @param buyPrice - Price of the buy trade
 * @returns Updated position metrics
 */
export function calculateBuyPosition(
  currentSize: number,
  currentAvg: number,
  buySize: number,
  buyPrice: number
): PositionUpdate {
  const newSize = currentSize + buySize;

  // Calculate new weighted average entry price
  const newAvgPrice = currentSize === 0
    ? buyPrice
    : (currentAvg * currentSize + buyPrice * buySize) / newSize;

  return {
    newSize,
    newAvgPrice,
    realizedPnl: 0, // BUY doesn't realize PnL
  };
}

/**
 * Calculate new position after a SELL trade
 *
 * @param currentSize - Current position size
 * @param currentAvg - Current average entry price
 * @param sellSize - Size of the sell trade
 * @param sellPrice - Price of the sell trade
 * @returns Updated position metrics including realized PnL
 */
export function calculateSellPosition(
  currentSize: number,
  currentAvg: number,
  sellSize: number,
  sellPrice: number
): PositionUpdate {
  const actualSellSize = Math.min(sellSize, currentSize);
  const newSize = Math.max(0, currentSize - actualSellSize);

  // Calculate realized PnL: (sell_price - avg_entry_price) * sell_size
  const realizedPnl = (sellPrice - currentAvg) * actualSellSize;

  // Reset avg price if position is fully closed
  const newAvgPrice = newSize <= PRECISION.FLOAT_TOLERANCE ? 0 : currentAvg;

  return {
    newSize,
    newAvgPrice,
    realizedPnl,
  };
}

/**
 * Calculate position update for any trade side
 *
 * @param currentSize - Current position size
 * @param currentAvg - Current average entry price
 * @param tradeSize - Size of the trade
 * @param tradePrice - Price of the trade
 * @param side - 'BUY' or 'SELL'
 * @returns Updated position metrics
 */
export function calculatePositionUpdate(
  currentSize: number,
  currentAvg: number,
  tradeSize: number,
  tradePrice: number,
  side: 'BUY' | 'SELL'
): PositionUpdate {
  if (side === 'BUY') {
    return calculateBuyPosition(currentSize, currentAvg, tradeSize, tradePrice);
  } else {
    return calculateSellPosition(currentSize, currentAvg, tradeSize, tradePrice);
  }
}
