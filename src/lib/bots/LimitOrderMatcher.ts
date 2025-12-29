/**
 * Limit Order Matcher
 *
 * Processes real market trades to fill pending limit orders.
 * Orders fill when market trade price crosses the order price:
 * - BUY orders fill when trade price <= order price
 * - SELL orders fill when trade price >= order price
 */

import type { LastTrade, OrderBook } from '../polymarket/types';
import type { FillResult, LimitOrderRow } from './types';
import { getOpenOrdersByBotId } from '../persistence/LimitOrderRepository';
import {
  getOpenOrdersByAssetId,
  updateOrderFill,
  rowToLimitOrder,
} from '../persistence/LimitOrderRepository';
import { updateTradeStatus, getTrades } from '../persistence/TradeRepository';
import { getPosition, updatePosition, getOrCreatePosition, getBotById } from '../persistence/BotRepository';

/**
 * Process a market trade to check for order fills
 *
 * @param lastTrade - The real market trade that just occurred
 * @returns Array of fill results for orders that were filled
 */
export function processTradeForFills(lastTrade: LastTrade): FillResult[] {
  const fills: FillResult[] = [];
  const tradePrice = parseFloat(lastTrade.price);
  const tradeSize = parseFloat(lastTrade.size);

  // Get all open orders for this asset
  const openOrders = getOpenOrdersByAssetId(lastTrade.asset_id);

  console.log(`[OrderMatcher] Processing trade @ ${lastTrade.price} for asset ${lastTrade.asset_id?.slice(0, 8)}... | Found ${openOrders.length} open orders`);

  for (const order of openOrders) {
    const orderPrice = parseFloat(order.price);
    const orderQuantity = parseFloat(order.quantity);
    const filledQuantity = parseFloat(order.filled_quantity);
    const remainingQuantity = orderQuantity - filledQuantity;

    // Check if trade price crosses order price
    const shouldFill = checkPriceCrossing(order.side, tradePrice, orderPrice);

    console.log(`[OrderMatcher] Order ${order.id.slice(0, 8)}... | ${order.side} @ ${orderPrice} | trade @ ${tradePrice} | shouldFill: ${shouldFill}`);

    if (shouldFill && remainingQuantity > 0) {
      // Calculate fill amount
      // For dry-run simulation, if trade size is 0 or unknown, fill the entire remaining order
      // (simulating infinite liquidity at the market price)
      const fillAmount = tradeSize > 0 ? Math.min(tradeSize, remainingQuantity) : remainingQuantity;
      const newFilledQuantity = filledQuantity + fillAmount;
      const newRemainingQuantity = orderQuantity - newFilledQuantity;
      const isFullyFilled = newRemainingQuantity <= 0.000001; // Tolerance for floating point

      // Determine new order status
      const newStatus = isFullyFilled ? 'filled' : 'partially_filled';

      // Update order in database
      updateOrderFill(order.id, newFilledQuantity.toFixed(6), newStatus);

      // Update position and trade for this fill
      updateTradeForOrderFill(order.id, order.bot_id, order.asset_id, lastTrade.price, fillAmount, isFullyFilled, order.side, newFilledQuantity);

      // Create fill result
      const fillResult: FillResult = {
        orderId: order.id,
        botId: order.bot_id,
        filledQuantity: fillAmount.toFixed(6),
        remainingQuantity: newRemainingQuantity.toFixed(6),
        fillPrice: lastTrade.price,
        isFullyFilled,
        side: order.side,
        outcome: order.outcome,
      };

      fills.push(fillResult);

      console.log(
        `[OrderMatcher] Order ${order.id} ${isFullyFilled ? 'filled' : 'partially filled'}: ` +
          `${fillAmount.toFixed(4)} @ ${lastTrade.price} | ` +
          `Remaining: ${newRemainingQuantity.toFixed(4)}`
      );
    }
  }

  return fills;
}

/**
 * Check if a trade price crosses the order price
 *
 * @param orderSide - The side of the order (BUY or SELL)
 * @param tradePrice - The price of the market trade
 * @param orderPrice - The price of the limit order
 * @returns true if the order should be filled
 */
function checkPriceCrossing(
  orderSide: 'BUY' | 'SELL',
  tradePrice: number,
  orderPrice: number
): boolean {
  if (orderSide === 'BUY') {
    // BUY orders fill when trade price <= order price
    // (someone sold at or below our buy price)
    return tradePrice <= orderPrice;
  } else {
    // SELL orders fill when trade price >= order price
    // (someone bought at or above our sell price)
    return tradePrice >= orderPrice;
  }
}

/**
 * Update the trade record when its order is filled
 * Also updates position and calculates PnL for SELL trades
 *
 * @param orderId - The order ID
 * @param botId - The bot ID
 * @param assetId - The asset ID (needed to create position if missing)
 * @param fillPrice - The price at which the order was filled
 * @param fillAmount - The quantity filled in this fill event
 * @param isFullyFilled - Whether the order is now fully filled
 * @param orderSide - The side of the order (BUY or SELL)
 * @param totalFilledQuantity - The total quantity filled so far (for updating trade record)
 */
function updateTradeForOrderFill(
  orderId: string,
  botId: string,
  assetId: string,
  fillPrice: string,
  fillAmount: number,
  isFullyFilled: boolean,
  orderSide: 'BUY' | 'SELL',
  totalFilledQuantity: number
): void {
  const fillPriceNum = parseFloat(fillPrice);

  // Get or create position - this ensures position exists for first trade
  const bot = getBotById(botId);
  if (!bot) {
    console.warn(`[OrderMatcher] Bot not found: ${botId}`);
    return;
  }

  const position = getOrCreatePosition(botId, bot.market_id, assetId);
  const currentSize = parseFloat(position.size);
  let pnl = 0;

  if (orderSide === 'SELL') {
    // Safety check: can't sell more than current position
    if (currentSize < fillAmount) {
      console.warn(`[OrderMatcher] Cannot SELL ${fillAmount} - only have ${currentSize} shares. Skipping fill.`);
      return;
    }

    const avgEntryPrice = parseFloat(position.avg_entry_price);
    // PnL = (sell_price - avg_entry_price) * fillAmount
    pnl = (fillPriceNum - avgEntryPrice) * fillAmount;

    // Update position: reduce size and add to realized PnL
    const currentRealizedPnl = parseFloat(position.realized_pnl);
    const newSize = Math.max(0, currentSize - fillAmount);
    const newRealizedPnl = currentRealizedPnl + pnl;

    updatePosition(botId, {
      size: newSize.toFixed(6),
      realizedPnl: newRealizedPnl.toFixed(6),
      // Reset avg entry price if position is closed
      avgEntryPrice: newSize <= 0.000001 ? '0' : position.avg_entry_price,
    });

    console.log(`[OrderMatcher] SELL fill: ${fillAmount} @ ${fillPrice} | PnL: ${pnl.toFixed(4)} | Position: ${currentSize} -> ${newSize}`);
  } else {
    // BUY: increase size and update avg entry price
    const currentSize = parseFloat(position.size);
    const currentAvgPrice = parseFloat(position.avg_entry_price);
    const newSize = currentSize + fillAmount;

    // Calculate new weighted average entry price
    const totalCost = (currentSize * currentAvgPrice) + (fillAmount * fillPriceNum);
    const newAvgPrice = newSize > 0 ? totalCost / newSize : fillPriceNum;

    updatePosition(botId, {
      size: newSize.toFixed(6),
      avgEntryPrice: newAvgPrice.toFixed(6),
    });

    console.log(`[OrderMatcher] BUY fill: ${fillAmount} @ ${fillPrice} | Position: ${currentSize} -> ${newSize} @ avg ${newAvgPrice.toFixed(4)}`);
  }

  // Only update trade record when order is fully filled
  if (isFullyFilled) {
    // Find the pending trade associated with this order
    const pendingTrades = getTrades({
      botId,
      status: 'pending',
    });

    const trade = pendingTrades.find((t) => t.order_id === orderId);

    if (trade) {
      // Use totalFilledQuantity as the actual traded quantity (may differ from original order quantity for partial fills)
      const actualQuantity = totalFilledQuantity;
      const newTotalValue = (fillPriceNum * actualQuantity).toFixed(6);

      // For SELL trades, calculate total PnL for the whole trade
      let tradePnl = '0';
      if (orderSide === 'SELL') {
        // Use the PnL from position's realized PnL change
        // This is approximate since price may vary across partial fills
        const avgEntryPrice = parseFloat(position.avg_entry_price);
        tradePnl = ((fillPriceNum - avgEntryPrice) * actualQuantity).toFixed(6);
      }

      // Mark trade as filled with actual filled quantity
      updateTradeStatus(trade.id, 'filled', {
        pnl: tradePnl,
        price: fillPrice,
        totalValue: newTotalValue,
        quantity: actualQuantity.toFixed(6),
      });

      console.log(`[OrderMatcher] Trade ${trade.id.slice(0, 8)}... fully filled: ${actualQuantity} @ ${fillPrice} | PnL: ${tradePnl}`);
    } else {
      console.warn(`[OrderMatcher] No pending trade found for orderId ${orderId}`);
    }
  }
}

/**
 * Get fills for a specific bot
 *
 * @param botId - The bot ID to get fills for
 * @param lastTrade - The market trade to process
 * @returns Array of fill results for this bot only
 */
export function processTradeForBotFills(
  botId: string,
  lastTrade: LastTrade
): FillResult[] {
  const allFills = processTradeForFills(lastTrade);
  return allFills.filter((fill) => fill.botId === botId);
}

/**
 * Check if a specific order would be filled by a trade
 *
 * @param order - The limit order to check
 * @param tradePrice - The price to check against
 * @returns true if the order would be filled
 */
export function wouldOrderFill(order: LimitOrderRow, tradePrice: number): boolean {
  const orderPrice = parseFloat(order.price);
  return checkPriceCrossing(order.side, tradePrice, orderPrice);
}

/**
 * Fill pending orders that are marketable against the current order book
 *
 * @param botId - The bot ID to check orders for
 * @param orderBook - Current order book
 * @returns Array of fill results
 */
export function fillMarketableOrders(
  botId: string,
  orderBook: OrderBook | null
): FillResult[] {
  if (!orderBook) return [];

  const fills: FillResult[] = [];
  const openOrders = getOpenOrdersByBotId(botId);

  const bids = orderBook.bids || [];
  const asks = orderBook.asks || [];

  if (bids.length === 0 && asks.length === 0) return [];

  const sortedBids = [...bids].sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
  const sortedAsks = [...asks].sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

  const bestBid = sortedBids.length > 0 ? parseFloat(sortedBids[0].price) : 0;
  const bestAsk = sortedAsks.length > 0 ? parseFloat(sortedAsks[0].price) : Infinity;

  for (const order of openOrders) {
    const orderPrice = parseFloat(order.price);
    const remainingQty = parseFloat(order.quantity) - parseFloat(order.filled_quantity);

    if (remainingQty <= 0) continue;

    let shouldFill = false;
    let fillPrice = '';

    if (order.side === 'BUY' && bestAsk < Infinity && orderPrice >= bestAsk) {
      shouldFill = true;
      fillPrice = sortedAsks[0].price;
    } else if (order.side === 'SELL' && bestBid > 0 && orderPrice <= bestBid) {
      shouldFill = true;
      fillPrice = sortedBids[0].price;
    }

    if (shouldFill) {
      console.log(
        `[OrderMatcher] Filling marketable ${order.side} @ ${orderPrice} against ${order.side === 'BUY' ? 'ask' : 'bid'} @ ${fillPrice}`
      );

      const syntheticTrade: LastTrade = {
        asset_id: order.asset_id,
        price: fillPrice,
        size: remainingQty.toString(),
        side: order.side === 'BUY' ? 'sell' : 'buy',
        timestamp: new Date().toISOString(),
      };

      const orderFills = processTradeForFills(syntheticTrade);
      fills.push(...orderFills.filter(f => f.orderId === order.id));
    }
  }

  return fills;
}
