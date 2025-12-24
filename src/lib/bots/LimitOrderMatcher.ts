/**
 * Limit Order Matcher
 *
 * Processes real market trades to fill pending limit orders.
 * Orders fill when market trade price crosses the order price:
 * - BUY orders fill when trade price <= order price
 * - SELL orders fill when trade price >= order price
 */

import type { LastTrade } from '../polymarket/types';
import type { FillResult, LimitOrderRow } from './types';
import {
  getOpenOrdersByAssetId,
  updateOrderFill,
  rowToLimitOrder,
} from '../persistence/LimitOrderRepository';
import { updateTradeStatus, getTrades } from '../persistence/TradeRepository';

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

      // Update associated trade to filled status
      updateTradeForOrderFill(order.id, order.bot_id, lastTrade.price);

      // Create fill result
      const fillResult: FillResult = {
        orderId: order.id,
        botId: order.bot_id,
        filledQuantity: fillAmount.toFixed(6),
        remainingQuantity: newRemainingQuantity.toFixed(6),
        fillPrice: lastTrade.price,
        isFullyFilled,
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
 */
function updateTradeForOrderFill(orderId: string, botId: string, fillPrice: string): void {
  // Find the pending trade associated with this order
  const pendingTrades = getTrades({
    botId,
    status: 'pending',
  });

  console.log(`[OrderMatcher] Looking for pending trade with orderId ${orderId.slice(0, 8)}... | Found ${pendingTrades.length} pending trades`);

  const trade = pendingTrades.find((t) => t.order_id === orderId);

  if (trade) {
    // Calculate new total value based on fill price
    const quantity = parseFloat(trade.quantity);
    const newTotalValue = (parseFloat(fillPrice) * quantity).toFixed(6);

    console.log(`[OrderMatcher] Updating trade ${trade.id.slice(0, 8)}... | old price: ${trade.price} -> new price: ${fillPrice}`);

    // Update trade with fill price and new total value
    updateTradeStatus(trade.id, 'filled', {
      pnl: '0',
      price: fillPrice,
      totalValue: newTotalValue,
    });

    console.log(
      `[OrderMatcher] Trade ${trade.id} filled @ ${fillPrice} (was ${trade.price}) for order ${orderId}`
    );
  } else {
    console.warn(`[OrderMatcher] No pending trade found for orderId ${orderId}`);
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
