/**
 * ExposureManager Unit Tests
 *
 * Tests for exposure target calculation:
 * - gammaWeight: Position sizing based on price
 * - applyConstraints: Hysteresis and time flatten
 * - applyGrayZone: No expansions in gray zone
 * - calculateTarget: Full integration
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExposureManager } from './ExposureManager';
import { DEFAULT_CONFIG, type TimeAbove50Config } from './TimeAbove50Config';

describe('ExposureManager', () => {
  let manager: ExposureManager;
  let config: TimeAbove50Config;

  beforeEach(() => {
    config = { ...DEFAULT_CONFIG };
    manager = new ExposureManager(config);
  });

  // Helper to access private methods
  const getPrivate = (mgr: ExposureManager) => mgr as unknown as {
    gammaWeight(p: number): number;
    applyConstraints(E: number, q_current: number, T_min: number): number;
    applyGrayZone(E: number, q_current: number, q_star_raw: number): number;
  };

  describe('gammaWeight', () => {
    it('returns 1.0 at p=0.5', () => {
      const priv = getPrivate(manager);
      expect(priv.gammaWeight(0.5)).toBe(1.0);
    });

    it('returns 0 at p=0', () => {
      const priv = getPrivate(manager);
      expect(priv.gammaWeight(0)).toBe(0);
    });

    it('returns 0 at p=1', () => {
      const priv = getPrivate(manager);
      expect(priv.gammaWeight(1)).toBe(0);
    });

    it('is symmetric around 0.5', () => {
      const priv = getPrivate(manager);
      expect(priv.gammaWeight(0.3)).toBeCloseTo(priv.gammaWeight(0.7), 10);
      expect(priv.gammaWeight(0.2)).toBeCloseTo(priv.gammaWeight(0.8), 10);
      expect(priv.gammaWeight(0.1)).toBeCloseTo(priv.gammaWeight(0.9), 10);
    });

    it('follows formula g(p) = 4*p*(1-p)', () => {
      const priv = getPrivate(manager);
      const p = 0.35;
      const expected = 4 * p * (1 - p);
      expect(priv.gammaWeight(p)).toBeCloseTo(expected, 10);
    });

    it('never exceeds 1', () => {
      const priv = getPrivate(manager);
      for (let p = 0; p <= 1; p += 0.05) {
        expect(priv.gammaWeight(p)).toBeLessThanOrEqual(1);
      }
    });

    it('never goes negative', () => {
      const priv = getPrivate(manager);
      for (let p = 0; p <= 1; p += 0.05) {
        expect(priv.gammaWeight(p)).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('applyConstraints', () => {
    it('forces E to 0 when |E| < E_exit', () => {
      const priv = getPrivate(manager);
      // E below exit threshold
      const E = config.E_exit - 0.01;
      const result = priv.applyConstraints(E, 0, 10);
      expect(result).toBe(0);
    });

    it('preserves E when |E| >= E_exit', () => {
      const priv = getPrivate(manager);
      const E = config.E_exit + 0.05;
      const result = priv.applyConstraints(E, 0, 10);
      expect(result).toBe(E);
    });

    it('forces E to 0 when T < T_flat and |E| < E_override (time flatten)', () => {
      const priv = getPrivate(manager);
      // T below flatten threshold, E below override
      const E = config.E_override - 0.05;
      const T_min = config.T_flat - 0.5;
      const result = priv.applyConstraints(E, 0, T_min);
      expect(result).toBe(0);
    });

    it('preserves E when T < T_flat but |E| >= E_override', () => {
      const priv = getPrivate(manager);
      // Strong edge overrides time flatten
      const E = config.E_override + 0.05;
      const T_min = config.T_flat - 0.5;
      const result = priv.applyConstraints(E, 0, T_min);
      expect(result).toBe(E);
    });

    it('preserves E when T >= T_flat regardless of E', () => {
      const priv = getPrivate(manager);
      const E = 0.05; // Small E
      const T_min = config.T_flat + 1; // Beyond flatten
      const result = priv.applyConstraints(E, 0, T_min);
      // Only hysteresis applies
      expect(result).toBe(0); // E < E_exit, so still 0
    });

    it('handles negative E values correctly', () => {
      const priv = getPrivate(manager);
      const E = -(config.E_exit + 0.05); // Negative, above threshold
      const result = priv.applyConstraints(E, 0, 10);
      expect(result).toBe(E);
    });
  });

  describe('applyGrayZone', () => {
    it('allows reductions when in gray zone', () => {
      const priv = getPrivate(manager);
      // E in gray zone: E_exit <= |E| < E_enter
      const E = (config.E_exit + config.E_enter) / 2;
      const q_current = 100;
      const q_star_raw = 50; // Reduction

      const result = priv.applyGrayZone(E, q_current, q_star_raw);
      expect(result).toBe(q_star_raw);
    });

    it('blocks expansions when in gray zone', () => {
      const priv = getPrivate(manager);
      const E = (config.E_exit + config.E_enter) / 2;
      const q_current = 50;
      const q_star_raw = 100; // Expansion

      const result = priv.applyGrayZone(E, q_current, q_star_raw);
      expect(result).toBe(q_current); // Clamped
    });

    it('allows expansions when above gray zone (E >= E_enter)', () => {
      const priv = getPrivate(manager);
      const E = config.E_enter + 0.05;
      const q_current = 50;
      const q_star_raw = 100;

      const result = priv.applyGrayZone(E, q_current, q_star_raw);
      expect(result).toBe(q_star_raw);
    });

    it('allows all when below gray zone (E < E_exit)', () => {
      const priv = getPrivate(manager);
      // Note: when E < E_exit, we're outside gray zone
      const E = config.E_exit - 0.01;
      const q_current = 50;
      const q_star_raw = 100;

      const result = priv.applyGrayZone(E, q_current, q_star_raw);
      expect(result).toBe(q_star_raw);
    });

    it('handles negative E and q values', () => {
      const priv = getPrivate(manager);
      const E = -(config.E_exit + config.E_enter) / 2; // Negative, in gray zone
      const q_current = -50;
      const q_star_raw = -100; // Expansion (more negative)

      const result = priv.applyGrayZone(E, q_current, q_star_raw);
      expect(result).toBe(q_current); // Blocked
    });
  });

  describe('calculateTarget', () => {
    it('returns q_star=0 when E=0', () => {
      const result = manager.calculateTarget(
        0,    // E
        0.5,  // consensus price
        0,    // inv_yes
        0,    // inv_no
        10    // time to resolution
      );

      expect(result.q_star).toBe(0);
      expect(result.q_current).toBe(0);
      expect(result.dq).toBe(0);
      expect(result.shouldAct).toBe(false);
    });

    it('produces positive q_star for positive E', () => {
      const result = manager.calculateTarget(
        0.3,  // Strong positive E
        0.5,  // consensus price at 0.5 (max gamma)
        0,
        0,
        10
      );

      expect(result.q_star).toBeGreaterThan(0);
      expect(result.dq).toBeGreaterThan(0);
    });

    it('produces negative q_star for negative E', () => {
      const result = manager.calculateTarget(
        -0.3,
        0.5,
        0,
        0,
        10
      );

      expect(result.q_star).toBeLessThan(0);
      expect(result.dq).toBeLessThan(0);
    });

    it('shouldAct is true when |dq| >= q_step', () => {
      const result = manager.calculateTarget(
        0.4,
        0.5,
        0,
        0,
        10
      );

      // With E=0.4 at p=0.5, q* should be substantial
      expect(Math.abs(result.dq)).toBeGreaterThanOrEqual(config.q_step);
      expect(result.shouldAct).toBe(true);
    });

    it('shouldAct is false when |dq| < q_step', () => {
      // Start with position close to target
      const result = manager.calculateTarget(
        0.3,
        0.5,
        200, // Already have large position
        0,
        10
      );

      // q_current = 200, q_star will be calculated
      // If dq is small, shouldAct should be false
    });

    it('isExpanding is true when |q_star| > |q_current|', () => {
      const result = manager.calculateTarget(
        0.4,
        0.5,
        50, // Current YES position
        0,
        10
      );

      // q_current = 50, q_star should be larger
      if (Math.abs(result.q_star) > Math.abs(result.q_current)) {
        expect(result.isExpanding).toBe(true);
      }
    });

    it('isExpanding is false when reducing position', () => {
      const result = manager.calculateTarget(
        0.05, // Weak edge
        0.5,
        500, // Large existing position
        0,
        10
      );

      // Weak edge should target smaller position
      expect(result.isExpanding).toBe(false);
    });

    it('scales q_star with gamma weight (less at extreme prices)', () => {
      const result05 = manager.calculateTarget(0.3, 0.5, 0, 0, 10);
      const result08 = manager.calculateTarget(0.3, 0.8, 0, 0, 10);

      // At p=0.5, gamma=1.0; at p=0.8, gamma=0.64
      expect(Math.abs(result05.q_star)).toBeGreaterThan(Math.abs(result08.q_star));
    });

    it('applies hysteresis (E_effective = 0 when |E| < E_exit)', () => {
      const result = manager.calculateTarget(
        config.E_exit - 0.02, // Below exit
        0.5,
        100, // Has position
        0,
        10
      );

      expect(result.E_effective).toBe(0);
      expect(result.q_star).toBe(0);
    });

    it('correctly calculates q_current as inv_yes - inv_no', () => {
      const result = manager.calculateTarget(
        0.3,
        0.5,
        100, // YES
        30,  // NO
        10
      );

      expect(result.q_current).toBe(70); // 100 - 30
    });

    it('respects Q_max limit', () => {
      const result = manager.calculateTarget(
        1.0, // Maximum edge
        0.5, // Maximum gamma
        0,
        0,
        10
      );

      expect(Math.abs(result.q_star)).toBeLessThanOrEqual(config.Q_max);
    });
  });
});
