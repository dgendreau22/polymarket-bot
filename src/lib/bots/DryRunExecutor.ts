/**
 * Dry Run Executor
 *
 * Simulates trade execution using real prices but without placing actual orders.
 * Used for testing strategies in dry_run mode.
 *
 * Orders are created as pending and only fill when real market trades
 * cross the order price (BUY fills when trade <= order price, SELL fills
 * when trade >= order price).
 */

import { v4 as uuidv4 } from 'uuid';
import type { Trade, StrategySignal, TradeExecutionResult, LimitOrder } from './types';
import type { Bot } from './Bot';
import { createLimitOrder, rowToLimitOrder } from '../persistence/LimitOrderRepository';

/**
 * Execute a simulated trade
 *
 * Creates a pending limit order and a pending trade.
 * The order will be filled when a real market trade crosses the price.
 */
export async function executeDryRunTrade(
  bot: Bot,
  signal: StrategySignal
): Promise<TradeExecutionResult> {
  try {
    const now = new Date();
    const orderId = uuidv4();
    const tradeId = uuidv4();

    // Create limit order in database
    const orderRow = createLimitOrder({
      id: orderId,
      botId: bot.id,
      assetId: bot.assetId || '',
      side: signal.action as 'BUY' | 'SELL',
      outcome: signal.side,
      price: signal.price,
      quantity: signal.quantity,
      createdAt: now,
    });

    const limitOrder: LimitOrder = rowToLimitOrder(orderRow);

    // Create pending trade record (will be updated to 'filled' when order fills)
    const trade: Trade = {
      id: tradeId,
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
      status: 'pending', // Will be updated to 'filled' when order fills
      orderId: orderId,
      executedAt: now,
      createdAt: now,
    };

    console.log(
      `[DryRun] Order placed: ${trade.side} ${trade.quantity} ${trade.outcome} @ ${trade.price} | Order ID: ${orderId}`
    );

    return {
      success: true,
      trade,
      orderId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[DryRun] Order creation failed:`, errorMessage);

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
