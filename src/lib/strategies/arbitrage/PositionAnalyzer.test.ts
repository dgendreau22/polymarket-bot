/**
 * PositionAnalyzer Unit Tests
 *
 * Tests for position analysis:
 * - calculateEffectiveAvg: Weighted average with pending orders
 * - analyzePositions: Complete position analysis
 */

import { describe, it, expect } from 'vitest';
import { analyzePositions } from './PositionAnalyzer';
import { createMockContext, createMockPosition } from '../__mocks__/contextFactory';

// Helper to test the module-level calculateEffectiveAvg function
// Since it's not exported, we test it through analyzePositions

describe('PositionAnalyzer', () => {
  describe('analyzePositions', () => {
    it('returns correct values for empty positions', () => {
      const context = createMockContext({
        positions: [],
      });
      context.yesPendingBuy = 0;
      context.noPendingBuy = 0;
      context.yesPendingAvgPrice = 0;
      context.noPendingAvgPrice = 0;

      const result = analyzePositions(context, 0.5, 10);

      expect(result.yesFilledSize).toBe(0);
      expect(result.noFilledSize).toBe(0);
      expect(result.yesSize).toBe(0);
      expect(result.noSize).toBe(0);
      expect(result.totalSize).toBe(0);
      expect(result.sizeDiff).toBe(0);
      expect(result.imbalance).toBe(0);
    });

    it('calculates filled positions correctly', () => {
      const context = createMockContext({
        positions: [
          createMockPosition({ outcome: 'YES', size: '100', avgEntryPrice: '0.45' }),
          createMockPosition({ outcome: 'NO', assetId: 'no-asset', size: '80', avgEntryPrice: '0.48' }),
        ],
      });
      context.yesPendingBuy = 0;
      context.noPendingBuy = 0;
      context.yesPendingAvgPrice = 0;
      context.noPendingAvgPrice = 0;

      const result = analyzePositions(context, 0.5, 10);

      expect(result.yesFilledSize).toBe(100);
      expect(result.noFilledSize).toBe(80);
      expect(result.yesFilledAvg).toBeCloseTo(0.45);
      expect(result.noFilledAvg).toBeCloseTo(0.48);
    });

    it('includes pending orders in total size', () => {
      const context = createMockContext({
        positions: [
          createMockPosition({ outcome: 'YES', size: '100', avgEntryPrice: '0.45' }),
          createMockPosition({ outcome: 'NO', assetId: 'no-asset', size: '80', avgEntryPrice: '0.48' }),
        ],
      });
      context.yesPendingBuy = 20;
      context.noPendingBuy = 30;
      context.yesPendingAvgPrice = 0.46;
      context.noPendingAvgPrice = 0.47;

      const result = analyzePositions(context, 0.5, 10);

      expect(result.yesSize).toBe(120); // 100 + 20
      expect(result.noSize).toBe(110); // 80 + 30
      expect(result.totalSize).toBe(230);
    });

    it('calculates effective avg with pending orders', () => {
      const context = createMockContext({
        positions: [
          createMockPosition({ outcome: 'YES', size: '100', avgEntryPrice: '0.40' }),
        ],
      });
      context.yesPendingBuy = 100;
      context.noPendingBuy = 0;
      context.yesPendingAvgPrice = 0.50;
      context.noPendingAvgPrice = 0;

      const result = analyzePositions(context, 0.5, 10);

      // yesAvg = (100 * 0.40 + 100 * 0.50) / 200 = 0.45
      expect(result.yesAvg).toBeCloseTo(0.45);
    });

    it('uses pending avg price when no filled position', () => {
      const context = createMockContext({
        positions: [],
      });
      context.yesPendingBuy = 50;
      context.noPendingBuy = 0;
      context.yesPendingAvgPrice = 0.48;
      context.noPendingAvgPrice = 0;

      const result = analyzePositions(context, 0.5, 10);

      expect(result.yesAvg).toBe(0.48);
    });

    it('calculates imbalance correctly', () => {
      const context = createMockContext({
        positions: [
          createMockPosition({ outcome: 'YES', size: '100', avgEntryPrice: '0.45' }),
          createMockPosition({ outcome: 'NO', assetId: 'no-asset', size: '50', avgEntryPrice: '0.48' }),
        ],
      });
      context.yesPendingBuy = 0;
      context.noPendingBuy = 0;
      context.yesPendingAvgPrice = 0;
      context.noPendingAvgPrice = 0;

      const result = analyzePositions(context, 0.5, 10);

      // sizeDiff = |100 - 50| = 50
      // imbalance = 50 / max(100, 50) = 50 / 100 = 0.5
      expect(result.sizeDiff).toBe(50);
      expect(result.imbalance).toBe(0.5);
    });

    it('identifies large imbalance when above threshold', () => {
      const context = createMockContext({
        positions: [
          createMockPosition({ outcome: 'YES', size: '100', avgEntryPrice: '0.45' }),
          createMockPosition({ outcome: 'NO', assetId: 'no-asset', size: '30', avgEntryPrice: '0.48' }),
        ],
      });
      context.yesPendingBuy = 0;
      context.noPendingBuy = 0;
      context.yesPendingAvgPrice = 0;
      context.noPendingAvgPrice = 0;

      const result = analyzePositions(context, 0.5, 10);

      // imbalance = 70/100 = 0.7 > 0.5
      expect(result.isLargeImbalance).toBe(true);
    });

    it('identifies YES as lagging when YES < NO', () => {
      const context = createMockContext({
        positions: [
          createMockPosition({ outcome: 'YES', size: '50', avgEntryPrice: '0.45' }),
          createMockPosition({ outcome: 'NO', assetId: 'no-asset', size: '100', avgEntryPrice: '0.48' }),
        ],
      });
      context.yesPendingBuy = 0;
      context.noPendingBuy = 0;
      context.yesPendingAvgPrice = 0;
      context.noPendingAvgPrice = 0;

      const result = analyzePositions(context, 0.5, 10);

      expect(result.yesIsLagging).toBe(true);
      expect(result.laggingLeg).toBe('YES');
      expect(result.leadingLeg).toBe('NO');
    });

    it('identifies NO as lagging when NO < YES', () => {
      const context = createMockContext({
        positions: [
          createMockPosition({ outcome: 'YES', size: '100', avgEntryPrice: '0.45' }),
          createMockPosition({ outcome: 'NO', assetId: 'no-asset', size: '50', avgEntryPrice: '0.48' }),
        ],
      });
      context.yesPendingBuy = 0;
      context.noPendingBuy = 0;
      context.yesPendingAvgPrice = 0;
      context.noPendingAvgPrice = 0;

      const result = analyzePositions(context, 0.5, 10);

      expect(result.yesIsLagging).toBe(false);
      expect(result.laggingLeg).toBe('NO');
      expect(result.leadingLeg).toBe('YES');
    });

    it('calculates newDiffIfBuy projections correctly', () => {
      const context = createMockContext({
        positions: [
          createMockPosition({ outcome: 'YES', size: '100', avgEntryPrice: '0.45' }),
          createMockPosition({ outcome: 'NO', assetId: 'no-asset', size: '80', avgEntryPrice: '0.48' }),
        ],
      });
      context.yesPendingBuy = 0;
      context.noPendingBuy = 0;
      context.yesPendingAvgPrice = 0;
      context.noPendingAvgPrice = 0;

      const result = analyzePositions(context, 0.5, 20);

      // Current: YES=100, NO=80, diff=20
      // If buy YES: |(100+20) - 80| = 40
      // If buy NO: |100 - (80+20)| = 0
      expect(result.newDiffIfBuyYes).toBe(40);
      expect(result.newDiffIfBuyNo).toBe(0);
    });

    it('handles single-leg position correctly', () => {
      const context = createMockContext({
        positions: [
          createMockPosition({ outcome: 'YES', size: '100', avgEntryPrice: '0.45' }),
        ],
      });
      context.yesPendingBuy = 0;
      context.noPendingBuy = 0;
      context.yesPendingAvgPrice = 0;
      context.noPendingAvgPrice = 0;

      const result = analyzePositions(context, 0.5, 10);

      expect(result.yesSize).toBe(100);
      expect(result.noSize).toBe(0);
      expect(result.yesIsLagging).toBe(false);
      expect(result.laggingLeg).toBe('NO');
    });

    it('correctly calculates filled diff separate from total diff', () => {
      const context = createMockContext({
        positions: [
          createMockPosition({ outcome: 'YES', size: '100', avgEntryPrice: '0.45' }),
          createMockPosition({ outcome: 'NO', assetId: 'no-asset', size: '100', avgEntryPrice: '0.48' }),
        ],
      });
      // Pending orders create imbalance in totals but not in filled
      context.yesPendingBuy = 50;
      context.noPendingBuy = 0;
      context.yesPendingAvgPrice = 0.46;
      context.noPendingAvgPrice = 0;

      const result = analyzePositions(context, 0.5, 10);

      expect(result.filledDiff).toBe(0); // 100 - 100
      expect(result.sizeDiff).toBe(50);  // 150 - 100
    });

    it('handles equal positions (balanced)', () => {
      const context = createMockContext({
        positions: [
          createMockPosition({ outcome: 'YES', size: '100', avgEntryPrice: '0.45' }),
          createMockPosition({ outcome: 'NO', assetId: 'no-asset', size: '100', avgEntryPrice: '0.48' }),
        ],
      });
      context.yesPendingBuy = 0;
      context.noPendingBuy = 0;
      context.yesPendingAvgPrice = 0;
      context.noPendingAvgPrice = 0;

      const result = analyzePositions(context, 0.5, 10);

      expect(result.sizeDiff).toBe(0);
      expect(result.imbalance).toBe(0);
      expect(result.isLargeImbalance).toBe(false);
      expect(result.yesIsLagging).toBe(true); // When equal, YES is considered "lagging" (<=)
    });
  });
});
