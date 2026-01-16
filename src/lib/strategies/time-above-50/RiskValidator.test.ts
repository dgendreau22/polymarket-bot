/**
 * RiskValidator Unit Tests
 *
 * Tests for risk validation:
 * - Spread gates: block entries when spread too wide
 * - Throttles: rebalance_interval, cooldown
 * - Min hold: direction change restrictions
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RiskValidator } from './RiskValidator';
import { TimeAbove50State } from './TimeAbove50State';
import { DEFAULT_CONFIG, type TimeAbove50Config } from './TimeAbove50Config';

describe('RiskValidator', () => {
  let validator: RiskValidator;
  let state: TimeAbove50State;
  let config: TimeAbove50Config;

  beforeEach(() => {
    config = { ...DEFAULT_CONFIG };
    validator = new RiskValidator(config);
    state = new TimeAbove50State();
  });

  describe('checkSpreadGates', () => {
    it('blocks all activity when spread_c > spread_halt', () => {
      const result = validator.checkSpreadGates(
        config.spread_halt + 0.01, // Above halt threshold
        false // Not expanding
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Spread halt');
    });

    it('blocks expansions when spread_c > spread_max_entry', () => {
      const result = validator.checkSpreadGates(
        config.spread_max_entry + 0.01, // Above entry threshold but below halt
        true // Expanding
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Spread gate');
    });

    it('allows reductions even with wide spread', () => {
      const result = validator.checkSpreadGates(
        config.spread_max_entry + 0.005, // Above entry but below halt
        false // Not expanding (reducing)
      );

      expect(result.allowed).toBe(true);
    });

    it('allows all activity when spread_c <= spread_max_entry', () => {
      const result = validator.checkSpreadGates(
        config.spread_max_entry - 0.01,
        true // Expanding
      );

      expect(result.allowed).toBe(true);
    });

    it('handles edge case at exactly spread_halt', () => {
      const result = validator.checkSpreadGates(
        config.spread_halt,
        false
      );

      // At exactly the threshold, should be blocked (> comparison)
      expect(result.allowed).toBe(true); // Not > threshold
    });

    it('handles edge case at exactly spread_max_entry', () => {
      const result = validator.checkSpreadGates(
        config.spread_max_entry,
        true
      );

      expect(result.allowed).toBe(true); // Not > threshold
    });
  });

  describe('checkThrottles', () => {
    const botId = 'test-bot';

    it('blocks when rebalance_interval not elapsed', () => {
      const now = Date.now();
      state.recordDecision(botId, now - 1000); // 1 second ago

      const result = validator.checkThrottles(botId, state, now);

      // rebalance_interval is 2 seconds, so should be blocked
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Rebalance interval');
    });

    it('allows when rebalance_interval elapsed', () => {
      const now = Date.now();
      state.recordDecision(botId, now - 3000); // 3 seconds ago

      const result = validator.checkThrottles(botId, state, now);

      expect(result.allowed).toBe(true);
    });

    it('blocks when cooldown not elapsed', () => {
      const now = Date.now();
      state.recordDecision(botId, now - 10000); // Long ago
      state.recordFill(botId, now - 1000); // 1 second ago

      const result = validator.checkThrottles(botId, state, now);

      // cooldown is 2 seconds
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Cooldown');
    });

    it('allows when cooldown elapsed', () => {
      const now = Date.now();
      state.recordDecision(botId, now - 10000);
      state.recordFill(botId, now - 3000);

      const result = validator.checkThrottles(botId, state, now);

      expect(result.allowed).toBe(true);
    });

    it('allows for fresh bot (no history)', () => {
      const now = Date.now();

      const result = validator.checkThrottles(botId, state, now);

      expect(result.allowed).toBe(true);
    });
  });

  describe('checkMinHold', () => {
    const botId = 'test-bot';

    it('allows any transition from FLAT', () => {
      const now = Date.now();
      state.updateDirection(botId, 'FLAT', now);

      const result = validator.checkMinHold(
        botId,
        state,
        'LONG_YES',
        true, // Expanding
        now
      );

      expect(result.allowed).toBe(true);
    });

    it('allows same direction', () => {
      const now = Date.now();
      state.updateDirection(botId, 'LONG_YES', now - 1000);

      const result = validator.checkMinHold(
        botId,
        state,
        'LONG_YES', // Same direction
        true,
        now
      );

      expect(result.allowed).toBe(true);
    });

    it('allows reductions even for direction change', () => {
      const now = Date.now();
      state.updateDirection(botId, 'LONG_YES', now - 1000);

      const result = validator.checkMinHold(
        botId,
        state,
        'LONG_NO', // Different direction
        false, // Not expanding (reducing)
        now
      );

      expect(result.allowed).toBe(true);
    });

    it('blocks direction change expansion within min_hold', () => {
      const now = Date.now();
      state.updateDirection(botId, 'LONG_YES', now - 5000); // 5 seconds ago

      const result = validator.checkMinHold(
        botId,
        state,
        'LONG_NO', // Different direction
        true, // Expanding
        now
      );

      // min_hold is 15 seconds
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Min hold');
    });

    it('allows direction change after min_hold', () => {
      const now = Date.now();
      state.updateDirection(botId, 'LONG_YES', now - 20000); // 20 seconds ago

      const result = validator.checkMinHold(
        botId,
        state,
        'LONG_NO',
        true,
        now
      );

      expect(result.allowed).toBe(true);
    });

    it('allows LONG_YES to FLAT transition', () => {
      const now = Date.now();
      state.updateDirection(botId, 'LONG_YES', now - 1000);

      const result = validator.checkMinHold(
        botId,
        state,
        'FLAT',
        false, // Flattening is reduction
        now
      );

      expect(result.allowed).toBe(true);
    });
  });

  describe('validateAll', () => {
    const botId = 'test-bot';

    it('passes all checks for valid conditions', () => {
      const now = Date.now();
      state.recordDecision(botId, now - 10000);
      state.recordFill(botId, now - 10000);
      state.updateDirection(botId, 'FLAT', now - 30000);

      const result = validator.validateAll(
        botId,
        state,
        0.01, // Normal spread
        true,
        'LONG_YES',
        now
      );

      expect(result.allowed).toBe(true);
    });

    it('fails on throttle first', () => {
      const now = Date.now();
      state.recordDecision(botId, now - 100); // Very recent

      const result = validator.validateAll(
        botId,
        state,
        0.01,
        true,
        'LONG_YES',
        now
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Rebalance interval');
    });

    it('fails on spread gate after throttle passes', () => {
      const now = Date.now();
      state.recordDecision(botId, now - 10000);
      state.recordFill(botId, now - 10000);

      const result = validator.validateAll(
        botId,
        state,
        config.spread_halt + 0.01, // Wide spread
        true,
        'LONG_YES',
        now
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Spread halt');
    });

    it('fails on min_hold after spread passes', () => {
      const now = Date.now();
      state.recordDecision(botId, now - 10000);
      state.recordFill(botId, now - 10000);
      state.updateDirection(botId, 'LONG_YES', now - 5000);

      const result = validator.validateAll(
        botId,
        state,
        0.01,
        true, // Expanding
        'LONG_NO', // Direction change
        now
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Min hold');
    });

    it('returns detailed reason for each failure type', () => {
      const now = Date.now();

      // Test cooldown message
      state.recordDecision(botId, now - 10000);
      state.recordFill(botId, now - 500);

      const result = validator.validateAll(
        botId,
        state,
        0.01,
        true,
        'LONG_YES',
        now
      );

      expect(result.reason).toContain('Cooldown');
      expect(result.reason).toContain(`${config.cooldown}s`);
    });
  });
});
