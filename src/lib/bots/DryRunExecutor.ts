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
import { getOrCreatePosition, updatePosition } from '../persistence/BotRepository';
import { calculatePositionUpdate } from '../utils/PositionCalculator';

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

    // Debug: log order book state at order creation
    if (orderBook) {
      const asks = orderBook.asks || [];
      const bids = orderBook.bids || [];
      const sortedAsks = [...asks].sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
      const sortedBids = [...bids].sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
      const bestAsk = sortedAsks.length > 0 ? sortedAsks[0].price : 'none';
      const bestBid = sortedBids.length > 0 ? sortedBids[0].price : 'none';
      console.log(`[DryRun] Order creation: ${side} @ ${orderPrice} | OrderBook: bid=${bestBid}, ask=${bestAsk}`);
    } else {
      console.log(`[DryRun] Order creation: ${side} @ ${orderPrice} | OrderBook: NULL`);
    }

    // Check if order is marketable (would fill immediately)
    const fillPrice = getMarketableFillPrice(side, orderPrice, orderBook || null);
    const isMarketable = fillPrice !== null;

    // Determine correct asset ID based on signal side (YES or NO)
    const assetId = signal.side === 'YES' ? (bot.assetId || '') : (bot.noAssetId || bot.assetId || '');

    // Create limit order in database
    const orderRow = createLimitOrder({
      id: orderId,
      botId: bot.id,
      assetId,
      side,
      outcome: signal.side,
      price: signal.price,
      quantity: signal.quantity,
      createdAt: now,
    });

    const limitOrder: LimitOrder = rowToLimitOrder(orderRow);

    // For marketable orders, fill immediately and create a trade
    if (isMarketable) {
      updateOrderFill(orderId, signal.quantity, 'filled');
      console.log(
        `[DryRun] Marketable order filled immediately: ${side} ${signal.quantity} @ ${fillPrice} (limit was ${signal.price})`
      );

      // Calculate PnL and update position
      const fillPriceNum = parseFloat(fillPrice);
      const fillQuantity = parseFloat(signal.quantity);
      let pnl = 0;

      // Get current position
      const position = getOrCreatePosition(bot.id, bot.marketId, assetId, signal.side);
      const currentSize = parseFloat(position.size);
      const currentAvgPrice = parseFloat(position.avg_entry_price);

      // Calculate position update
      const update = calculatePositionUpdate(
        currentSize,
        currentAvgPrice,
        fillQuantity,
        fillPriceNum,
        side
      );

      if (side === 'SELL') {
        pnl = update.realizedPnl;
        const newRealizedPnl = parseFloat(position.realized_pnl) + pnl;

        // Update position with realized PnL
        updatePosition(bot.id, assetId, {
          size: update.newSize.toFixed(6),
          avgEntryPrice: update.newAvgPrice.toFixed(6),
          realizedPnl: newRealizedPnl.toFixed(6),
        });

        console.log(`[DryRun] SELL: ${fillQuantity} @ ${fillPrice} | PnL: ${pnl.toFixed(4)} | Position: ${currentSize} -> ${update.newSize}`);
      } else {
        // BUY: update position without PnL
        updatePosition(bot.id, assetId, {
          size: update.newSize.toFixed(6),
          avgEntryPrice: update.newAvgPrice.toFixed(6),
        });

        console.log(`[DryRun] BUY: ${fillQuantity} @ ${fillPrice} | Position: ${currentSize} -> ${update.newSize} @ avg ${update.newAvgPrice.toFixed(4)}`);
      }

      // Create trade record for immediate fill
      const trade: Trade = {
        id: tradeId,
        botId: bot.id,
        strategySlug: bot.strategySlug,
        marketId: bot.marketId,
        assetId,
        mode: 'dry_run',
        side,
        outcome: signal.side,
        price: fillPrice,
        quantity: signal.quantity,
        totalValue: (fillPriceNum * fillQuantity).toFixed(6),
        fee: '0',
        pnl: pnl.toFixed(6),
        status: 'filled',
        orderId: orderId,
        executedAt: now,
        createdAt: now,
      };

      return {
        success: true,
        trade,
        orderId,
      };
    }

    // For non-marketable orders, only create the order (no trade yet)
    // Trade records will be created by LimitOrderMatcher when the order fills
    console.log(
      `[DryRun] Order placed: ${side} ${signal.quantity} ${signal.side} @ ${signal.price} | Order ID: ${orderId}`
    );

    return {
      success: true,
      trade: undefined, // No trade until order fills
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
    // Get correct order book based on signal side (YES or NO)
    // YES signals use YES order book, NO signals use NO order book
    const orderBook = signal.side === 'YES'
      ? bot.getOrderBook()
      : (bot.getNoOrderBook() || bot.getOrderBook());
    const result = await executeDryRunTrade(bot, signal, orderBook);

    if (result.success && result.trade) {
      return result.trade;
    }

    return null;
  };
}
