import type { Position } from './types';

/**
 * Calculate realized PnL from positions array
 */
export function calculateRealizedPnl(positions: Position[]): number {
  return positions.reduce((sum, p) => sum + parseFloat(p.realizedPnl), 0);
}

/**
 * Calculate unrealized PnL for a single position
 */
export function calculatePositionUnrealizedPnl(
  size: number,
  avgEntryPrice: number,
  currentPrice: number
): number {
  if (size <= 0 || currentPrice <= 0) return 0;
  return (currentPrice - avgEntryPrice) * size;
}

/**
 * Calculate total unrealized PnL from positions with current prices
 */
export function calculateUnrealizedPnl(
  positions: Position[],
  yesCurrentPrice: number,
  noCurrentPrice: number
): number {
  let totalUnrealized = 0;

  for (const pos of positions) {
    const size = parseFloat(pos.size);
    const avgEntry = parseFloat(pos.avgEntryPrice);

    if (size <= 0) continue;

    const currentPrice = pos.outcome === 'YES' ? yesCurrentPrice : noCurrentPrice;

    if (currentPrice > 0) {
      totalUnrealized += (currentPrice - avgEntry) * size;
    }
  }

  return totalUnrealized;
}

/**
 * Calculate average entry price from positions
 * - Single leg (YES or NO only): returns that leg's avg price
 * - Arbitrage (YES AND NO): returns sum of both avg prices (combined cost per pair)
 */
export function calculateAvgPrice(positions: Position[]): number {
  const yesPos = positions.find(p => p.outcome === 'YES');
  const noPos = positions.find(p => p.outcome === 'NO');

  const yesSize = yesPos ? parseFloat(yesPos.size) : 0;
  const noSize = noPos ? parseFloat(noPos.size) : 0;
  const yesAvg = yesPos ? parseFloat(yesPos.avgEntryPrice) : 0;
  const noAvg = noPos ? parseFloat(noPos.avgEntryPrice) : 0;

  // If both YES and NO positions exist (arbitrage), return sum
  if (yesSize > 0 && noSize > 0) {
    return yesAvg + noAvg;
  }

  // Single leg: return that leg's avg price
  if (yesSize > 0) return yesAvg;
  if (noSize > 0) return noAvg;

  return 0;
}

/**
 * Calculate total PnL (realized + unrealized)
 */
export function calculateTotalPnl(
  positions: Position[],
  yesCurrentPrice: number,
  noCurrentPrice: number
): { realized: number; unrealized: number; total: number } {
  const realized = calculateRealizedPnl(positions);
  const unrealized = calculateUnrealizedPnl(positions, yesCurrentPrice, noCurrentPrice);
  return {
    realized,
    unrealized,
    total: realized + unrealized,
  };
}
