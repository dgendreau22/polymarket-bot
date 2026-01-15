/**
 * Strategy Registry
 *
 * Maps strategy slugs to their executor implementations.
 */

import { log } from '@/lib/logger';
import type { IStrategyExecutor, ExecutorMetadata } from '../bots/types';

// Import executor implementations
import { TestOscillatorExecutor } from './test-oscillator-executor';
import { MarketMakerExecutor } from './market-maker-executor';
import { ArbitrageExecutor } from './arbitrage-executor';
import { TimeAbove50Executor } from './time-above-50-executor';

// Re-export executor classes for external use
export { TestOscillatorExecutor } from './test-oscillator-executor';
export { MarketMakerExecutor } from './market-maker-executor';
export { ArbitrageExecutor } from './arbitrage-executor';
export { TimeAbove50Executor } from './time-above-50-executor';

// Registry of strategy executors
const executors: Map<string, IStrategyExecutor> = new Map();

/**
 * Register a strategy executor
 */
export function registerStrategy(slug: string, executor: IStrategyExecutor): void {
  executors.set(slug, executor);
  log('Registry', `Registered strategy executor: ${slug}`);
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

/**
 * Get executor metadata by strategy slug
 */
export function getExecutorMetadata(slug: string): ExecutorMetadata | undefined {
  const executor = executors.get(slug);
  return executor?.metadata;
}

/**
 * Clean up any per-bot state stored by strategy executors.
 * Call this when a bot is deleted to prevent memory leaks.
 */
export function cleanupBotState(botId: string): void {
  // Call cleanup on all executors that have state
  for (const executor of executors.values()) {
    if (executor.cleanup) {
      executor.cleanup(botId);
    }
  }
}

// ============================================================================
// Register Built-in Strategies
// ============================================================================

// Register built-in executors
registerStrategy('test-oscillator', new TestOscillatorExecutor());
registerStrategy('market-maker', new MarketMakerExecutor());
registerStrategy('arbitrage', new ArbitrageExecutor());
registerStrategy('time-above-50', new TimeAbove50Executor());
