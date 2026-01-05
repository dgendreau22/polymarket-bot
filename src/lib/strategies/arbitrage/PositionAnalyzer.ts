/**
 * Position Analyzer
 *
 * Analyzes YES/NO positions and pending orders to produce
 * a comprehensive view of the current portfolio state.
 */

import type { StrategyContext } from '../../bots/types';

/**
 * Complete analysis of current positions
 */
export interface PositionAnalysis {
  // Filled positions only
  yesFilledSize: number;
  noFilledSize: number;
  yesFilledAvg: number;
  noFilledAvg: number;

  // Total including pending orders
  yesSize: number;
  noSize: number;

  // Effective averages (filled + pending weighted)
  yesAvg: number;
  noAvg: number;

  // Imbalance metrics
  totalSize: number;
  sizeDiff: number;
  filledDiff: number;
  imbalance: number;         // 0-1 ratio of imbalance
  isLargeImbalance: boolean;

  // Leg classification
  yesIsLagging: boolean;
  laggingLeg: 'YES' | 'NO';
  leadingLeg: 'YES' | 'NO';

  // Position limits
  newDiffIfBuyYes: number;
  newDiffIfBuyNo: number;
  newFilledDiffIfBuyYes: number;
  newFilledDiffIfBuyNo: number;
}

/**
 * Calculate effective average including pending orders
 */
function calculateEffectiveAvg(
  filledSize: number,
  filledAvg: number,
  pendingSize: number,
  pendingAvgPrice: number
): number {
  if (filledSize > 0) {
    if (pendingSize > 0) {
      return (filledSize * filledAvg + pendingSize * pendingAvgPrice) / (filledSize + pendingSize);
    }
    return filledAvg;
  }
  return pendingAvgPrice;
}

/**
 * Analyze positions from strategy context
 */
export function analyzePositions(
  context: StrategyContext,
  imbalanceThreshold: number,
  orderSize: number
): PositionAnalysis {
  const { positions } = context;

  // Extract filled positions
  const yesPosition = positions?.find(p => p.outcome === 'YES');
  const noPosition = positions?.find(p => p.outcome === 'NO');

  const yesFilledSize = yesPosition ? parseFloat(yesPosition.size) : 0;
  const noFilledSize = noPosition ? parseFloat(noPosition.size) : 0;
  const yesFilledAvg = yesPosition ? parseFloat(yesPosition.avgEntryPrice) : 0;
  const noFilledAvg = noPosition ? parseFloat(noPosition.avgEntryPrice) : 0;

  // Get pending order quantities
  const yesPendingBuy = context.yesPendingBuy ?? 0;
  const noPendingBuy = context.noPendingBuy ?? 0;
  const yesPendingAvgPrice = context.yesPendingAvgPrice ?? 0;
  const noPendingAvgPrice = context.noPendingAvgPrice ?? 0;

  // Total sizes including pending
  const yesSize = yesFilledSize + yesPendingBuy;
  const noSize = noFilledSize + noPendingBuy;

  // Effective averages
  const yesAvg = calculateEffectiveAvg(yesFilledSize, yesFilledAvg, yesPendingBuy, yesPendingAvgPrice);
  const noAvg = calculateEffectiveAvg(noFilledSize, noFilledAvg, noPendingBuy, noPendingAvgPrice);

  // Imbalance metrics
  const totalSize = yesSize + noSize;
  const sizeDiff = Math.abs(yesSize - noSize);
  const filledDiff = Math.abs(yesFilledSize - noFilledSize);
  const imbalance = totalSize > 0 ? sizeDiff / Math.max(yesSize, noSize, 1) : 0;
  const isLargeImbalance = imbalance > imbalanceThreshold && totalSize > 0;

  // Leg classification
  const yesIsLagging = yesSize <= noSize;
  const laggingLeg: 'YES' | 'NO' = yesIsLagging ? 'YES' : 'NO';
  const leadingLeg: 'YES' | 'NO' = yesIsLagging ? 'NO' : 'YES';

  // Projected differences if we buy each leg
  const newDiffIfBuyYes = Math.abs((yesSize + orderSize) - noSize);
  const newDiffIfBuyNo = Math.abs(yesSize - (noSize + orderSize));
  const newFilledDiffIfBuyYes = Math.abs((yesFilledSize + orderSize) - noFilledSize);
  const newFilledDiffIfBuyNo = Math.abs(yesFilledSize - (noFilledSize + orderSize));

  return {
    yesFilledSize,
    noFilledSize,
    yesFilledAvg,
    noFilledAvg,
    yesSize,
    noSize,
    yesAvg,
    noAvg,
    totalSize,
    sizeDiff,
    filledDiff,
    imbalance,
    isLargeImbalance,
    yesIsLagging,
    laggingLeg,
    leadingLeg,
    newDiffIfBuyYes,
    newDiffIfBuyNo,
    newFilledDiffIfBuyYes,
    newFilledDiffIfBuyNo,
  };
}
