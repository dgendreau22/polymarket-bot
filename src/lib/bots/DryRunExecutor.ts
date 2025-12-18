/**
 * Dry Run Executor
 *
 * Simulates trade execution using real prices but without placing actual orders.
 * Used for testing strategies in dry_run mode.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Trade, StrategySignal, TradeExecutionResult } from './types';
import type { Bot } from './Bot';

/**
 * Execute a simulated trade
 *
 * Uses current market price from the bot's price feed
 * Simulates instant fills with no slippage
 */
export async function executeDryRunTrade(
  bot: Bot,
  signal: StrategySignal
): Promise<TradeExecutionResult> {
  try {
    const now = new Date();
    const instance = bot.toInstance();

    // Create trade record
    const trade: Trade = {
      id: uuidv4(),
      botId: bot.id,
      strategySlug: bot.strategySlug,
      marketId: bot.marketId,
      assetId: bot.assetId || '',
      mode: 'dry_run',
      side: signal.action as 'BUY' | 'SELL',
      outcome: signal.side,
      price: signal.price,
      quantity: signal.quantity,
      totalValue: (parseFloat(signal.price) * parseFloat(signal.quantity)).toFixed(6),
      fee: '0',
      pnl: '0',
      status: 'filled',
      executedAt: now,
      createdAt: now,
    };

    // Calculate PnL for sell trades
    if (signal.action === 'SELL') {
      const position = instance.position;
      const avgEntry = parseFloat(position.avgEntryPrice);
      const exitPrice = parseFloat(signal.price);
      const quantity = parseFloat(signal.quantity);
      const pnl = (exitPrice - avgEntry) * quantity;
      trade.pnl = pnl.toFixed(6);
    }

    console.log(
      `[DryRun] Executed: ${trade.side} ${trade.quantity} ${trade.outcome} @ ${trade.price} | PnL: ${trade.pnl}`
    );

    return {
      success: true,
      trade,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[DryRun] Execution failed:`, errorMessage);

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Create a dry run executor function for a bot
 */
export function createDryRunExecutor(): (bot: Bot, signal: StrategySignal) => Promise<Trade | null> {
  return async (bot: Bot, signal: StrategySignal): Promise<Trade | null> => {
    const result = await executeDryRunTrade(bot, signal);

    if (result.success && result.trade) {
      return result.trade;
    }

    return null;
  };
}
