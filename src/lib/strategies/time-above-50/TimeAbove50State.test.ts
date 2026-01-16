/**
 * TimeAbove50State Unit Tests
 *
 * Tests for state management:
 * - State initialization (tau=0.5, dbar=0, direction=FLAT)
 * - Tau/dbar updates and clamping
 * - Price history with limit enforcement
 * - Timing: canRebalance, isCooldownPassed, canChangeDirection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TimeAbove50State } from './TimeAbove50State';

describe('TimeAbove50State', () => {
  let state: TimeAbove50State;

  beforeEach(() => {
    state = new TimeAbove50State();
  });

  describe('getState / initializeState', () => {
    it('initializes with default values for new bot', () => {
      const botState = state.getState('new-bot');

      expect(botState.tau).toBe(0.5);
      expect(botState.dbar).toBe(0);
      expect(botState.priceHistory).toEqual([]);
      expect(botState.lastDecisionTime).toBe(0);
      expect(botState.lastFillTime).toBe(0);
      expect(botState.lastDirectionChangeTime).toBe(0);
      expect(botState.currentDirection).toBe('FLAT');
    });

    it('returns same object for same bot', () => {
      const first = state.getState('bot1');
      const second = state.getState('bot1');

      expect(first).toBe(second);
    });

    it('returns different objects for different bots', () => {
      const bot1 = state.getState('bot1');
      const bot2 = state.getState('bot2');

      expect(bot1).not.toBe(bot2);
    });
  });

  describe('updateTau', () => {
    it('updates tau value', () => {
      state.updateTau('bot1', 0.7);
      expect(state.getTau('bot1')).toBe(0.7);
    });

    it('clamps tau to minimum 0', () => {
      state.updateTau('bot1', -0.5);
      expect(state.getTau('bot1')).toBe(0);
    });

    it('clamps tau to maximum 1', () => {
      state.updateTau('bot1', 1.5);
      expect(state.getTau('bot1')).toBe(1);
    });

    it('allows values at boundaries', () => {
      state.updateTau('bot1', 0);
      expect(state.getTau('bot1')).toBe(0);

      state.updateTau('bot1', 1);
      expect(state.getTau('bot1')).toBe(1);
    });
  });

  describe('updateDbar', () => {
    it('updates dbar value', () => {
      state.updateDbar('bot1', 0.15);
      expect(state.getDbar('bot1')).toBe(0.15);
    });

    it('allows negative values', () => {
      state.updateDbar('bot1', -0.2);
      expect(state.getDbar('bot1')).toBe(-0.2);
    });

    it('allows values outside [0,1]', () => {
      // dbar is not clamped like tau
      state.updateDbar('bot1', 0.5);
      expect(state.getDbar('bot1')).toBe(0.5);
    });
  });

  describe('addPricePoint / getPriceHistory', () => {
    it('adds price points to history', () => {
      state.addPricePoint('bot1', 1000, 0.55);
      state.addPricePoint('bot1', 2000, 0.56);

      const history = state.getPriceHistory('bot1', 10, 3000);
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({ timestamp: 1000, price: 0.55 });
      expect(history[1]).toEqual({ timestamp: 2000, price: 0.56 });
    });

    it('filters history by time window', () => {
      const now = 10000;
      state.addPricePoint('bot1', 1000, 0.50);  // 9 seconds ago
      state.addPricePoint('bot1', 5000, 0.52);  // 5 seconds ago
      state.addPricePoint('bot1', 8000, 0.54);  // 2 seconds ago

      // 3 second window
      const recent = state.getPriceHistory('bot1', 3, now);
      expect(recent).toHaveLength(1);
      expect(recent[0].timestamp).toBe(8000);

      // 6 second window
      const longer = state.getPriceHistory('bot1', 6, now);
      expect(longer).toHaveLength(2);
    });

    it('truncates history at MAX_PRICE_HISTORY', () => {
      // Add more than 5000 points
      for (let i = 0; i < 5010; i++) {
        state.addPricePoint('bot1', i * 1000, 0.50 + i * 0.0001);
      }

      const botState = state.getState('bot1');
      expect(botState.priceHistory.length).toBeLessThanOrEqual(5000);
    });

    it('keeps most recent points when truncating', () => {
      for (let i = 0; i < 5010; i++) {
        state.addPricePoint('bot1', i, 0.50 + i * 0.00001);
      }

      const botState = state.getState('bot1');
      // Last point should be the most recent
      const lastPoint = botState.priceHistory[botState.priceHistory.length - 1];
      expect(lastPoint.timestamp).toBe(5009);
    });
  });

  describe('recordDecision / canRebalance', () => {
    it('blocks rebalance within interval', () => {
      const now = 10000;
      state.recordDecision('bot1', now - 1000); // 1 second ago

      // 2 second interval
      const result = state.canRebalance('bot1', 2, now);
      expect(result).toBe(false);
    });

    it('allows rebalance after interval', () => {
      const now = 10000;
      state.recordDecision('bot1', now - 3000); // 3 seconds ago

      const result = state.canRebalance('bot1', 2, now);
      expect(result).toBe(true);
    });

    it('allows for fresh bot (no history)', () => {
      const result = state.canRebalance('bot1', 2, Date.now());
      expect(result).toBe(true);
    });

    it('handles edge case at exactly interval', () => {
      const now = 10000;
      const intervalSeconds = 2;
      state.recordDecision('bot1', now - intervalSeconds * 1000);

      // At exactly the interval, elapsed >= interval*1000
      const result = state.canRebalance('bot1', intervalSeconds, now);
      expect(result).toBe(true);
    });
  });

  describe('recordFill / isCooldownPassed', () => {
    it('blocks during cooldown', () => {
      const now = 10000;
      state.recordFill('bot1', now - 1000); // 1 second ago

      // 2 second cooldown
      const result = state.isCooldownPassed('bot1', 2, now);
      expect(result).toBe(false);
    });

    it('allows after cooldown', () => {
      const now = 10000;
      state.recordFill('bot1', now - 3000); // 3 seconds ago

      const result = state.isCooldownPassed('bot1', 2, now);
      expect(result).toBe(true);
    });

    it('allows for fresh bot', () => {
      const result = state.isCooldownPassed('bot1', 2, Date.now());
      expect(result).toBe(true);
    });
  });

  describe('updateDirection / getDirection / canChangeDirection', () => {
    it('tracks current direction', () => {
      const now = Date.now();
      state.updateDirection('bot1', 'LONG_YES', now);
      expect(state.getDirection('bot1')).toBe('LONG_YES');

      state.updateDirection('bot1', 'LONG_NO', now + 1000);
      expect(state.getDirection('bot1')).toBe('LONG_NO');
    });

    it('records time on direction change', () => {
      const now = 10000;
      state.updateDirection('bot1', 'LONG_YES', now);

      // Can't change immediately
      const result = state.canChangeDirection('bot1', 5, now);
      expect(result).toBe(false);
    });

    it('does not record time when direction same', () => {
      const now = 10000;
      state.updateDirection('bot1', 'LONG_YES', now);

      // Update with same direction later
      state.updateDirection('bot1', 'LONG_YES', now + 5000);

      // Time should still be from first change
      const result = state.canChangeDirection('bot1', 3, now + 2000);
      expect(result).toBe(false); // Only 2 seconds since original change
    });

    it('allows direction change after min_hold', () => {
      const now = 10000;
      state.updateDirection('bot1', 'LONG_YES', now);

      const result = state.canChangeDirection('bot1', 5, now + 6000);
      expect(result).toBe(true);
    });

    it('allows for fresh bot (FLAT)', () => {
      // Fresh bot has lastDirectionChangeTime = 0
      const result = state.canChangeDirection('bot1', 5, Date.now());
      expect(result).toBe(true);
    });

    it('tracks all three directions', () => {
      const now = Date.now();

      state.updateDirection('bot1', 'LONG_YES', now);
      expect(state.getDirection('bot1')).toBe('LONG_YES');

      state.updateDirection('bot1', 'FLAT', now + 1);
      expect(state.getDirection('bot1')).toBe('FLAT');

      state.updateDirection('bot1', 'LONG_NO', now + 2);
      expect(state.getDirection('bot1')).toBe('LONG_NO');
    });
  });

  describe('getTau / getDbar', () => {
    it('returns current tau value', () => {
      state.updateTau('bot1', 0.65);
      expect(state.getTau('bot1')).toBe(0.65);
    });

    it('returns current dbar value', () => {
      state.updateDbar('bot1', 0.08);
      expect(state.getDbar('bot1')).toBe(0.08);
    });

    it('returns initial values for fresh bot', () => {
      expect(state.getTau('new-bot')).toBe(0.5);
      expect(state.getDbar('new-bot')).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('removes all state for a bot', () => {
      state.updateTau('bot1', 0.8);
      state.updateDbar('bot1', 0.1);
      state.updateDirection('bot1', 'LONG_YES', 1000);
      state.addPricePoint('bot1', 1000, 0.55);

      state.cleanup('bot1');

      // Should get fresh state
      expect(state.getTau('bot1')).toBe(0.5);
      expect(state.getDbar('bot1')).toBe(0);
      expect(state.getDirection('bot1')).toBe('FLAT');
      expect(state.getPriceHistory('bot1', 100, 2000)).toHaveLength(0);
    });

    it('does not affect other bots', () => {
      state.updateTau('bot1', 0.8);
      state.updateTau('bot2', 0.3);

      state.cleanup('bot1');

      expect(state.getTau('bot2')).toBe(0.3);
    });

    it('handles cleanup of non-existent bot', () => {
      expect(() => state.cleanup('non-existent')).not.toThrow();
    });
  });
});
