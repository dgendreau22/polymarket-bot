/**
 * ArbitrageConfig Unit Tests
 *
 * Tests for configuration parsing:
 * - Default values applied for missing keys
 * - String-to-number conversion
 * - Config key mapping
 */

import { describe, it, expect } from 'vitest';
import { parseConfig, DEFAULT_ARBITRAGE_CONFIG } from './ArbitrageConfig';

describe('ArbitrageConfig', () => {
  describe('parseConfig', () => {
    it('returns all defaults for empty config', () => {
      const result = parseConfig({});

      expect(result.orderSize).toBe(DEFAULT_ARBITRAGE_CONFIG.orderSize);
      expect(result.maxPositionPerLeg).toBe(DEFAULT_ARBITRAGE_CONFIG.maxPositionPerLeg);
      expect(result.profitThreshold).toBe(DEFAULT_ARBITRAGE_CONFIG.profitThreshold);
      expect(result.maxSingleLegPrice).toBe(DEFAULT_ARBITRAGE_CONFIG.maxSingleLegPrice);
      expect(result.imbalanceThreshold).toBe(DEFAULT_ARBITRAGE_CONFIG.imbalanceThreshold);
      expect(result.cooldownMs).toBe(DEFAULT_ARBITRAGE_CONFIG.cooldownMs);
      expect(result.sellThreshold).toBe(DEFAULT_ARBITRAGE_CONFIG.sellThreshold);
      expect(result.minImbalanceForSell).toBe(DEFAULT_ARBITRAGE_CONFIG.minImbalanceForSell);
    });

    it('overrides specific values', () => {
      const result = parseConfig({
        orderSize: 20,
        maxPosition: 200, // Note: maps to maxPositionPerLeg
      });

      expect(result.orderSize).toBe(20);
      expect(result.maxPositionPerLeg).toBe(200);
      // Others should be defaults
      expect(result.profitThreshold).toBe(DEFAULT_ARBITRAGE_CONFIG.profitThreshold);
    });

    it('converts string values to numbers', () => {
      const result = parseConfig({
        orderSize: '15',
        profitThreshold: '0.97',
      });

      expect(result.orderSize).toBe(15);
      expect(result.profitThreshold).toBe(0.97);
    });

    it('maps maxPosition to maxPositionPerLeg', () => {
      const result = parseConfig({
        maxPosition: 150,
      });

      expect(result.maxPositionPerLeg).toBe(150);
    });

    it('handles float strings correctly', () => {
      const result = parseConfig({
        profitThreshold: '0.95',
        maxSingleLegPrice: '0.70',
        imbalanceThreshold: '0.45',
      });

      expect(result.profitThreshold).toBe(0.95);
      expect(result.maxSingleLegPrice).toBe(0.70);
      expect(result.imbalanceThreshold).toBe(0.45);
    });

    it('parses cooldownMs correctly', () => {
      const result = parseConfig({
        cooldownMs: 5000,
      });

      expect(result.cooldownMs).toBe(5000);
    });

    it('parses sell threshold parameters', () => {
      const result = parseConfig({
        sellThreshold: 0.80,
        minImbalanceForSell: 50,
      });

      expect(result.sellThreshold).toBe(0.80);
      expect(result.minImbalanceForSell).toBe(50);
    });

    it('handles undefined values gracefully', () => {
      const result = parseConfig({
        orderSize: undefined,
      });

      expect(result.orderSize).toBe(DEFAULT_ARBITRAGE_CONFIG.orderSize);
    });

    it('handles zero values correctly', () => {
      const result = parseConfig({
        minImbalanceForSell: 0,
      });

      expect(result.minImbalanceForSell).toBe(0);
    });

    it('handles negative values', () => {
      // parseConfig doesn't validate, just converts
      const result = parseConfig({
        orderSize: -10,
      });

      expect(result.orderSize).toBe(-10);
    });

    it('parses all config keys correctly', () => {
      const customConfig = {
        orderSize: 25,
        maxPosition: 250,
        profitThreshold: 0.96,
        maxSingleLegPrice: 0.72,
        imbalanceThreshold: 0.55,
        cooldownMs: 4000,
        sellThreshold: 0.78,
        minImbalanceForSell: 40,
      };

      const result = parseConfig(customConfig);

      expect(result.orderSize).toBe(25);
      expect(result.maxPositionPerLeg).toBe(250);
      expect(result.profitThreshold).toBe(0.96);
      expect(result.maxSingleLegPrice).toBe(0.72);
      expect(result.imbalanceThreshold).toBe(0.55);
      expect(result.cooldownMs).toBe(4000);
      expect(result.sellThreshold).toBe(0.78);
      expect(result.minImbalanceForSell).toBe(40);
    });
  });

  describe('DEFAULT_ARBITRAGE_CONFIG values', () => {
    it('has expected order settings', () => {
      expect(DEFAULT_ARBITRAGE_CONFIG.orderSize).toBe(10);
      expect(DEFAULT_ARBITRAGE_CONFIG.maxPositionPerLeg).toBe(100);
    });

    it('has expected profitability thresholds', () => {
      expect(DEFAULT_ARBITRAGE_CONFIG.profitThreshold).toBe(0.98);
      expect(DEFAULT_ARBITRAGE_CONFIG.maxSingleLegPrice).toBe(0.75);
    });

    it('has expected imbalance settings', () => {
      expect(DEFAULT_ARBITRAGE_CONFIG.imbalanceThreshold).toBe(0.50);
    });

    it('has expected cooldown settings', () => {
      expect(DEFAULT_ARBITRAGE_CONFIG.cooldownMs).toBe(3000);
    });

    it('has expected profit-taking settings', () => {
      expect(DEFAULT_ARBITRAGE_CONFIG.sellThreshold).toBe(0.75);
      expect(DEFAULT_ARBITRAGE_CONFIG.minImbalanceForSell).toBe(30);
    });
  });
});
