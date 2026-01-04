/**
 * Strategy Registry
 *
 * Maps strategy slugs to their executor implementations.
 */

import type { IStrategyExecutor } from '../bots/types';

// Import executor implementations
import { TestOscillatorExecutor } from './test-oscillator-executor';
import { MarketMakerExecutor } from './market-maker-executor';
import { ArbitrageExecutor } from './arbitrage-executor';

// Re-export executor classes for external use
export { TestOscillatorExecutor } from './test-oscillator-executor';
export { MarketMakerExecutor } from './market-maker-executor';
export { ArbitrageExecutor } from './arbitrage-executor';

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

/**
 * Clean up any per-bot state stored by strategy executors.
 * Call this when a bot is deleted to prevent memory leaks.
 */
export function cleanupBotState(botId: string): void {
  const arbExecutor = executors.get('arbitrage') as ArbitrageExecutor | undefined;
  if (arbExecutor?.cleanupBot) {
    arbExecutor.cleanupBot(botId);
  }
}

// ============================================================================
// Register Built-in Strategies
// ============================================================================

// Register built-in executors
registerStrategy('test-oscillator', new TestOscillatorExecutor());
registerStrategy('market-maker', new MarketMakerExecutor());
registerStrategy('arbitrage', new ArbitrageExecutor());
