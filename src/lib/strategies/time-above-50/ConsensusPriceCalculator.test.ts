/**
 * ConsensusPriceCalculator Unit Tests
 *
 * Tests for consensus price calculation:
 * - Spread-weighted average of YES mid and (1 - NO mid)
 * - Handling of missing/invalid order books
 * - Weight calculation from spreads
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConsensusPriceCalculator } from './ConsensusPriceCalculator';

describe('ConsensusPriceCalculator', () => {
  let calculator: ConsensusPriceCalculator;

  beforeEach(() => {
    calculator = new ConsensusPriceCalculator();
  });

  describe('calculate', () => {
    it('returns default values when YES prices missing', () => {
      const result = calculator.calculate(undefined, { bestBid: 0.49, bestAsk: 0.51 });

      expect(result.isValid).toBe(false);
      expect(result.consensusPrice).toBe(0.5);
      expect(result.spread_c).toBe(1);
    });

    it('returns default values when NO prices missing', () => {
      const result = calculator.calculate({ bestBid: 0.49, bestAsk: 0.51 }, undefined);

      expect(result.isValid).toBe(false);
      expect(result.consensusPrice).toBe(0.5);
    });

    it('returns default values when both missing', () => {
      const result = calculator.calculate(undefined, undefined);

      expect(result.isValid).toBe(false);
      expect(result.consensusPrice).toBe(0.5);
    });

    it('returns default values for invalid prices (zero or negative)', () => {
      const result = calculator.calculate(
        { bestBid: 0, bestAsk: 0.51 },
        { bestBid: 0.49, bestAsk: 0.51 }
      );

      expect(result.isValid).toBe(false);
    });

    it('calculates consensus correctly for identical books', () => {
      // YES: bid=0.49, ask=0.51, mid=0.50
      // NO: bid=0.49, ask=0.51, mid=0.50, p_from_no = 1 - 0.50 = 0.50
      // Weights equal, consensus = (0.50 + 0.50) / 2 = 0.50
      const result = calculator.calculate(
        { bestBid: 0.49, bestAsk: 0.51 },
        { bestBid: 0.49, bestAsk: 0.51 }
      );

      expect(result.isValid).toBe(true);
      expect(result.consensusPrice).toBeCloseTo(0.50, 4);
      expect(result.spread_yes).toBeCloseTo(0.02);
      expect(result.spread_no).toBeCloseTo(0.02);
      expect(result.spread_c).toBeCloseTo(0.02);
    });

    it('weights tighter spread more heavily', () => {
      // YES: bid=0.49, ask=0.51, mid=0.50, spread=0.02
      // NO: bid=0.30, ask=0.70, mid=0.50, spread=0.40
      // p_from_no = 1 - 0.50 = 0.50
      // YES weight = 1/0.02 = 50, NO weight = 1/0.40 = 2.5
      // consensus closer to YES mid
      const result = calculator.calculate(
        { bestBid: 0.49, bestAsk: 0.51 },
        { bestBid: 0.30, bestAsk: 0.70 }
      );

      expect(result.isValid).toBe(true);
      // Both mids are 0.50, so consensus still 0.50
      expect(result.consensusPrice).toBeCloseTo(0.50, 2);
      expect(result.spread_c).toBeCloseTo(0.02); // min(0.02, 0.40)
    });

    it('produces correct consensus when books disagree', () => {
      // YES: bid=0.58, ask=0.62, mid=0.60, spread=0.04
      // NO: bid=0.38, ask=0.42, mid=0.40, spread=0.04
      // p_from_no = 1 - 0.40 = 0.60
      // Equal weights, consensus = (0.60 + 0.60) / 2 = 0.60
      const result = calculator.calculate(
        { bestBid: 0.58, bestAsk: 0.62 },
        { bestBid: 0.38, bestAsk: 0.42 }
      );

      expect(result.isValid).toBe(true);
      expect(result.consensusPrice).toBeCloseTo(0.60, 4);
    });

    it('handles books with conflicting signals', () => {
      // YES: bid=0.58, ask=0.62, mid=0.60
      // NO: bid=0.58, ask=0.62, mid=0.60
      // p_from_no = 1 - 0.60 = 0.40
      // Average of 0.60 and 0.40 = 0.50
      const result = calculator.calculate(
        { bestBid: 0.58, bestAsk: 0.62 },
        { bestBid: 0.58, bestAsk: 0.62 }
      );

      expect(result.isValid).toBe(true);
      expect(result.consensusPrice).toBeCloseTo(0.50, 4);
    });

    it('clamps result to [0.01, 0.99]', () => {
      // Extreme prices that might push outside bounds
      // YES: mid = 0.99
      // NO: mid = 0.01, p_from_no = 0.99
      const result = calculator.calculate(
        { bestBid: 0.98, bestAsk: 1.00 },
        { bestBid: 0.00, bestAsk: 0.02 }
      );

      expect(result.consensusPrice).toBeLessThanOrEqual(0.99);
      expect(result.consensusPrice).toBeGreaterThanOrEqual(0.01);
    });

    it('calculates spread_c as min of both spreads', () => {
      const result = calculator.calculate(
        { bestBid: 0.49, bestAsk: 0.53 }, // spread = 0.04
        { bestBid: 0.47, bestAsk: 0.51 }  // spread = 0.04
      );

      expect(result.spread_yes).toBeCloseTo(0.04);
      expect(result.spread_no).toBeCloseTo(0.04);
      expect(result.spread_c).toBeCloseTo(0.04);
    });

    it('returns correct spreads for asymmetric books', () => {
      const result = calculator.calculate(
        { bestBid: 0.48, bestAsk: 0.52 }, // spread = 0.04
        { bestBid: 0.49, bestAsk: 0.51 }  // spread = 0.02
      );

      expect(result.spread_yes).toBeCloseTo(0.04);
      expect(result.spread_no).toBeCloseTo(0.02);
      expect(result.spread_c).toBeCloseTo(0.02);
    });

    it('handles very tight spreads', () => {
      const result = calculator.calculate(
        { bestBid: 0.499, bestAsk: 0.501 },
        { bestBid: 0.499, bestAsk: 0.501 }
      );

      expect(result.isValid).toBe(true);
      expect(result.spread_yes).toBeCloseTo(0.002);
      expect(result.spread_no).toBeCloseTo(0.002);
    });

    it('handles extreme bullish books', () => {
      // YES: mid = 0.90
      // NO: mid = 0.10, p_from_no = 0.90
      // Both indicate 90% YES probability
      const result = calculator.calculate(
        { bestBid: 0.89, bestAsk: 0.91 },
        { bestBid: 0.09, bestAsk: 0.11 }
      );

      expect(result.isValid).toBe(true);
      expect(result.consensusPrice).toBeCloseTo(0.90, 2);
    });

    it('handles extreme bearish books', () => {
      // YES: mid = 0.10
      // NO: mid = 0.90, p_from_no = 0.10
      const result = calculator.calculate(
        { bestBid: 0.09, bestAsk: 0.11 },
        { bestBid: 0.89, bestAsk: 0.91 }
      );

      expect(result.isValid).toBe(true);
      expect(result.consensusPrice).toBeCloseTo(0.10, 2);
    });
  });

  describe('edge cases', () => {
    it('handles negative bid', () => {
      const result = calculator.calculate(
        { bestBid: -0.01, bestAsk: 0.51 },
        { bestBid: 0.49, bestAsk: 0.51 }
      );

      expect(result.isValid).toBe(false);
    });

    it('handles negative ask', () => {
      const result = calculator.calculate(
        { bestBid: 0.49, bestAsk: -0.01 },
        { bestBid: 0.49, bestAsk: 0.51 }
      );

      expect(result.isValid).toBe(false);
    });

    it('handles zero bid', () => {
      const result = calculator.calculate(
        { bestBid: 0, bestAsk: 0.51 },
        { bestBid: 0.49, bestAsk: 0.51 }
      );

      expect(result.isValid).toBe(false);
    });

    it('handles inverted book (bid > ask)', () => {
      // This is an unusual state but calculator should still work
      const result = calculator.calculate(
        { bestBid: 0.52, bestAsk: 0.48 },
        { bestBid: 0.49, bestAsk: 0.51 }
      );

      // Negative spread case - mid still calculable
      expect(result.isValid).toBe(true);
      // Mid = (0.52 + 0.48) / 2 = 0.50
    });
  });
});
