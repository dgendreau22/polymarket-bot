/**
 * Test Oscillator Strategy Executor
 *
 * Alternates between buying and selling 1 share.
 * Used for testing bot infrastructure.
 */

import type { IStrategyExecutor, StrategyContext, StrategySignal, ExecutorMetadata } from '../bots/types';

export class TestOscillatorExecutor implements IStrategyExecutor {
  /** Executor metadata - declares single-asset requirements */
  readonly metadata: ExecutorMetadata = {
    requiredAssets: [
      { configKey: 'assetId', label: 'YES', subscriptions: ['orderBook', 'price'] },
    ],
    positionHandler: 'single',
  };

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
