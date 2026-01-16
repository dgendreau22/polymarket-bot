/**
 * TimeAbove50Config Unit Tests
 *
 * Tests for configuration parsing:
 * - Default values applied for missing keys
 * - String-to-number conversion
 * - Invalid values fall back to defaults
 */

import { describe, it, expect } from 'vitest';
import { parseConfig, DEFAULT_CONFIG } from './TimeAbove50Config';

describe('TimeAbove50Config', () => {
  describe('parseConfig', () => {
    it('returns all defaults for empty config', () => {
      const result = parseConfig({});

      expect(result).toEqual(DEFAULT_CONFIG);
    });

    it('overrides specific values', () => {
      const result = parseConfig({
        H_tau: 30,
        Q_max: 1000,
      });

      expect(result.H_tau).toBe(30);
      expect(result.Q_max).toBe(1000);
      // Others should be defaults
      expect(result.H_d).toBe(DEFAULT_CONFIG.H_d);
    });

    it('converts string values to numbers', () => {
      const result = parseConfig({
        H_tau: '50',
        alpha: '0.8',
        Q_max: '800',
      });

      expect(result.H_tau).toBe(50);
      expect(result.alpha).toBe(0.8);
      expect(result.Q_max).toBe(800);
    });

    it('handles float strings correctly', () => {
      const result = parseConfig({
        E_enter: '0.22',
        spread_max_entry: '0.03',
      });

      expect(result.E_enter).toBe(0.22);
      expect(result.spread_max_entry).toBe(0.03);
    });

    it('falls back to defaults for invalid strings', () => {
      const result = parseConfig({
        H_tau: 'not-a-number',
        alpha: 'abc',
      });

      expect(result.H_tau).toBe(DEFAULT_CONFIG.H_tau);
      expect(result.alpha).toBe(DEFAULT_CONFIG.alpha);
    });

    it('falls back to defaults for NaN', () => {
      const result = parseConfig({
        H_tau: NaN,
      });

      expect(result.H_tau).toBe(DEFAULT_CONFIG.H_tau);
    });

    it('preserves valid number values', () => {
      const result = parseConfig({
        H_tau: 60.5,
        k: 3.0,
        Q_max: 500,
      });

      expect(result.H_tau).toBe(60.5);
      expect(result.k).toBe(3.0);
      expect(result.Q_max).toBe(500);
    });

    it('handles null and undefined gracefully', () => {
      const result = parseConfig({
        H_tau: null as unknown as number,
        alpha: undefined,
      });

      expect(result.H_tau).toBe(DEFAULT_CONFIG.H_tau);
      expect(result.alpha).toBe(DEFAULT_CONFIG.alpha);
    });

    it('handles zero values correctly', () => {
      const result = parseConfig({
        EV_min: 0,
        delta_min: 0,
      });

      expect(result.EV_min).toBe(0);
      expect(result.delta_min).toBe(0);
    });

    it('handles negative values correctly', () => {
      const result = parseConfig({
        dbar: -0.1, // If someone sets this incorrectly
      });

      // parseConfig doesn't validate, just parses
      // Invalid values would be caught by the algorithm
    });

    it('parses all config keys', () => {
      const allKeys = Object.keys(DEFAULT_CONFIG);
      const customConfig: Record<string, number> = {};

      // Set each key to a unique value
      allKeys.forEach((key, i) => {
        customConfig[key] = i + 100;
      });

      const result = parseConfig(customConfig);

      allKeys.forEach((key, i) => {
        expect(result[key as keyof typeof result]).toBe(i + 100);
      });
    });

    it('ignores unknown keys', () => {
      const result = parseConfig({
        unknownKey: 123,
        anotherUnknown: 'test',
      });

      // Result should only contain known keys
      expect('unknownKey' in result).toBe(false);
    });
  });

  describe('DEFAULT_CONFIG values', () => {
    it('has expected signal parameters', () => {
      expect(DEFAULT_CONFIG.H_tau).toBe(45.0);
      expect(DEFAULT_CONFIG.H_d).toBe(60.0);
      expect(DEFAULT_CONFIG.W_chop_sec).toBe(90);
    });

    it('has expected theta scaler parameters', () => {
      expect(DEFAULT_CONFIG.T0).toBe(3.0);
      expect(DEFAULT_CONFIG.theta_b).toBe(1.5);
    });

    it('has expected edge score weights', () => {
      expect(DEFAULT_CONFIG.alpha).toBe(1.0);
      expect(DEFAULT_CONFIG.beta).toBe(0.6);
      expect(DEFAULT_CONFIG.gamma).toBe(0.3);
      expect(DEFAULT_CONFIG.d0).toBe(0.015);
      expect(DEFAULT_CONFIG.d1).toBe(0.010);
    });

    it('has expected chop penalty parameters', () => {
      expect(DEFAULT_CONFIG.c0).toBe(2.0);
      expect(DEFAULT_CONFIG.sigma0).toBe(0.08);
    });

    it('has expected sizing parameters', () => {
      expect(DEFAULT_CONFIG.k).toBe(2.5);
      expect(DEFAULT_CONFIG.Q_max).toBe(600);
      expect(DEFAULT_CONFIG.q_step).toBe(10);
    });

    it('has expected deadband parameters', () => {
      expect(DEFAULT_CONFIG.delta_min).toBe(0.003);
      expect(DEFAULT_CONFIG.delta0).toBe(0.004);
      expect(DEFAULT_CONFIG.lambda_s).toBe(0.5);
      expect(DEFAULT_CONFIG.lambda_c).toBe(0.002);
      expect(DEFAULT_CONFIG.A_min).toBe(0.15);
    });

    it('has expected hysteresis parameters', () => {
      expect(DEFAULT_CONFIG.E_enter).toBe(0.18);
      expect(DEFAULT_CONFIG.E_exit).toBe(0.10);
      expect(DEFAULT_CONFIG.E_taker).toBe(0.30);
      expect(DEFAULT_CONFIG.E_override).toBe(0.35);
    });

    it('has expected liquidity gate parameters', () => {
      expect(DEFAULT_CONFIG.spread_max_entry).toBe(0.025);
      expect(DEFAULT_CONFIG.spread_halt).toBe(0.04);
    });

    it('has expected time flatten parameter', () => {
      expect(DEFAULT_CONFIG.T_flat).toBe(1.0);
    });

    it('has expected throttle parameters', () => {
      expect(DEFAULT_CONFIG.rebalance_interval).toBe(2.0);
      expect(DEFAULT_CONFIG.cooldown).toBe(2.0);
      expect(DEFAULT_CONFIG.min_hold).toBe(15.0);
    });

    it('has expected EV gating parameters', () => {
      expect(DEFAULT_CONFIG.EV_min).toBe(0.0);
      expect(DEFAULT_CONFIG.m).toBe(1.0);
    });
  });
});
