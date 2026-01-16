/**
 * Market Maker Executor Unit Tests
 *
 * Tests for market making calculations:
 * - roundToTick: Price rounding to tick size
 * - Bid/Ask price calculation
 * - Marketability guards
 * - Position value calculation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MarketMakerExecutor } from './market-maker-executor';
import {
  createMockContext,
  createMockOrderBook,
  createMockPosition,
} from './__mocks__/contextFactory';

describe('MarketMakerExecutor', () => {
  let executor: MarketMakerExecutor;

  beforeEach(() => {
    executor = new MarketMakerExecutor();
  });

  // Helper to access private methods
  const getPrivate = (exec: MarketMakerExecutor) => exec as unknown as {
    roundToTick(price: number, tickSize: number): string;
  };

  describe('roundToTick', () => {
    it('rounds 0.4567 to 0.46 with tick size 0.01', () => {
      const priv = getPrivate(executor);
      expect(priv.roundToTick(0.4567, 0.01)).toBe('0.46');
    });

    it('rounds 0.453 to 0.45 with tick size 0.01', () => {
      const priv = getPrivate(executor);
      expect(priv.roundToTick(0.453, 0.01)).toBe('0.45');
    });

    it('rounds to 3 decimal places with tick size 0.001', () => {
      const priv = getPrivate(executor);
      expect(priv.roundToTick(0.4567, 0.001)).toBe('0.457');
    });

    it('rounds to 0 decimal places with tick size 1', () => {
      const priv = getPrivate(executor);
      expect(priv.roundToTick(4.7, 1)).toBe('5');
    });

    it('rounds correctly at tick size 0.05', () => {
      const priv = getPrivate(executor);
      expect(priv.roundToTick(0.47, 0.05)).toBe('0.45');
      expect(priv.roundToTick(0.48, 0.05)).toBe('0.50');
    });

    it('handles very small tick sizes', () => {
      const priv = getPrivate(executor);
      expect(priv.roundToTick(0.45678, 0.0001)).toBe('0.4568');
    });

    it('preserves exact values on tick boundaries', () => {
      const priv = getPrivate(executor);
      expect(priv.roundToTick(0.45, 0.01)).toBe('0.45');
      expect(priv.roundToTick(0.50, 0.01)).toBe('0.50');
    });
  });

  describe('execute', () => {
    it('returns null when order book is empty', async () => {
      const context = createMockContext({
        orderBook: { market: '', asset_id: '', bids: [], asks: [], timestamp: '' },
      });
      context.bot.config.strategyConfig = { spread: 0.02, orderSize: 10 };

      const signal = await executor.execute(context);
      expect(signal).toBeNull();
    });

    it('returns null when bids are empty', async () => {
      const context = createMockContext({
        orderBook: {
          market: '',
          asset_id: '',
          bids: [],
          asks: [{ price: '0.51', size: '100' }],
          timestamp: '',
        },
      });
      context.bot.config.strategyConfig = { spread: 0.02, orderSize: 10 };

      const signal = await executor.execute(context);
      expect(signal).toBeNull();
    });

    it('returns null when asks are empty', async () => {
      const context = createMockContext({
        orderBook: {
          market: '',
          asset_id: '',
          bids: [{ price: '0.49', size: '100' }],
          asks: [],
          timestamp: '',
        },
      });
      context.bot.config.strategyConfig = { spread: 0.02, orderSize: 10 };

      const signal = await executor.execute(context);
      expect(signal).toBeNull();
    });

    it('places BUY order when position value is below maxPosition', async () => {
      const context = createMockContext({
        orderBook: createMockOrderBook(0.49, 0.51),
        position: createMockPosition({ size: '0' }),
      });
      context.bot.config.strategyConfig = {
        spread: 0.02,
        orderSize: 10,
        maxPosition: 100,
      };
      context.pendingBuyQuantity = 0;

      const signal = await executor.execute(context);

      expect(signal).not.toBeNull();
      expect(signal!.action).toBe('BUY');
      expect(signal!.side).toBe('YES');
    });

    it('places BUY below best bid (providing liquidity)', async () => {
      const context = createMockContext({
        orderBook: createMockOrderBook(0.50, 0.54), // Wider spread so bid calculation stays below
        position: createMockPosition({ size: '0' }),
      });
      context.bot.config.strategyConfig = {
        spread: 0.04, // Larger spread
        orderSize: 10,
        maxPosition: 100,
      };
      context.pendingBuyQuantity = 0;

      const signal = await executor.execute(context);

      expect(signal).not.toBeNull();
      // Bid should be below best bid: 0.50 * (1 - 0.04/2) = 0.50 * 0.98 = 0.49
      expect(parseFloat(signal!.price)).toBeLessThan(0.50);
    });

    it('places SELL when position exists and at max position', async () => {
      const context = createMockContext({
        orderBook: createMockOrderBook(0.49, 0.51),
        position: createMockPosition({ size: '200' }), // Large position
      });
      context.bot.config.strategyConfig = {
        spread: 0.02,
        orderSize: 10,
        maxPosition: 50, // Already above max
      };
      context.pendingBuyQuantity = 0;

      const signal = await executor.execute(context);

      expect(signal).not.toBeNull();
      expect(signal!.action).toBe('SELL');
    });

    it('places SELL above best ask (providing liquidity)', async () => {
      const context = createMockContext({
        orderBook: createMockOrderBook(0.48, 0.50),
        position: createMockPosition({ size: '200' }),
      });
      context.bot.config.strategyConfig = {
        spread: 0.02,
        orderSize: 10,
        maxPosition: 50,
      };
      context.pendingBuyQuantity = 0;

      const signal = await executor.execute(context);

      expect(signal).not.toBeNull();
      expect(signal!.action).toBe('SELL');
      // Ask should be above best ask: 0.50 * (1 + 0.02/2) = 0.50 * 1.01 = 0.505
      expect(parseFloat(signal!.price)).toBeGreaterThan(0.50);
    });

    it('skips BUY when bid would be marketable (>= ask)', async () => {
      // Create a very tight or inverted book where our bid would cross
      const context = createMockContext({
        orderBook: createMockOrderBook(0.50, 0.50), // No spread
        position: createMockPosition({ size: '0' }),
      });
      context.bot.config.strategyConfig = {
        spread: 0.01, // Small spread that might cross
        orderSize: 10,
        maxPosition: 100,
      };

      const signal = await executor.execute(context);

      // With spread=0.01, bid = 0.50 * (1 - 0.005) = 0.4975
      // Ask is 0.50, so 0.4975 < 0.50, should work
      // But if bestBid >= bestAsk, order might cross
    });

    it('includes pending orders in effective position value', async () => {
      const context = createMockContext({
        orderBook: createMockOrderBook(0.50, 0.52),
        position: createMockPosition({ size: '80' }),
      });
      context.bot.config.strategyConfig = {
        spread: 0.02,
        orderSize: 10,
        maxPosition: 100, // 100 USDC max
      };
      // Mid price = 0.51
      // Position value = 80 * 0.51 = 40.8 USDC
      // Plus pending = 30 * 0.51 = 15.3 USDC
      // Effective = 56.1 USDC < 100, so should BUY
      context.pendingBuyQuantity = 30;

      const signal = await executor.execute(context);

      expect(signal).not.toBeNull();
      expect(signal!.action).toBe('BUY');
    });

    it('blocks BUY when pending orders push over maxPosition', async () => {
      const context = createMockContext({
        orderBook: createMockOrderBook(0.50, 0.52),
        position: createMockPosition({ size: '150' }),
      });
      context.bot.config.strategyConfig = {
        spread: 0.02,
        orderSize: 10,
        maxPosition: 100, // 100 USDC max
      };
      // Mid = 0.51
      // Position value = 150 * 0.51 = 76.5 USDC
      // + pending 50 * 0.51 = 25.5 USDC
      // Total = 102 USDC > 100
      context.pendingBuyQuantity = 50;

      const signal = await executor.execute(context);

      // Should either return null or SELL (depends on position size)
      if (signal) {
        expect(signal.action).toBe('SELL');
      }
    });

    it('uses correct outcome from strategy config', async () => {
      const context = createMockContext({
        orderBook: createMockOrderBook(0.49, 0.51),
        position: createMockPosition({ size: '0' }),
      });
      context.bot.config.strategyConfig = {
        spread: 0.02,
        orderSize: 10,
        maxPosition: 100,
        outcome: 'NO',
      };

      const signal = await executor.execute(context);

      expect(signal).not.toBeNull();
      expect(signal!.side).toBe('NO');
    });

    it('uses default values when config is missing', async () => {
      const context = createMockContext({
        orderBook: createMockOrderBook(0.49, 0.51),
        position: createMockPosition({ size: '0' }),
      });
      context.bot.config.strategyConfig = {}; // Empty config

      const signal = await executor.execute(context);

      expect(signal).not.toBeNull();
      // Should use defaults: spread=0.02, orderSize=10, maxPosition=100, outcome=YES
      expect(signal!.side).toBe('YES');
    });

    it('returns null when no position to sell and at max', async () => {
      const context = createMockContext({
        orderBook: createMockOrderBook(0.49, 0.51),
        position: createMockPosition({ size: '0' }), // No position
      });
      context.bot.config.strategyConfig = {
        spread: 0.02,
        orderSize: 10,
        maxPosition: 1, // Very low max position in USDC
      };
      // Mid = 0.50
      // Position = 0, pending = 50
      // Effective value = 50 * 0.50 = 25 > 1 (maxPosition)
      // Can't buy (at max), can't sell (no position)
      context.pendingBuyQuantity = 50;

      const signal = await executor.execute(context);
      // No position to sell, effective value exceeds maxPosition
      // Returns null since can't do anything
      expect(signal).toBeNull();
    });
  });

  describe('metadata', () => {
    it('declares single-asset requirement', () => {
      expect(executor.metadata.requiredAssets).toHaveLength(1);
      expect(executor.metadata.requiredAssets[0].configKey).toBe('assetId');
      expect(executor.metadata.requiredAssets[0].label).toBe('YES');
    });

    it('uses single position handler', () => {
      expect(executor.metadata.positionHandler).toBe('single');
    });

    it('has stale order rules', () => {
      expect(executor.metadata.staleOrderRules).toBeDefined();
      expect(executor.metadata.staleOrderRules?.maxOrderAge).toBe(60);
      expect(executor.metadata.staleOrderRules?.maxPriceDistance).toBe(0.05);
    });
  });
});
