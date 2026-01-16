/**
 * PriceValidator Unit Tests
 *
 * Tests for price validation against profitability constraints:
 * - getProjectedAvg: Weighted average projection
 * - wouldCostBeValid: Combined cost validation
 * - isLegPriceAcceptable: Per-leg price ceilings
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PriceValidator } from './PriceValidator';
import type { PositionAnalysis } from './PositionAnalyzer';

describe('PriceValidator', () => {
  let validator: PriceValidator;
  const profitThreshold = 0.98;
  const maxSingleLegPrice = 0.75;

  beforeEach(() => {
    validator = new PriceValidator(profitThreshold, maxSingleLegPrice);
  });

  // Helper to access private methods
  const getPrivate = (v: PriceValidator) => v as unknown as {
    getProjectedAvg(currentSize: number, currentAvg: number, addSize: number, addPrice: number): number;
  };

  // Helper to create mock PositionAnalysis
  const createAnalysis = (overrides: Partial<PositionAnalysis> = {}): PositionAnalysis => ({
    yesFilledSize: 0,
    noFilledSize: 0,
    yesFilledAvg: 0,
    noFilledAvg: 0,
    yesSize: 0,
    noSize: 0,
    yesAvg: 0,
    noAvg: 0,
    totalSize: 0,
    sizeDiff: 0,
    filledDiff: 0,
    imbalance: 0,
    isLargeImbalance: false,
    yesIsLagging: true,
    laggingLeg: 'YES',
    leadingLeg: 'NO',
    newDiffIfBuyYes: 0,
    newDiffIfBuyNo: 0,
    newFilledDiffIfBuyYes: 0,
    newFilledDiffIfBuyNo: 0,
    ...overrides,
  });

  describe('getProjectedAvg', () => {
    it('returns weighted average correctly', () => {
      const priv = getPrivate(validator);
      // Current: 100 @ 0.40
      // Adding: 50 @ 0.50
      // Expected: (100*0.40 + 50*0.50) / 150 = (40 + 25) / 150 = 0.433...
      const result = priv.getProjectedAvg(100, 0.40, 50, 0.50);
      expect(result).toBeCloseTo(65 / 150, 10);
    });

    it('returns addPrice when currentSize is 0', () => {
      const priv = getPrivate(validator);
      const result = priv.getProjectedAvg(0, 0, 50, 0.45);
      expect(result).toBe(0.45);
    });

    it('returns currentAvg when addSize is 0', () => {
      const priv = getPrivate(validator);
      const result = priv.getProjectedAvg(100, 0.40, 0, 0);
      expect(result).toBeCloseTo(0.40, 10);
    });

    it('returns 0 when both sizes are 0', () => {
      const priv = getPrivate(validator);
      const result = priv.getProjectedAvg(0, 0, 0, 0);
      expect(result).toBe(0);
    });

    it('handles equal sizes correctly', () => {
      const priv = getPrivate(validator);
      // Equal sizes: average of the two prices
      const result = priv.getProjectedAvg(100, 0.40, 100, 0.50);
      expect(result).toBeCloseTo(0.45, 10);
    });
  });

  describe('wouldCostBeValid', () => {
    it('returns true when combined avg < profitThreshold', () => {
      const analysis = createAnalysis({
        yesSize: 100,
        yesAvg: 0.45,
        noSize: 100,
        noAvg: 0.45,
      });

      // Buying YES at 0.46: new YES avg ~0.455
      // Combined: 0.455 + 0.45 = 0.905 < 0.98
      const result = validator.wouldCostBeValid(analysis, 'YES', 10, 0.46);
      expect(result).toBe(true);
    });

    it('returns false when combined avg >= profitThreshold', () => {
      const analysis = createAnalysis({
        yesSize: 100,
        yesAvg: 0.48,
        noSize: 100,
        noAvg: 0.48,
      });

      // Already at 0.48 + 0.48 = 0.96
      // Buying YES at 0.60: new YES avg > 0.48
      // Combined would exceed 0.98
      const result = validator.wouldCostBeValid(analysis, 'YES', 100, 0.60);
      expect(result).toBe(false);
    });

    it('validates YES leg correctly', () => {
      const analysis = createAnalysis({
        yesSize: 50,
        yesAvg: 0.40,
        noSize: 100,
        noAvg: 0.45,
      });

      // Buying 50 YES at 0.50: projected YES avg = (50*0.40 + 50*0.50)/100 = 0.45
      // Combined: 0.45 + 0.45 = 0.90 < 0.98
      const result = validator.wouldCostBeValid(analysis, 'YES', 50, 0.50);
      expect(result).toBe(true);
    });

    it('validates NO leg correctly', () => {
      const analysis = createAnalysis({
        yesSize: 100,
        yesAvg: 0.45,
        noSize: 50,
        noAvg: 0.40,
      });

      // Buying 50 NO at 0.50: projected NO avg = (50*0.40 + 50*0.50)/100 = 0.45
      // Combined: 0.45 + 0.45 = 0.90 < 0.98
      const result = validator.wouldCostBeValid(analysis, 'NO', 50, 0.50);
      expect(result).toBe(true);
    });

    it('handles edge case at exactly threshold', () => {
      // Create situation where combined = exactly 0.98
      const analysis = createAnalysis({
        yesSize: 100,
        yesAvg: 0.49,
        noSize: 100,
        noAvg: 0.49,
      });

      // Combined = 0.98, adding any would exceed
      const result = validator.wouldCostBeValid(analysis, 'YES', 10, 0.49);
      // Projected YES = (100*0.49 + 10*0.49)/110 = 0.49
      // Combined = 0.49 + 0.49 = 0.98, should be false (>= threshold)
      expect(result).toBe(false);
    });

    it('handles first entry (no existing position)', () => {
      const analysis = createAnalysis({
        yesSize: 0,
        yesAvg: 0,
        noSize: 0,
        noAvg: 0,
      });

      // First entry at 0.45
      const result = validator.wouldCostBeValid(analysis, 'YES', 100, 0.45);
      // Combined = 0.45 + 0 = 0.45 < 0.98
      expect(result).toBe(true);
    });
  });

  describe('isLegPriceAcceptable', () => {
    it('uses dynamic ceiling when other leg has position', () => {
      // Other leg (NO) has avg of 0.45
      // Dynamic ceiling = 0.98 - 0.45 - 0.01 = 0.52
      const result = validator.isLegPriceAcceptable('YES', 0.50, 0.45);
      expect(result).toBe(true);
    });

    it('rejects when price exceeds dynamic ceiling', () => {
      // Other leg at 0.50
      // Dynamic ceiling = 0.98 - 0.50 - 0.01 = 0.47
      const result = validator.isLegPriceAcceptable('YES', 0.50, 0.50);
      expect(result).toBe(false);
    });

    it('uses absolute ceiling (maxSingleLegPrice) when no other leg', () => {
      // No other leg (otherLegAvg = 0)
      // Should use maxSingleLegPrice = 0.75
      const result = validator.isLegPriceAcceptable('YES', 0.70, 0);
      expect(result).toBe(true);
    });

    it('rejects when exceeding absolute ceiling', () => {
      const result = validator.isLegPriceAcceptable('YES', 0.80, 0);
      expect(result).toBe(false);
    });

    it('works symmetrically for NO leg', () => {
      // YES leg at 0.45
      // Dynamic ceiling = 0.98 - 0.45 - 0.01 = 0.52
      const accept = validator.isLegPriceAcceptable('NO', 0.50, 0.45);
      const reject = validator.isLegPriceAcceptable('NO', 0.55, 0.45);

      expect(accept).toBe(true);
      expect(reject).toBe(false);
    });

    it('handles edge case at exactly the ceiling', () => {
      // Other leg at 0.45
      // Ceiling = 0.98 - 0.45 - 0.01 = 0.52
      const atCeiling = validator.isLegPriceAcceptable('YES', 0.52, 0.45);
      const aboveCeiling = validator.isLegPriceAcceptable('YES', 0.521, 0.45);

      expect(atCeiling).toBe(true); // <= ceiling is acceptable
      expect(aboveCeiling).toBe(false); // > ceiling is rejected
    });

    it('handles very low other leg avg', () => {
      // Other leg at 0.10
      // Ceiling = 0.98 - 0.10 - 0.01 = 0.87
      const result = validator.isLegPriceAcceptable('YES', 0.80, 0.10);
      expect(result).toBe(true);
    });

    it('handles high other leg avg (tight constraint)', () => {
      // Other leg at 0.80
      // Ceiling = 0.98 - 0.80 - 0.01 = 0.17
      const result = validator.isLegPriceAcceptable('YES', 0.20, 0.80);
      expect(result).toBe(false);
    });
  });

  describe('integration scenarios', () => {
    it('validates complete arbitrage entry scenario', () => {
      // Initial entry: buy YES at 0.48
      const analysis1 = createAnalysis({
        yesSize: 0,
        yesAvg: 0,
        noSize: 0,
        noAvg: 0,
      });

      expect(validator.isLegPriceAcceptable('YES', 0.48, 0)).toBe(true);
      expect(validator.wouldCostBeValid(analysis1, 'YES', 100, 0.48)).toBe(true);

      // Second entry: buy NO at 0.48
      const analysis2 = createAnalysis({
        yesSize: 100,
        yesAvg: 0.48,
        noSize: 0,
        noAvg: 0,
      });

      // Dynamic ceiling for NO = 0.98 - 0.48 - 0.01 = 0.49
      expect(validator.isLegPriceAcceptable('NO', 0.48, 0.48)).toBe(true);
      expect(validator.wouldCostBeValid(analysis2, 'NO', 100, 0.48)).toBe(true);

      // Final combined: 0.48 + 0.48 = 0.96 < 0.98
    });

    it('blocks unprofitable continuation', () => {
      // Already have positions at high cost
      const analysis = createAnalysis({
        yesSize: 100,
        yesAvg: 0.49,
        noSize: 100,
        noAvg: 0.49,
      });

      // Combined already at 0.98
      // Buying more YES at HIGHER price would push combined over threshold
      // New YES avg = (100*0.49 + 100*0.52)/200 = 0.505
      // Combined = 0.505 + 0.49 = 0.995 >= 0.98
      expect(validator.wouldCostBeValid(analysis, 'YES', 100, 0.52)).toBe(false);
    });
  });
});
