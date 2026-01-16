/**
 * TimeAbove50 DecisionEngine Unit Tests
 *
 * Tests for unwind-first switching logic:
 * - Sell opposite leg before building new position
 * - Direction classification (LONG_YES, LONG_NO, FLAT)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DecisionEngine } from './DecisionEngine';
import { DEFAULT_CONFIG, type TimeAbove50Config } from './TimeAbove50Config';
import type { ExposureTarget } from './ExposureManager';

describe('TimeAbove50 DecisionEngine', () => {
  let engine: DecisionEngine;
  let config: TimeAbove50Config;

  beforeEach(() => {
    config = { ...DEFAULT_CONFIG };
    engine = new DecisionEngine(config);
  });

  // Helper to create exposure target
  const createExposureTarget = (overrides: Partial<ExposureTarget> = {}): ExposureTarget => ({
    q_star: 0,
    q_current: 0,
    dq: 0,
    shouldAct: false,
    isExpanding: false,
    E_effective: 0,
    ...overrides,
  });

  describe('decide basics', () => {
    it('returns null when shouldAct is false', () => {
      const target = createExposureTarget({ shouldAct: false, dq: 5 });

      const result = engine.decide(target, 0, 0);

      expect(result).toBeNull();
    });

    it('returns null when dq is 0', () => {
      const target = createExposureTarget({ shouldAct: true, dq: 0 });

      const result = engine.decide(target, 0, 0);

      expect(result).toBeNull();
    });
  });

  describe('dq > 0: Need more YES exposure', () => {
    it('sells NO first when inv_no > 0 (unwind)', () => {
      const target = createExposureTarget({
        q_star: 50,
        q_current: 0,
        dq: 50,
        shouldAct: true,
        E_effective: 0.3,
      });

      const result = engine.decide(target, 0, 30); // inv_no = 30

      expect(result).not.toBeNull();
      expect(result!.side).toBe('SELL');
      expect(result!.outcome).toBe('NO');
      expect(result!.isUnwind).toBe(true);
      expect(result!.quantity).toBe(30); // Min of inv_no and dq
    });

    it('buys YES when no NO position to unwind', () => {
      const target = createExposureTarget({
        q_star: 50,
        q_current: 0,
        dq: 50,
        shouldAct: true,
        E_effective: 0.3,
      });

      const result = engine.decide(target, 0, 0); // No NO position

      expect(result).not.toBeNull();
      expect(result!.side).toBe('BUY');
      expect(result!.outcome).toBe('YES');
      expect(result!.isUnwind).toBe(false);
    });

    it('limits sell quantity to available NO position', () => {
      const target = createExposureTarget({
        q_star: 100,
        q_current: -50,
        dq: 150, // Need 150 more YES
        shouldAct: true,
        E_effective: 0.4,
      });

      const result = engine.decide(target, 0, 30); // Only 30 NO to sell

      expect(result!.quantity).toBe(30);
    });

    it('limits buy quantity to q_step', () => {
      const target = createExposureTarget({
        q_star: 100,
        q_current: 0,
        dq: 100,
        shouldAct: true,
        E_effective: 0.4,
      });

      const result = engine.decide(target, 0, 0);

      expect(result!.quantity).toBe(config.q_step);
    });
  });

  describe('dq < 0: Need more NO exposure', () => {
    it('sells YES first when inv_yes > 0 (unwind)', () => {
      const target = createExposureTarget({
        q_star: -50,
        q_current: 0,
        dq: -50,
        shouldAct: true,
        E_effective: -0.3,
      });

      const result = engine.decide(target, 30, 0); // inv_yes = 30

      expect(result).not.toBeNull();
      expect(result!.side).toBe('SELL');
      expect(result!.outcome).toBe('YES');
      expect(result!.isUnwind).toBe(true);
      expect(result!.quantity).toBe(30);
    });

    it('buys NO when no YES position to unwind', () => {
      const target = createExposureTarget({
        q_star: -50,
        q_current: 0,
        dq: -50,
        shouldAct: true,
        E_effective: -0.3,
      });

      const result = engine.decide(target, 0, 0);

      expect(result).not.toBeNull();
      expect(result!.side).toBe('BUY');
      expect(result!.outcome).toBe('NO');
      expect(result!.isUnwind).toBe(false);
    });

    it('limits sell quantity to available YES position', () => {
      const target = createExposureTarget({
        q_star: -100,
        q_current: 50,
        dq: -150,
        shouldAct: true,
        E_effective: -0.4,
      });

      const result = engine.decide(target, 20, 0); // Only 20 YES to sell

      expect(result!.quantity).toBe(20);
    });
  });

  describe('Direction classification', () => {
    it('classifies LONG_YES when q_star > q_step', () => {
      const target = createExposureTarget({
        q_star: 50, // > q_step (10)
        q_current: 0,
        dq: 50,
        shouldAct: true,
        E_effective: 0.3,
      });

      const result = engine.decide(target, 0, 0);

      expect(result!.targetDirection).toBe('LONG_YES');
    });

    it('classifies LONG_NO when q_star < -q_step', () => {
      const target = createExposureTarget({
        q_star: -50, // < -q_step
        q_current: 0,
        dq: -50,
        shouldAct: true,
        E_effective: -0.3,
      });

      const result = engine.decide(target, 0, 0);

      expect(result!.targetDirection).toBe('LONG_NO');
    });

    it('classifies FLAT when |q_star| <= q_step', () => {
      const target = createExposureTarget({
        q_star: 5, // <= q_step (10)
        q_current: -10,
        dq: 15, // Still needs to act
        shouldAct: true,
        E_effective: 0.1,
      });

      const result = engine.decide(target, 0, 10);

      expect(result!.targetDirection).toBe('FLAT');
    });
  });

  describe('Reason formatting', () => {
    it('includes Unwind label for sells', () => {
      const target = createExposureTarget({
        q_star: 50,
        dq: 50,
        shouldAct: true,
        E_effective: 0.3,
      });

      const result = engine.decide(target, 0, 30);

      expect(result!.reason).toContain('Unwind');
      expect(result!.reason).toContain('SELL');
      expect(result!.reason).toContain('NO');
    });

    it('includes Build label for buys', () => {
      const target = createExposureTarget({
        q_star: 50,
        dq: 50,
        shouldAct: true,
        E_effective: 0.3,
      });

      const result = engine.decide(target, 0, 0);

      expect(result!.reason).toContain('Build');
      expect(result!.reason).toContain('BUY');
      expect(result!.reason).toContain('YES');
    });

    it('includes E value in reason', () => {
      const target = createExposureTarget({
        q_star: 50,
        dq: 50,
        shouldAct: true,
        E_effective: 0.345,
      });

      const result = engine.decide(target, 0, 0);

      expect(result!.reason).toContain('E=0.345');
    });

    it('includes dq value in reason', () => {
      const target = createExposureTarget({
        q_star: 50,
        dq: 35,
        shouldAct: true,
        E_effective: 0.3,
      });

      const result = engine.decide(target, 0, 0);

      expect(result!.reason).toContain('dq=+35');
    });

    it('shows negative dq for bearish moves', () => {
      const target = createExposureTarget({
        q_star: -50,
        dq: -40,
        shouldAct: true,
        E_effective: -0.3,
      });

      const result = engine.decide(target, 0, 0);

      expect(result!.reason).toContain('dq=-40');
    });
  });

  describe('Complex scenarios', () => {
    it('handles transition from LONG_NO to LONG_YES', () => {
      // Currently long NO (negative q), need to go long YES
      const target = createExposureTarget({
        q_star: 100,  // Target: LONG_YES
        q_current: -50, // Current: LONG_NO
        dq: 150,
        shouldAct: true,
        E_effective: 0.5,
      });

      // First action should unwind NO position
      const result = engine.decide(target, 0, 50); // inv_no = 50

      expect(result!.side).toBe('SELL');
      expect(result!.outcome).toBe('NO');
      expect(result!.targetDirection).toBe('LONG_YES');
    });

    it('handles transition from LONG_YES to LONG_NO', () => {
      const target = createExposureTarget({
        q_star: -100,
        q_current: 50,
        dq: -150,
        shouldAct: true,
        E_effective: -0.5,
      });

      const result = engine.decide(target, 50, 0); // inv_yes = 50

      expect(result!.side).toBe('SELL');
      expect(result!.outcome).toBe('YES');
      expect(result!.targetDirection).toBe('LONG_NO');
    });

    it('handles flattening from LONG_YES', () => {
      const target = createExposureTarget({
        q_star: 0,  // Target flat
        q_current: 50,
        dq: -50,
        shouldAct: true,
        E_effective: 0,
      });

      const result = engine.decide(target, 50, 0);

      expect(result!.side).toBe('SELL');
      expect(result!.outcome).toBe('YES');
      expect(result!.targetDirection).toBe('FLAT');
    });

    it('handles flattening from LONG_NO', () => {
      const target = createExposureTarget({
        q_star: 0,
        q_current: -50,
        dq: 50,
        shouldAct: true,
        E_effective: 0,
      });

      const result = engine.decide(target, 0, 50);

      expect(result!.side).toBe('SELL');
      expect(result!.outcome).toBe('NO');
      expect(result!.targetDirection).toBe('FLAT');
    });
  });
});
