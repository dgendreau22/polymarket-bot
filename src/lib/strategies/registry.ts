/**
 * Strategy Registry
 *
 * Maps strategy slugs to their executor implementations.
 */

import type { IStrategyExecutor, StrategyContext, StrategySignal } from '../bots/types';

// Registry of strategy executors
const executors: Map<string, IStrategyExecutor> = new Map();

/**
 * Register a strategy executor
 */
export function registerStrategy(slug: string, executor: IStrategyExecutor): void {
  executors.set(slug, executor);
  console.log(`[Registry] Registered strategy executor: ${slug}`);
}

/**
 * Get a strategy executor by slug
 */
export function getExecutor(slug: string): IStrategyExecutor | undefined {
  return executors.get(slug);
}

/**
 * Check if a strategy executor is registered
 */
export function hasExecutor(slug: string): boolean {
  return executors.has(slug);
}

/**
 * Get all registered strategy slugs
 */
export function getRegisteredStrategies(): string[] {
  return Array.from(executors.keys());
}

/**
 * Unregister a strategy executor
 */
export function unregisterStrategy(slug: string): boolean {
  return executors.delete(slug);
}

// ============================================================================
// Built-in Strategy Executors
// ============================================================================

/**
 * Test Oscillator Strategy Executor
 * Alternates between buying and selling 1 share
 */
export class TestOscillatorExecutor implements IStrategyExecutor {
  async execute(context: StrategyContext): Promise<StrategySignal | null> {
    const { position, currentPrice, bot } = context;
    const config = (bot.config.strategyConfig || {}) as Record<string, unknown>;

    const quantity = String(config.quantity || '1');
    const outcome = (config.outcome as 'YES' | 'NO') || 'YES';
    const price = outcome === 'YES' ? currentPrice.yes : currentPrice.no;

    const currentSize = parseFloat(position.size);

    // If no position, buy
    if (currentSize === 0) {
      return {
        action: 'BUY',
        side: outcome,
        price,
        quantity,
        reason: 'Opening oscillator position',
        confidence: 1.0,
      };
    }

    // If holding, sell
    if (currentSize > 0) {
      return {
        action: 'SELL',
        side: outcome,
        price,
        quantity,
        reason: 'Closing oscillator position',
        confidence: 1.0,
      };
    }

    return null;
  }

  validate(config: Record<string, unknown>): boolean {
    const interval = config.interval as number;
    if (interval && (interval < 1000 || interval > 60000)) {
      return false;
    }

    const outcome = config.outcome as string;
    if (outcome && !['YES', 'NO'].includes(outcome)) {
      return false;
    }

    return true;
  }
}

/**
 * Market Maker Strategy Executor (placeholder)
 * Full implementation in market-maker.ts
 */
export class MarketMakerExecutor implements IStrategyExecutor {
  // Round price to tick size
  private roundToTick(price: number, tickSize: number): string {
    const rounded = Math.round(price / tickSize) * tickSize;
    // Calculate decimal places from tick size
    const decimals = tickSize >= 1 ? 0 : Math.max(0, Math.ceil(-Math.log10(tickSize)));
    return rounded.toFixed(decimals);
  }

  async execute(context: StrategyContext): Promise<StrategySignal | null> {
    // This is a simplified version - the full implementation is in market-maker.ts
    const { position, currentPrice, bot, tickSize } = context;
    const config = (bot.config.strategyConfig || {}) as Record<string, unknown>;

    const spread = (config.spread as number) || 0.02;
    const orderSize = String(config.orderSize || '10');
    const maxPosition = parseFloat(String(config.maxPosition || '100'));
    const outcome = (config.outcome as 'YES' | 'NO') || 'YES';

    // Get tick size (default to 0.01 if not available)
    const tick = tickSize ? parseFloat(tickSize.tick_size) : 0.01;

    // Use the actual current price of the outcome being traded
    const basePrice = outcome === 'YES' ? parseFloat(currentPrice.yes) : parseFloat(currentPrice.no);
    const positionSize = parseFloat(position.size);

    // Simple position-based signal
    if (positionSize === 0) {
      // Place bid slightly below current price, rounded to tick
      const bidPrice = this.roundToTick(basePrice * (1 - spread / 2), tick);
      return {
        action: 'BUY',
        side: outcome,
        price: bidPrice,
        quantity: orderSize,
        reason: `Market making - providing bid liquidity @ ${bidPrice}`,
        confidence: 0.8,
      };
    }

    if (positionSize > 0 && positionSize < maxPosition) {
      // Place ask slightly above current price, rounded to tick
      const askPrice = this.roundToTick(basePrice * (1 + spread / 2), tick);
      return {
        action: 'SELL',
        side: outcome,
        price: askPrice,
        quantity: orderSize,
        reason: `Market making - providing ask liquidity @ ${askPrice}`,
        confidence: 0.8,
      };
    }

    return null;
  }
}

/**
 * Arbitrage Strategy Executor (placeholder)
 * Full implementation in arbitrage.ts
 */
export class ArbitrageExecutor implements IStrategyExecutor {
  async execute(context: StrategyContext): Promise<StrategySignal | null> {
    const { currentPrice, bot } = context;
    const config = (bot.config.strategyConfig || {}) as Record<string, unknown>;

    const minSpread = (config.minSpread as number) || 0.01;
    const orderSize = String(config.orderSize || '50');

    const yesPrice = parseFloat(currentPrice.yes);
    const noPrice = parseFloat(currentPrice.no);
    const totalCost = yesPrice + noPrice;
    const spread = 1.0 - totalCost;

    // Check for arbitrage opportunity
    if (spread > minSpread) {
      return {
        action: 'BUY',
        side: 'YES',
        price: currentPrice.yes,
        quantity: orderSize,
        reason: `Arbitrage: ${(spread * 100).toFixed(2)}% spread detected`,
        confidence: 0.95,
      };
    }

    return null;
  }
}

// ============================================================================
// Register Built-in Strategies
// ============================================================================

// Register built-in executors
registerStrategy('test-oscillator', new TestOscillatorExecutor());
registerStrategy('market-maker', new MarketMakerExecutor());
registerStrategy('arbitrage', new ArbitrageExecutor());
