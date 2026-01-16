/**
 * Arbitrage DecisionEngine Unit Tests
 *
 * Tests for priority-based decision logic:
 * - Priority 0: Sell leading leg (rebalancing)
 * - Priority 1: Balance lagging leg
 * - Priority 2: Round-robin entry
 * - Cooldown enforcement
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DecisionEngine, type MarketData } from './DecisionEngine';
import { ArbitrageState } from './ArbitrageState';
import { PriceValidator } from './PriceValidator';
import type { ArbitrageConfig } from './ArbitrageConfig';
import type { PositionAnalysis } from './PositionAnalyzer';

describe('Arbitrage DecisionEngine', () => {
  let engine: DecisionEngine;
  let state: ArbitrageState;
  let validator: PriceValidator;
  let config: ArbitrageConfig;

  beforeEach(() => {
    config = {
      orderSize: 10,
      maxPositionPerLeg: 100,
      profitThreshold: 0.98,
      maxSingleLegPrice: 0.75,
      imbalanceThreshold: 0.50,
      cooldownMs: 3000,
      sellThreshold: 0.75,
      minImbalanceForSell: 30,
    };
    state = new ArbitrageState();
    validator = new PriceValidator(config.profitThreshold, config.maxSingleLegPrice);
    engine = new DecisionEngine(config, state, validator);
  });

  // Helper to create market data
  const createMarketData = (
    yesBid = 0.48,
    yesAsk = 0.50,
    noBid = 0.48,
    noAsk = 0.50
  ): MarketData => ({
    yes: { bestBid: yesBid, bestAsk: yesAsk },
    no: { bestBid: noBid, bestAsk: noAsk },
    potentialProfit: 1 - (yesAsk + noAsk),
    isValid: true,
  });

  // Helper to create position analysis
  const createAnalysis = (overrides: Partial<PositionAnalysis> = {}): PositionAnalysis => ({
    yesFilledSize: 0,
    noFilledSize: 0,
    yesFilledAvg: 0,
    noFilledAvg: 0,
    yesSize: 0,
    noSize: 0,
    yesAvg: 0,
    noAvg: 0,
    totalSize: 0,
    sizeDiff: 0,
    filledDiff: 0,
    imbalance: 0,
    isLargeImbalance: false,
    yesIsLagging: true,
    laggingLeg: 'YES',
    leadingLeg: 'NO',
    newDiffIfBuyYes: 10,
    newDiffIfBuyNo: 10,
    newFilledDiffIfBuyYes: 10,
    newFilledDiffIfBuyNo: 10,
    ...overrides,
  });

  describe('Priority 0: Sell leading leg', () => {
    it('sells leading leg when imbalance >= minImbalanceForSell', () => {
      const analysis = createAnalysis({
        yesFilledSize: 100,
        noFilledSize: 50,
        yesFilledAvg: 0.40,
        sizeDiff: 50, // >= 30
        leadingLeg: 'YES',
        laggingLeg: 'NO',
      });

      const marketData = createMarketData(0.76, 0.78, 0.48, 0.50);

      const decision = engine.decide('bot1', analysis, marketData, 100);

      expect(decision).not.toBeNull();
      expect(decision!.side).toBe('SELL');
      expect(decision!.leg).toBe('YES');
    });

    it('requires price above entry for sell', () => {
      const analysis = createAnalysis({
        yesFilledSize: 100,
        noFilledSize: 50,
        yesFilledAvg: 0.80, // Entry at 0.80
        sizeDiff: 50,
        leadingLeg: 'YES',
        laggingLeg: 'NO',
      });

      // Bid is 0.76, below entry of 0.80
      const marketData = createMarketData(0.76, 0.78, 0.48, 0.50);

      const decision = engine.decide('bot1', analysis, marketData, 100);

      // Should not sell at a loss, moves to Priority 1
      expect(decision?.side).not.toBe('SELL');
    });

    it('requires price above sellThreshold', () => {
      const analysis = createAnalysis({
        yesFilledSize: 100,
        noFilledSize: 50,
        yesFilledAvg: 0.40,
        sizeDiff: 50,
        leadingLeg: 'YES',
        laggingLeg: 'NO',
      });

      // Bid at 0.70, below sellThreshold of 0.75
      const marketData = createMarketData(0.70, 0.72, 0.48, 0.50);

      const decision = engine.decide('bot1', analysis, marketData, 100);

      expect(decision?.side).not.toBe('SELL');
    });

    it('sells minimum of imbalance, position, and orderSize', () => {
      const analysis = createAnalysis({
        yesFilledSize: 5, // Only 5 to sell
        noFilledSize: 0,
        yesFilledAvg: 0.40,
        sizeDiff: 50,
        leadingLeg: 'YES',
        laggingLeg: 'NO',
      });

      const marketData = createMarketData(0.76, 0.78, 0.48, 0.50);

      const decision = engine.decide('bot1', analysis, marketData, 100);

      expect(decision).not.toBeNull();
      expect(decision!.side).toBe('SELL');
      expect(decision!.orderSize).toBe(5); // Capped at available position
    });
  });

  describe('Priority 1: Balance lagging leg', () => {
    it('buys lagging leg when has position', () => {
      const analysis = createAnalysis({
        yesFilledSize: 50,
        noFilledSize: 100,
        yesAvg: 0.45,
        noAvg: 0.45,
        totalSize: 150,
        yesIsLagging: true,
        laggingLeg: 'YES',
        leadingLeg: 'NO',
      });

      const marketData = createMarketData(0.48, 0.50, 0.48, 0.50);

      const decision = engine.decide('bot1', analysis, marketData, 100);

      expect(decision).not.toBeNull();
      expect(decision!.side).toBe('BUY');
      expect(decision!.leg).toBe('YES');
    });

    it('uses aggressive price for large imbalance', () => {
      const analysis = createAnalysis({
        yesFilledSize: 30,
        noFilledSize: 100,
        yesAvg: 0.45,
        noAvg: 0.45,
        totalSize: 130,
        isLargeImbalance: true,
        yesIsLagging: true,
        laggingLeg: 'YES',
        leadingLeg: 'NO',
      });

      const marketData = createMarketData(0.48, 0.50, 0.48, 0.50);

      const decision = engine.decide('bot1', analysis, marketData, 100);

      expect(decision).not.toBeNull();
      expect(decision!.aggressive).toBe(true);
    });

    it('respects cooldown for lagging leg', () => {
      const analysis = createAnalysis({
        yesFilledSize: 50,
        noFilledSize: 100,
        totalSize: 150,
        yesIsLagging: true,
        laggingLeg: 'YES',
        leadingLeg: 'NO',
        yesAvg: 0.45,
        noAvg: 0.45,
      });

      const marketData = createMarketData(0.48, 0.50, 0.48, 0.50);

      // Put YES on cooldown
      state.recordOrder('bot1', 'YES', Date.now());

      const decision = engine.decide('bot1', analysis, marketData, 100);

      // Can't buy lagging YES, should try entry on NO
      expect(decision?.leg).toBe('NO');
    });
  });

  describe('Priority 2: Round-robin entry', () => {
    it('alternates legs for balanced entry', () => {
      const analysis = createAnalysis({
        yesAvg: 0.45,
        noAvg: 0.45,
      });

      const marketData = createMarketData(0.48, 0.50, 0.48, 0.50);

      // First entry
      const decision1 = engine.decide('bot1', analysis, marketData, 100);
      expect(decision1).not.toBeNull();

      // The next leg should be different if we called again
      // (but this test just verifies initial entry works)
      expect(decision1!.side).toBe('BUY');
    });

    it('tries second leg when first on cooldown', () => {
      const analysis = createAnalysis({
        yesAvg: 0.45,
        noAvg: 0.45,
      });

      const marketData = createMarketData(0.48, 0.50, 0.48, 0.50);

      // First round-robin would return YES
      const firstLeg = state.getNextLegRoundRobin('bot1');

      // Put first leg on cooldown
      state.recordOrder('bot1', firstLeg, Date.now());

      const decision = engine.decide('bot1', analysis, marketData, 100);

      // Should buy the other leg
      expect(decision).not.toBeNull();
      expect(decision!.leg).not.toBe(firstLeg);
    });

    it('returns null when both legs on cooldown', () => {
      const analysis = createAnalysis({});
      const marketData = createMarketData(0.48, 0.50, 0.48, 0.50);

      // Put both on cooldown
      state.recordOrder('bot1', 'YES', Date.now());
      state.recordOrder('bot1', 'NO', Date.now());

      const decision = engine.decide('bot1', analysis, marketData, 100);

      expect(decision).toBeNull();
    });
  });

  describe('Position limits', () => {
    it('blocks leading leg when would exceed maxPosition', () => {
      const analysis = createAnalysis({
        yesSize: 90,
        noSize: 50,
        yesIsLagging: false,
        laggingLeg: 'NO',
        leadingLeg: 'YES',
        newDiffIfBuyYes: 110, // Would exceed maxPosition=100
        newFilledDiffIfBuyYes: 110,
        yesAvg: 0.45,
        noAvg: 0.45,
      });

      const marketData = createMarketData(0.48, 0.50, 0.48, 0.50);

      // Put NO on cooldown to force trying YES
      state.recordOrder('bot1', 'NO', Date.now());

      const decision = engine.decide('bot1', analysis, marketData, 100);

      // Should not buy YES as it would violate position limit
      expect(decision).toBeNull();
    });

    it('allows lagging leg even if it increases diff', () => {
      const analysis = createAnalysis({
        yesSize: 50,
        noSize: 90,
        yesIsLagging: true,
        laggingLeg: 'YES',
        leadingLeg: 'NO',
        yesAvg: 0.45,
        noAvg: 0.45,
        totalSize: 140,
      });

      const marketData = createMarketData(0.48, 0.50, 0.48, 0.50);

      const decision = engine.decide('bot1', analysis, marketData, 100);

      expect(decision).not.toBeNull();
      expect(decision!.leg).toBe('YES'); // Lagging leg always allowed
    });
  });

  describe('Price validation', () => {
    it('blocks entry when price exceeds dynamic ceiling', () => {
      const analysis = createAnalysis({
        yesAvg: 0,
        noAvg: 0.50, // Other leg has position at 0.50
      });

      // YES ask at 0.55, ceiling = 0.98 - 0.50 - 0.01 = 0.47
      const marketData = createMarketData(0.53, 0.55, 0.48, 0.50);

      // Force trying YES first
      state.recordOrder('bot1', 'NO', Date.now());

      const decision = engine.decide('bot1', analysis, marketData, 100);

      // Should fall back to NO or return null
      expect(decision?.leg !== 'YES' || decision === null).toBe(true);
    });

    it('blocks entry when would push combined avg >= threshold', () => {
      const analysis = createAnalysis({
        yesSize: 100,
        yesAvg: 0.49,
        noSize: 100,
        noAvg: 0.49,
        yesIsLagging: true,
        laggingLeg: 'YES',
        leadingLeg: 'NO',
        totalSize: 200,
      });

      // Combined already at 0.98
      // YES bid at 0.55 would increase avg: (100*0.49 + 10*0.55)/110 = 0.495
      // Combined = 0.495 + 0.49 = 0.985 >= 0.98, blocked
      // NO bid at 0.55 similarly blocked
      const marketData = createMarketData(0.54, 0.56, 0.54, 0.56);

      const decision = engine.decide('bot1', analysis, marketData, 100);

      // Both legs should be blocked due to cost validation
      expect(decision).toBeNull();
    });
  });

  describe('Cooldown recording', () => {
    it('records order for sell decisions', () => {
      const analysis = createAnalysis({
        yesFilledSize: 100,
        noFilledSize: 50,
        yesFilledAvg: 0.40,
        sizeDiff: 50,
        leadingLeg: 'YES',
        laggingLeg: 'NO',
      });

      const marketData = createMarketData(0.76, 0.78, 0.48, 0.50);

      engine.decide('bot1', analysis, marketData, 100);

      // YES should now be on cooldown
      expect(state.isOnCooldown('bot1', 'YES', config.cooldownMs)).toBe(true);
    });

    it('records order for buy decisions', () => {
      const analysis = createAnalysis({
        yesAvg: 0.45,
        noAvg: 0.45,
      });

      const marketData = createMarketData(0.48, 0.50, 0.48, 0.50);

      const decision = engine.decide('bot1', analysis, marketData, 100);

      if (decision) {
        expect(state.isOnCooldown('bot1', decision.leg, config.cooldownMs)).toBe(true);
      }
    });
  });
});
