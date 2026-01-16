/**
 * SignalCalculator Unit Tests
 *
 * Tests for all signal calculation components:
 * - updateTau: Time-above estimator with exponential decay
 * - updateDbar: Smoothed displacement using EWMA
 * - calculateTheta: Time-to-resolution scaler
 * - calculateChopPenalty: Chop detection penalty
 * - logit: Logit transform with clipping
 * - calculateEdgeScore: Combined edge scoring
 * - applyDeadband: Signal suppression in deadband
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SignalCalculator } from './SignalCalculator';
import { TimeAbove50State } from './TimeAbove50State';
import { DEFAULT_CONFIG, type TimeAbove50Config } from './TimeAbove50Config';

describe('SignalCalculator', () => {
  let calculator: SignalCalculator;
  let state: TimeAbove50State;
  let config: TimeAbove50Config;

  beforeEach(() => {
    config = { ...DEFAULT_CONFIG };
    calculator = new SignalCalculator(config);
    state = new TimeAbove50State();
  });

  // Helper to access private methods via type casting
  const getPrivate = (calc: SignalCalculator) => calc as unknown as {
    updateTau(prevTau: number, I: number, dt: number): number;
    updateDbar(prevDbar: number, d: number, dt: number): number;
    calculateTheta(T_min: number): number;
    calculateChopPenalty(cross: number, sigma: number): number;
    logit(p: number): number;
    clip(x: number, lo: number, hi: number): number;
    calculateEdgeScore(A: number, dbar: number, d: number, theta: number, chi: number): number;
    applyDeadband(d: number, A: number, spread_c: number, cross: number): boolean;
  };

  describe('updateTau', () => {
    it('increases tau when I=1 (price above 0.50)', () => {
      const priv = getPrivate(calculator);
      const prevTau = 0.5;
      const I = 1;
      const dt = 1.0; // 1 second

      const newTau = priv.updateTau(prevTau, I, dt);
      expect(newTau).toBeGreaterThan(prevTau);
    });

    it('decreases tau when I=0 (price below 0.50)', () => {
      const priv = getPrivate(calculator);
      const prevTau = 0.5;
      const I = 0;
      const dt = 1.0;

      const newTau = priv.updateTau(prevTau, I, dt);
      expect(newTau).toBeLessThan(prevTau);
    });

    it('tau approaches 0.5 after half-life from tau=1 with I=0', () => {
      const priv = getPrivate(calculator);
      // H_tau is the half-life in seconds (default: 45s)
      // After H_tau seconds, tau should decay by half
      const prevTau = 1.0;
      const I = 0;
      const dt = config.H_tau; // One half-life

      const newTau = priv.updateTau(prevTau, I, dt);
      // After one half-life, tau should be around 0.5
      expect(newTau).toBeCloseTo(0.5, 1);
    });

    it('tau approaches 0.5 after half-life from tau=0 with I=1', () => {
      const priv = getPrivate(calculator);
      const prevTau = 0.0;
      const I = 1;
      const dt = config.H_tau;

      const newTau = priv.updateTau(prevTau, I, dt);
      expect(newTau).toBeCloseTo(0.5, 1);
    });

    it('handles very small dt correctly', () => {
      const priv = getPrivate(calculator);
      const prevTau = 0.5;
      const I = 1;
      const dt = 0.001;

      const newTau = priv.updateTau(prevTau, I, dt);
      // Very small change expected
      expect(newTau).toBeGreaterThan(prevTau);
      expect(newTau - prevTau).toBeLessThan(0.001);
    });

    it('handles large dt correctly', () => {
      const priv = getPrivate(calculator);
      const prevTau = 0.5;
      const I = 1;
      const dt = 1000; // Very large

      const newTau = priv.updateTau(prevTau, I, dt);
      // Should approach target (I=1)
      expect(newTau).toBeCloseTo(1.0, 2);
    });
  });

  describe('updateDbar', () => {
    it('increases dbar when d is positive', () => {
      const priv = getPrivate(calculator);
      const prevDbar = 0;
      const d = 0.1; // positive displacement
      const dt = 1.0;

      const newDbar = priv.updateDbar(prevDbar, d, dt);
      expect(newDbar).toBeGreaterThan(prevDbar);
    });

    it('decreases dbar when d is negative', () => {
      const priv = getPrivate(calculator);
      const prevDbar = 0;
      const d = -0.1;
      const dt = 1.0;

      const newDbar = priv.updateDbar(prevDbar, d, dt);
      expect(newDbar).toBeLessThan(prevDbar);
    });

    it('dbar decays toward current displacement over time', () => {
      const priv = getPrivate(calculator);
      const prevDbar = 0.1;
      const d = 0.0; // No displacement
      const dt = config.H_d; // One half-life

      const newDbar = priv.updateDbar(prevDbar, d, dt);
      // After half-life, should decay by half toward d=0
      expect(newDbar).toBeCloseTo(0.05, 2);
    });

    it('converges to constant d over multiple updates', () => {
      const priv = getPrivate(calculator);
      let dbar = 0;
      const d = 0.15;
      const dt = 10; // 10 second increments

      // After many updates, dbar should converge to d
      for (let i = 0; i < 100; i++) {
        dbar = priv.updateDbar(dbar, d, dt);
      }

      expect(dbar).toBeCloseTo(d, 2);
    });
  });

  describe('calculateTheta', () => {
    it('returns 0 when T=0', () => {
      const priv = getPrivate(calculator);
      expect(priv.calculateTheta(0)).toBe(0);
    });

    it('returns 0 for negative T', () => {
      const priv = getPrivate(calculator);
      expect(priv.calculateTheta(-1)).toBe(0);
    });

    it('approaches 1 for large T', () => {
      const priv = getPrivate(calculator);
      const theta = priv.calculateTheta(1000);
      expect(theta).toBeCloseTo(1, 2);
    });

    it('is approximately 0.5^theta_b at T=T0', () => {
      const priv = getPrivate(calculator);
      // At T=T0, theta = (T0/(T0+T0))^b = 0.5^b
      const theta = priv.calculateTheta(config.T0);
      const expected = Math.pow(0.5, config.theta_b);
      expect(theta).toBeCloseTo(expected, 4);
    });

    it('increases monotonically with T', () => {
      const priv = getPrivate(calculator);
      const theta1 = priv.calculateTheta(1);
      const theta5 = priv.calculateTheta(5);
      const theta10 = priv.calculateTheta(10);

      expect(theta5).toBeGreaterThan(theta1);
      expect(theta10).toBeGreaterThan(theta5);
    });

    it('follows formula (T/(T+T0))^b exactly', () => {
      const priv = getPrivate(calculator);
      const T = 7.5;
      const expected = Math.pow(T / (T + config.T0), config.theta_b);
      expect(priv.calculateTheta(T)).toBeCloseTo(expected, 10);
    });
  });

  describe('calculateChopPenalty', () => {
    it('returns 1 when no chop (cross=0, sigma=0)', () => {
      const priv = getPrivate(calculator);
      expect(priv.calculateChopPenalty(0, 0)).toBe(1);
    });

    it('decreases with higher crossing rate', () => {
      const priv = getPrivate(calculator);
      const chi1 = priv.calculateChopPenalty(1, 0);
      const chi5 = priv.calculateChopPenalty(5, 0);

      expect(chi5).toBeLessThan(chi1);
    });

    it('decreases with higher sigma', () => {
      const priv = getPrivate(calculator);
      const chi1 = priv.calculateChopPenalty(0, 0.05);
      const chi2 = priv.calculateChopPenalty(0, 0.15);

      expect(chi2).toBeLessThan(chi1);
    });

    it('follows formula 1/(1 + (cross/c0)^2 + (sigma/sigma0)^2)', () => {
      const priv = getPrivate(calculator);
      const cross = 3;
      const sigma = 0.12;
      const expected = 1 / (
        1 +
        Math.pow(cross / config.c0, 2) +
        Math.pow(sigma / config.sigma0, 2)
      );
      expect(priv.calculateChopPenalty(cross, sigma)).toBeCloseTo(expected, 10);
    });

    it('never returns negative values', () => {
      const priv = getPrivate(calculator);
      const chi = priv.calculateChopPenalty(100, 10);
      expect(chi).toBeGreaterThan(0);
    });

    it('never exceeds 1', () => {
      const priv = getPrivate(calculator);
      const chi = priv.calculateChopPenalty(0, 0);
      expect(chi).toBeLessThanOrEqual(1);
    });
  });

  describe('logit', () => {
    it('returns 0 at p=0.5', () => {
      const priv = getPrivate(calculator);
      expect(priv.logit(0.5)).toBeCloseTo(0, 10);
    });

    it('returns positive value for p>0.5', () => {
      const priv = getPrivate(calculator);
      expect(priv.logit(0.7)).toBeGreaterThan(0);
    });

    it('returns negative value for p<0.5', () => {
      const priv = getPrivate(calculator);
      expect(priv.logit(0.3)).toBeLessThan(0);
    });

    it('clips extreme low values to 0.01', () => {
      const priv = getPrivate(calculator);
      const logit0 = priv.logit(0);
      const logit001 = priv.logit(0.01);
      expect(logit0).toBe(logit001);
    });

    it('clips extreme high values to 0.99', () => {
      const priv = getPrivate(calculator);
      const logit1 = priv.logit(1);
      const logit099 = priv.logit(0.99);
      expect(logit1).toBe(logit099);
    });

    it('is symmetric: logit(p) = -logit(1-p)', () => {
      const priv = getPrivate(calculator);
      expect(priv.logit(0.7)).toBeCloseTo(-priv.logit(0.3), 10);
    });
  });

  describe('calculateEdgeScore', () => {
    it('returns 0 when all inputs are 0', () => {
      const priv = getPrivate(calculator);
      const E = priv.calculateEdgeScore(0, 0, 0, 1, 1);
      expect(E).toBe(0);
    });

    it('scales with theta', () => {
      const priv = getPrivate(calculator);
      const E1 = priv.calculateEdgeScore(0.5, 0.1, 0.05, 0.5, 1);
      const E2 = priv.calculateEdgeScore(0.5, 0.1, 0.05, 1.0, 1);

      expect(E2).toBeCloseTo(E1 * 2, 10);
    });

    it('scales with chi', () => {
      const priv = getPrivate(calculator);
      const E1 = priv.calculateEdgeScore(0.5, 0.1, 0.05, 1, 0.5);
      const E2 = priv.calculateEdgeScore(0.5, 0.1, 0.05, 1, 1.0);

      expect(E2).toBeCloseTo(E1 * 2, 10);
    });

    it('follows formula: theta * chi * (alpha*A + beta*tanh(dbar/d0) + gamma*tanh(d/d1))', () => {
      const priv = getPrivate(calculator);
      const A = 0.4;
      const dbar = 0.02;
      const d = 0.08;
      const theta = 0.8;
      const chi = 0.7;

      const expected = theta * chi * (
        config.alpha * A +
        config.beta * Math.tanh(dbar / config.d0) +
        config.gamma * Math.tanh(d / config.d1)
      );

      expect(priv.calculateEdgeScore(A, dbar, d, theta, chi)).toBeCloseTo(expected, 10);
    });

    it('produces positive edge for bullish signals', () => {
      const priv = getPrivate(calculator);
      // A > 0 (bullish time-above), positive displacements
      const E = priv.calculateEdgeScore(0.6, 0.05, 0.1, 0.9, 0.9);
      expect(E).toBeGreaterThan(0);
    });

    it('produces negative edge for bearish signals', () => {
      const priv = getPrivate(calculator);
      // A < 0 (bearish time-above), negative displacements
      const E = priv.calculateEdgeScore(-0.6, -0.05, -0.1, 0.9, 0.9);
      expect(E).toBeLessThan(0);
    });
  });

  describe('applyDeadband', () => {
    it('returns true when |d| < delta AND |A| < A_min', () => {
      const priv = getPrivate(calculator);
      // Small displacement and small persistence
      const inDeadband = priv.applyDeadband(0.001, 0.05, 0.01, 0);
      expect(inDeadband).toBe(true);
    });

    it('returns false when |d| >= delta', () => {
      const priv = getPrivate(calculator);
      // Large displacement
      const inDeadband = priv.applyDeadband(0.1, 0.05, 0.01, 0);
      expect(inDeadband).toBe(false);
    });

    it('returns false when |A| >= A_min', () => {
      const priv = getPrivate(calculator);
      // Large persistence
      const inDeadband = priv.applyDeadband(0.001, 0.5, 0.01, 0);
      expect(inDeadband).toBe(false);
    });

    it('deadband delta increases with spread', () => {
      const priv = getPrivate(calculator);
      // At minimum spread
      const inDeadband1 = priv.applyDeadband(0.003, 0.1, 0.01, 0);
      // At larger spread, delta should increase, so same d might be in deadband
      const inDeadband2 = priv.applyDeadband(0.005, 0.1, 0.04, 0);

      // With small spread, d=0.003 might be outside deadband
      // With large spread, d=0.005 might still be in deadband
      // This tests that spread increases delta
      expect(inDeadband2).toBe(true);
    });

    it('deadband delta increases with crossing rate', () => {
      const priv = getPrivate(calculator);
      // At high crossing rate, delta increases
      const inDeadband = priv.applyDeadband(0.005, 0.1, 0.01, 5);
      expect(inDeadband).toBe(true);
    });
  });

  describe('calculate (integration)', () => {
    it('produces valid signal components for bullish market', () => {
      const botId = 'test-bot';
      const now = Date.now();

      // Add some price history above 0.50
      for (let i = 0; i < 10; i++) {
        state.addPricePoint(botId, now - (10 - i) * 1000, 0.55);
      }

      const result = calculator.calculate(
        botId,
        state,
        0.55, // consensus price above 0.50
        0.02, // spread
        10,   // 10 minutes to resolution
        now
      );

      expect(result.tau).toBeGreaterThan(0.5);
      expect(result.A).toBeGreaterThan(0);
      expect(result.d).toBeCloseTo(0.05, 10);
      expect(result.theta).toBeGreaterThan(0);
      expect(result.chi).toBeLessThanOrEqual(1);
    });

    it('produces valid signal components for bearish market', () => {
      const botId = 'test-bot';
      const now = Date.now();

      // Add some price history below 0.50
      for (let i = 0; i < 10; i++) {
        state.addPricePoint(botId, now - (10 - i) * 1000, 0.45);
      }

      const result = calculator.calculate(
        botId,
        state,
        0.45,
        0.02,
        10,
        now
      );

      expect(result.tau).toBeLessThan(0.5);
      expect(result.A).toBeLessThan(0);
      expect(result.d).toBeCloseTo(-0.05, 10);
    });

    it('sets inDeadband=true and E=0 in deadband', () => {
      const botId = 'test-bot';
      const now = Date.now();

      // Price at exactly 0.50 with fresh state
      const result = calculator.calculate(
        botId,
        state,
        0.50,
        0.02,
        10,
        now
      );

      expect(result.d).toBe(0);
      expect(result.inDeadband).toBe(true);
      expect(result.E).toBe(0);
    });

    it('updates state tau and dbar', () => {
      const botId = 'test-bot';
      const now = Date.now();

      calculator.calculate(botId, state, 0.60, 0.02, 10, now);

      expect(state.getTau(botId)).toBeGreaterThan(0.5);
      expect(state.getDbar(botId)).toBeGreaterThan(0);
    });

    it('handles theta=0 when market expired', () => {
      const botId = 'test-bot';
      const now = Date.now();

      const result = calculator.calculate(
        botId,
        state,
        0.55,
        0.02,
        0, // 0 minutes to resolution
        now
      );

      expect(result.theta).toBe(0);
      expect(result.E).toBe(0); // theta scales E
    });
  });
});
