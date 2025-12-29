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
import type { OrderBook } from '../polymarket/types';
import { createLimitOrder, rowToLimitOrder, updateOrderFill } from '../persistence/LimitOrderRepository';

/**
 * Check if an order is marketable (would fill immediately against the order book)
 */
function getMarketableFillPrice(
  side: 'BUY' | 'SELL',
  orderPrice: number,
  orderBook: OrderBook | null
): string | null {
  if (!orderBook) return null;

  if (side === 'BUY') {
    const asks = orderBook.asks || [];
    if (asks.length === 0) return null;
    const sortedAsks = [...asks].sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
    const bestAsk = parseFloat(sortedAsks[0].price);
    if (orderPrice >= bestAsk) {
      console.log(`[DryRun] Marketable BUY: order @ ${orderPrice} >= best ask @ ${bestAsk}`);
      return sortedAsks[0].price;
    }
  } else {
    const bids = orderBook.bids || [];
    if (bids.length === 0) return null;
    const sortedBids = [...bids].sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
    const bestBid = parseFloat(sortedBids[0].price);
    if (orderPrice <= bestBid) {
      console.log(`[DryRun] Marketable SELL: order @ ${orderPrice} <= best bid @ ${bestBid}`);
      return sortedBids[0].price;
    }
  }
  return null;
}

/**
 * Execute a simulated trade
 *
 * Creates a pending limit order and a pending trade.
 * The order will be filled when a real market trade crosses the price.
 *
 * If the order is marketable (crosses the spread), it fills immediately
 * at the best available price.
 */
export async function executeDryRunTrade(
  bot: Bot,
  signal: StrategySignal,
  orderBook?: OrderBook | null
): Promise<TradeExecutionResult> {
  try {
    const now = new Date();
    const orderId = uuidv4();
    const tradeId = uuidv4();
    const side = signal.action as 'BUY' | 'SELL';
    const orderPrice = parseFloat(signal.price);

    // Check if order is marketable (would fill immediately)
    const fillPrice = getMarketableFillPrice(side, orderPrice, orderBook || null);
    const isMarketable = fillPrice !== null;

    // Create limit order in database
    const orderRow = createLimitOrder({
      id: orderId,
      botId: bot.id,
      assetId: bot.assetId || '',
      side,
      outcome: signal.side,
      price: signal.price,
      quantity: signal.quantity,
      createdAt: now,
    });

    const limitOrder: LimitOrder = rowToLimitOrder(orderRow);

    // Determine trade status and actual execution price
    const actualPrice = isMarketable ? fillPrice : signal.price;
    const status = isMarketable ? 'filled' : 'pending';

    // If marketable, mark order as filled immediately
    if (isMarketable) {
      updateOrderFill(orderId, signal.quantity, 'filled');
      console.log(
        `[DryRun] Marketable order filled immediately: ${side} ${signal.quantity} @ ${fillPrice} (limit was ${signal.price})`
      );
    }

    // Create trade record
    const trade: Trade = {
      id: tradeId,
      botId: bot.id,
      strategySlug: bot.strategySlug,
      marketId: bot.marketId,
      assetId: bot.assetId || '',
      mode: 'dry_run',
      side,
      outcome: signal.side,
      price: actualPrice,
      quantity: signal.quantity,
      totalValue: (parseFloat(actualPrice) * parseFloat(signal.quantity)).toFixed(6),
      fee: '0',
      pnl: '0',
      status,
      orderId: orderId,
      executedAt: now,
      createdAt: now,
    };

    if (!isMarketable) {
      console.log(
        `[DryRun] Order placed: ${trade.side} ${trade.quantity} ${trade.outcome} @ ${trade.price} | Order ID: ${orderId}`
      );
    }

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
    // Get current order book from bot for marketable order check
    const orderBook = bot.getOrderBook();
    const result = await executeDryRunTrade(bot, signal, orderBook);

    if (result.success && result.trade) {
      return result.trade;
    }

    return null;
  };
}
