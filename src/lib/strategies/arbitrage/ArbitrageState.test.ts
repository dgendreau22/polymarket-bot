/**
 * ArbitrageState Unit Tests
 *
 * Tests for state management:
 * - Cooldown tracking per leg
 * - Round-robin leg selection
 * - State initialization and cleanup
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ArbitrageState } from './ArbitrageState';

describe('ArbitrageState', () => {
  let state: ArbitrageState;

  beforeEach(() => {
    state = new ArbitrageState();
  });

  describe('getCooldowns', () => {
    it('initializes cooldown state for new bot', () => {
      const cooldowns = state.getCooldowns('new-bot');

      expect(cooldowns.lastYesTime).toBe(0);
      expect(cooldowns.lastNoTime).toBe(0);
    });

    it('returns same object for same bot', () => {
      const first = state.getCooldowns('bot1');
      const second = state.getCooldowns('bot1');

      expect(first).toBe(second);
    });

    it('returns different objects for different bots', () => {
      const bot1 = state.getCooldowns('bot1');
      const bot2 = state.getCooldowns('bot2');

      expect(bot1).not.toBe(bot2);
    });
  });

  describe('recordOrder', () => {
    it('updates lastYesTime for YES leg', () => {
      const timestamp = 1000000;
      state.recordOrder('bot1', 'YES', timestamp);

      const cooldowns = state.getCooldowns('bot1');
      expect(cooldowns.lastYesTime).toBe(timestamp);
      expect(cooldowns.lastNoTime).toBe(0);
    });

    it('updates lastNoTime for NO leg', () => {
      const timestamp = 2000000;
      state.recordOrder('bot1', 'NO', timestamp);

      const cooldowns = state.getCooldowns('bot1');
      expect(cooldowns.lastNoTime).toBe(timestamp);
      expect(cooldowns.lastYesTime).toBe(0);
    });

    it('uses current time when timestamp not provided', () => {
      const before = Date.now();
      state.recordOrder('bot1', 'YES');
      const after = Date.now();

      const cooldowns = state.getCooldowns('bot1');
      expect(cooldowns.lastYesTime).toBeGreaterThanOrEqual(before);
      expect(cooldowns.lastYesTime).toBeLessThanOrEqual(after);
    });

    it('tracks last bought leg', () => {
      state.recordOrder('bot1', 'YES');
      expect(state.getNextLegRoundRobin('bot1')).toBe('NO');

      state.recordOrder('bot1', 'NO');
      expect(state.getNextLegRoundRobin('bot1')).toBe('YES');
    });
  });

  describe('isOnCooldown', () => {
    it('returns false when no order recorded', () => {
      const result = state.isOnCooldown('bot1', 'YES', 1000);
      expect(result).toBe(false);
    });

    it('returns true within cooldown period', () => {
      const now = Date.now();
      state.recordOrder('bot1', 'YES', now - 500);

      const result = state.isOnCooldown('bot1', 'YES', 1000, now);
      expect(result).toBe(true);
    });

    it('returns false after cooldown period', () => {
      const now = Date.now();
      state.recordOrder('bot1', 'YES', now - 2000);

      const result = state.isOnCooldown('bot1', 'YES', 1000, now);
      expect(result).toBe(false);
    });

    it('checks correct leg independently', () => {
      const now = Date.now();
      state.recordOrder('bot1', 'YES', now - 500);

      expect(state.isOnCooldown('bot1', 'YES', 1000, now)).toBe(true);
      expect(state.isOnCooldown('bot1', 'NO', 1000, now)).toBe(false);
    });

    it('handles edge case at exactly cooldown boundary', () => {
      const now = Date.now();
      const cooldownMs = 1000;
      state.recordOrder('bot1', 'YES', now - cooldownMs);

      // At exactly the boundary, elapsed == cooldownMs, not < cooldownMs
      const result = state.isOnCooldown('bot1', 'YES', cooldownMs, now);
      expect(result).toBe(false);
    });
  });

  describe('areBothOnCooldown', () => {
    it('returns false when neither on cooldown', () => {
      const result = state.areBothOnCooldown('bot1', 1000);
      expect(result).toBe(false);
    });

    it('returns false when only YES on cooldown', () => {
      const now = Date.now();
      state.recordOrder('bot1', 'YES', now - 500);

      const result = state.areBothOnCooldown('bot1', 1000, now);
      expect(result).toBe(false);
    });

    it('returns false when only NO on cooldown', () => {
      const now = Date.now();
      state.recordOrder('bot1', 'NO', now - 500);

      const result = state.areBothOnCooldown('bot1', 1000, now);
      expect(result).toBe(false);
    });

    it('returns true when both on cooldown', () => {
      const now = Date.now();
      state.recordOrder('bot1', 'YES', now - 500);
      state.recordOrder('bot1', 'NO', now - 300);

      const result = state.areBothOnCooldown('bot1', 1000, now);
      expect(result).toBe(true);
    });

    it('returns false when one leg expired', () => {
      const now = Date.now();
      state.recordOrder('bot1', 'YES', now - 2000); // Expired
      state.recordOrder('bot1', 'NO', now - 500);   // Still on cooldown

      const result = state.areBothOnCooldown('bot1', 1000, now);
      expect(result).toBe(false);
    });
  });

  describe('getNextLegRoundRobin', () => {
    it('returns YES for fresh bot (default NO was last)', () => {
      const result = state.getNextLegRoundRobin('new-bot');
      expect(result).toBe('YES');
    });

    it('alternates after YES order', () => {
      state.recordOrder('bot1', 'YES');
      expect(state.getNextLegRoundRobin('bot1')).toBe('NO');
    });

    it('alternates after NO order', () => {
      state.recordOrder('bot1', 'NO');
      expect(state.getNextLegRoundRobin('bot1')).toBe('YES');
    });

    it('correctly alternates through multiple orders', () => {
      state.recordOrder('bot1', 'YES');
      expect(state.getNextLegRoundRobin('bot1')).toBe('NO');

      state.recordOrder('bot1', 'NO');
      expect(state.getNextLegRoundRobin('bot1')).toBe('YES');

      state.recordOrder('bot1', 'YES');
      expect(state.getNextLegRoundRobin('bot1')).toBe('NO');
    });

    it('maintains state per bot', () => {
      state.recordOrder('bot1', 'YES');
      state.recordOrder('bot2', 'NO');

      expect(state.getNextLegRoundRobin('bot1')).toBe('NO');
      expect(state.getNextLegRoundRobin('bot2')).toBe('YES');
    });
  });

  describe('cleanup', () => {
    it('removes all state for a bot', () => {
      state.recordOrder('bot1', 'YES', 1000);
      state.recordOrder('bot1', 'NO', 2000);

      state.cleanup('bot1');

      // After cleanup, should get fresh state
      const cooldowns = state.getCooldowns('bot1');
      expect(cooldowns.lastYesTime).toBe(0);
      expect(cooldowns.lastNoTime).toBe(0);
      expect(state.getNextLegRoundRobin('bot1')).toBe('YES');
    });

    it('does not affect other bots', () => {
      state.recordOrder('bot1', 'YES', 1000);
      state.recordOrder('bot2', 'NO', 2000);

      state.cleanup('bot1');

      const bot2Cooldowns = state.getCooldowns('bot2');
      expect(bot2Cooldowns.lastNoTime).toBe(2000);
    });

    it('handles cleanup of non-existent bot', () => {
      // Should not throw
      expect(() => state.cleanup('non-existent')).not.toThrow();
    });
  });
});
