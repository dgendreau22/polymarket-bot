/**
 * Price Validator
 *
 * Validates whether trades maintain profitability constraints:
 * - Combined average cost < profit threshold
 * - Individual leg prices within acceptable ranges
 */

import type { PositionAnalysis } from './PositionAnalyzer';

/**
 * Validates trade prices against profitability constraints
 */
export class PriceValidator {
  constructor(
    private profitThreshold: number,
    private maxSingleLegPrice: number
  ) {}

  /**
   * Calculate projected average after adding new position
   */
  private getProjectedAvg(
    currentSize: number,
    currentAvg: number,
    addSize: number,
    addPrice: number
  ): number {
    if (currentSize + addSize === 0) return 0;
    return (currentSize * currentAvg + addSize * addPrice) / (currentSize + addSize);
  }

  /**
   * Check if buying at price would keep combined avg cost under threshold
   * Returns true if the trade would be profitable
   */
  wouldCostBeValid(
    analysis: PositionAnalysis,
    leg: 'YES' | 'NO',
    addSize: number,
    addPrice: number
  ): boolean {
    let projectedYesAvg = analysis.yesAvg;
    let projectedNoAvg = analysis.noAvg;

    if (leg === 'YES') {
      projectedYesAvg = this.getProjectedAvg(analysis.yesSize, analysis.yesAvg, addSize, addPrice);
    } else {
      projectedNoAvg = this.getProjectedAvg(analysis.noSize, analysis.noAvg, addSize, addPrice);
    }

    const combinedAvg = projectedYesAvg + projectedNoAvg;

    if (combinedAvg >= this.profitThreshold) {
      console.log(`[Arb] BLOCKED: Projected combined $${combinedAvg.toFixed(3)} >= $${this.profitThreshold}`);
      return false;
    }
    return true;
  }

  /**
   * Check if a leg's entry price is acceptable based on profit constraints
   *
   * - If other leg has position: dynamic ceiling = profitThreshold - otherLegAvg - 0.01
   * - If no other leg: absolute ceiling = maxSingleLegPrice
   */
  isLegPriceAcceptable(
    leg: 'YES' | 'NO',
    price: number,
    otherLegAvg: number
  ): boolean {
    // If we have other leg position, use dynamic ceiling
    if (otherLegAvg > 0) {
      const maxPrice = this.profitThreshold - otherLegAvg - 0.01; // 1c buffer
      if (price > maxPrice) {
        return false;
      }
      return true;
    }

    // No other leg yet - use absolute ceiling
    if (price > this.maxSingleLegPrice) {
      return false;
    }
    return true;
  }
}
