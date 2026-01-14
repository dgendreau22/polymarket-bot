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
import {
  getOpenOrdersByBotId,
  getOpenOrdersByAssetId,
  getLimitOrderById,
  updateOrderFill,
  rowToLimitOrder,
} from '../persistence/LimitOrderRepository';
import { createTrade, updateTradeStatus, getTrades } from '../persistence/TradeRepository';
import { getPosition, updatePosition, getOrCreatePosition, getBotById } from '../persistence/BotRepository';
import { PRECISION } from '../constants';
import { calculatePositionUpdate } from '../utils/PositionCalculator';
import { v4 as uuidv4 } from 'uuid';

/**
 * Check if an order is still open and available for filling
 * Prevents race conditions by fetching fresh state from DB
 */
function isOrderOpenForFill(orderId: string): LimitOrderRow | null {
  const freshOrder = getLimitOrderById(orderId);
  if (!freshOrder || freshOrder.status === 'filled' || freshOrder.status === 'cancelled') {
    return null;
  }
  return freshOrder;
}

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
    // Get fresh order state from DB to prevent race conditions
    const freshOrder = isOrderOpenForFill(order.id);
    if (!freshOrder) {
      continue; // Order already filled or cancelled by another process
    }

    const orderPrice = parseFloat(freshOrder.price);
    const orderQuantity = parseFloat(freshOrder.quantity);
    const filledQuantity = parseFloat(freshOrder.filled_quantity);
    const remainingQuantity = orderQuantity - filledQuantity;

    // Check if trade price crosses order price
    const shouldFill = checkPriceCrossing(freshOrder.side, tradePrice, orderPrice);

    console.log(`[OrderMatcher] Order ${freshOrder.id.slice(0, 8)}... | ${freshOrder.side} @ ${orderPrice} | trade @ ${tradePrice} | shouldFill: ${shouldFill}`);

    if (shouldFill && remainingQuantity > 0) {
      // Calculate fill amount
      // For dry-run simulation, if trade size is 0 or unknown, fill the entire remaining order
      // (simulating infinite liquidity at the market price)
      let fillAmount = tradeSize > 0 ? Math.min(tradeSize, remainingQuantity) : remainingQuantity;

      // For SELL orders, check if there's enough position to sell
      if (freshOrder.side === 'SELL') {
        const bot = getBotById(freshOrder.bot_id);
        if (bot) {
          const position = getOrCreatePosition(freshOrder.bot_id, bot.market_id, freshOrder.asset_id);
          const currentSize = parseFloat(position.size);
          if (currentSize <= 0) {
            console.log(`[OrderMatcher] Skipping SELL fill - no position to sell`);
            continue;
          }
          // Only fill up to available position
          if (fillAmount > currentSize) {
            console.log(`[OrderMatcher] Limiting SELL fill from ${fillAmount} to ${currentSize} (position limit)`);
            fillAmount = currentSize;
          }
        }
      }

      const newFilledQuantity = filledQuantity + fillAmount;
      const newRemainingQuantity = orderQuantity - newFilledQuantity;
      const isFullyFilled = newRemainingQuantity <= PRECISION.FLOAT_TOLERANCE;

      // Determine new order status
      const newStatus = isFullyFilled ? 'filled' : 'partially_filled';

      // Update position and trade for this fill FIRST
      const tradeCreated = updateTradeForOrderFill(freshOrder.id, freshOrder.bot_id, freshOrder.asset_id, freshOrder.outcome, lastTrade.price, fillAmount, isFullyFilled, freshOrder.side, newFilledQuantity);

      // Only update order if trade was created successfully
      if (tradeCreated) {
        updateOrderFill(freshOrder.id, newFilledQuantity.toFixed(6), newStatus);
      } else {
        console.warn(`[OrderMatcher] Trade not created for order ${freshOrder.id.slice(0, 8)}..., skipping order update`);
        continue;
      }

      // Create fill result
      const fillResult: FillResult = {
        orderId: freshOrder.id,
        botId: freshOrder.bot_id,
        filledQuantity: fillAmount.toFixed(6),
        remainingQuantity: newRemainingQuantity.toFixed(6),
        fillPrice: lastTrade.price,
        isFullyFilled,
        side: freshOrder.side,
        outcome: freshOrder.outcome,
      };

      fills.push(fillResult);

      console.log(
        `[OrderMatcher] Order ${freshOrder.id} ${isFullyFilled ? 'filled' : 'partially filled'}: ` +
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
 * @param outcome - The outcome (YES or NO) for the position
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
  outcome: 'YES' | 'NO',
  fillPrice: string,
  fillAmount: number,
  isFullyFilled: boolean,
  orderSide: 'BUY' | 'SELL',
  totalFilledQuantity: number
): boolean {
  const fillPriceNum = parseFloat(fillPrice);

  // Get or create position - this ensures position exists for first trade
  const bot = getBotById(botId);
  if (!bot) {
    console.warn(`[OrderMatcher] Bot not found: ${botId}`);
    return false;
  }

  const position = getOrCreatePosition(botId, bot.market_id, assetId, outcome);
  const currentSize = parseFloat(position.size);
  let pnl = 0;

  if (orderSide === 'SELL') {
    // Safety check: can't sell more than current position
    if (currentSize < fillAmount) {
      console.warn(`[OrderMatcher] Cannot SELL ${fillAmount} - only have ${currentSize} shares. Skipping fill.`);
      return false;
    }
  }

  // Use centralized position calculator
  const currentAvgPrice = parseFloat(position.avg_entry_price);
  const update = calculatePositionUpdate(
    currentSize,
    currentAvgPrice,
    fillAmount,
    fillPriceNum,
    orderSide
  );

  pnl = update.realizedPnl;
  const currentRealizedPnl = parseFloat(position.realized_pnl);
  const newRealizedPnl = currentRealizedPnl + pnl;

  updatePosition(botId, assetId, {
    size: update.newSize.toFixed(6),
    avgEntryPrice: update.newAvgPrice.toFixed(6),
    realizedPnl: orderSide === 'SELL' ? newRealizedPnl.toFixed(6) : undefined,
  });

  if (orderSide === 'SELL') {
    console.log(`[OrderMatcher] SELL fill: ${fillAmount} @ ${fillPrice} | PnL: ${pnl.toFixed(4)} | Position: ${currentSize} -> ${update.newSize}`);
  } else {
    console.log(`[OrderMatcher] BUY fill: ${fillAmount} @ ${fillPrice} | Position: ${currentSize} -> ${update.newSize} @ avg ${update.newAvgPrice.toFixed(4)}`);
  }

  // Create a new filled trade record for THIS fill event (partial or full)
  const order = getLimitOrderById(orderId);
  if (!order) {
    console.warn(`[OrderMatcher] Order not found: ${orderId}`);
    return false;
  }

  const totalValue = (fillPriceNum * fillAmount).toFixed(6);
  const now = new Date();

  // Create filled trade record for this fill
  const fillTrade = createTrade({
    id: uuidv4(),
    botId,
    strategySlug: bot.strategy_slug,
    marketId: bot.market_id,
    assetId,
    mode: bot.mode as 'dry_run' | 'live',
    side: orderSide,
    outcome: order.outcome,
    price: fillPrice,
    quantity: fillAmount.toFixed(6),
    totalValue,
    fee: '0',
    pnl: pnl.toFixed(6),
    status: 'filled',
    orderId,
    executedAt: now,
    createdAt: now,
  });

  console.log(`[OrderMatcher] Fill trade created: ${orderSide} ${fillAmount} @ ${fillPrice} | PnL: ${pnl.toFixed(4)} | Trade ID: ${fillTrade.id.slice(0, 8)}...`);

  // If order is now fully filled, cancel the original pending trade (if any)
  if (isFullyFilled) {
    const pendingTrades = getTrades({
      botId,
      status: 'pending',
    });

    const pendingTrade = pendingTrades.find((t) => t.order_id === orderId);
    if (pendingTrade) {
      // Mark the pending trade as cancelled since we've created individual fill records
      updateTradeStatus(pendingTrade.id, 'cancelled', {});
      console.log(`[OrderMatcher] Pending trade ${pendingTrade.id.slice(0, 8)}... cancelled (replaced by fill records)`);
    }
  }

  return true;
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
 * Fill a single specific order
 *
 * @param order - The order to fill (used for ID lookup)
 * @param fillPrice - The price to fill at
 * @param fillAmount - The amount to fill
 * @returns FillResult if filled, null otherwise
 */
function fillSingleOrder(
  order: LimitOrderRow,
  fillPrice: string,
  fillAmount: number
): FillResult | null {
  // Get fresh order state from DB to prevent race conditions
  const freshOrder = isOrderOpenForFill(order.id);
  if (!freshOrder) {
    return null; // Order already filled or cancelled by another process
  }

  const orderQuantity = parseFloat(freshOrder.quantity);
  const filledQuantity = parseFloat(freshOrder.filled_quantity);
  const remainingQuantity = orderQuantity - filledQuantity;

  if (remainingQuantity <= 0) return null;

  let actualFillAmount = Math.min(fillAmount, remainingQuantity);

  // For SELL orders, check if there's enough position
  if (freshOrder.side === 'SELL') {
    const bot = getBotById(freshOrder.bot_id);
    if (bot) {
      const position = getOrCreatePosition(freshOrder.bot_id, bot.market_id, freshOrder.asset_id);
      const currentSize = parseFloat(position.size);
      if (currentSize <= 0) {
        console.log(`[OrderMatcher] Skipping SELL fill - no position to sell`);
        return null;
      }
      if (actualFillAmount > currentSize) {
        console.log(`[OrderMatcher] Limiting SELL fill from ${actualFillAmount} to ${currentSize} (position limit)`);
        actualFillAmount = currentSize;
      }
    }
  }

  const newFilledQuantity = filledQuantity + actualFillAmount;
  const newRemainingQuantity = orderQuantity - newFilledQuantity;
  const isFullyFilled = newRemainingQuantity <= PRECISION.FLOAT_TOLERANCE;

  const newStatus = isFullyFilled ? 'filled' : 'partially_filled';

  // Update position and trade for this fill FIRST
  const tradeCreated = updateTradeForOrderFill(
    freshOrder.id,
    freshOrder.bot_id,
    freshOrder.asset_id,
    freshOrder.outcome,
    fillPrice,
    actualFillAmount,
    isFullyFilled,
    freshOrder.side,
    newFilledQuantity
  );

  // Only update order if trade was created successfully
  if (!tradeCreated) {
    console.warn(`[OrderMatcher] Trade not created for order ${freshOrder.id.slice(0, 8)}..., skipping`);
    return null;
  }

  updateOrderFill(freshOrder.id, newFilledQuantity.toFixed(6), newStatus);

  console.log(
    `[OrderMatcher] Order ${freshOrder.id.slice(0, 8)}... ${isFullyFilled ? 'filled' : 'partially filled'}: ` +
      `${actualFillAmount.toFixed(4)} @ ${fillPrice} | ` +
      `Remaining: ${newRemainingQuantity.toFixed(4)}`
  );

  return {
    orderId: freshOrder.id,
    botId: freshOrder.bot_id,
    filledQuantity: actualFillAmount.toFixed(6),
    remainingQuantity: newRemainingQuantity.toFixed(6),
    fillPrice,
    isFullyFilled,
    side: freshOrder.side,
    outcome: freshOrder.outcome,
  };
}

/**
 * Fill pending orders that are marketable against the current order book(s)
 *
 * @param botId - The bot ID to check orders for
 * @param yesOrderBook - YES outcome order book
 * @param noOrderBook - NO outcome order book (optional, for dual-asset bots)
 * @returns Array of fill results
 */
export function fillMarketableOrders(
  botId: string,
  yesOrderBook: OrderBook | null,
  noOrderBook?: OrderBook | null
): FillResult[] {
  const fills: FillResult[] = [];

  // Helper to get best prices from an order book
  const getBestPrices = (orderBook: OrderBook | null) => {
    if (!orderBook) return { bestBid: 0, bestAsk: Infinity, sortedBids: [], sortedAsks: [] };

    const bids = orderBook.bids || [];
    const asks = orderBook.asks || [];

    const sortedBids = [...bids].sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
    const sortedAsks = [...asks].sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

    return {
      bestBid: sortedBids.length > 0 ? parseFloat(sortedBids[0].price) : 0,
      bestAsk: sortedAsks.length > 0 ? parseFloat(sortedAsks[0].price) : Infinity,
      sortedBids,
      sortedAsks,
    };
  };

  const yesPrices = getBestPrices(yesOrderBook);
  const noPrices = getBestPrices(noOrderBook || null);

  // Debug: Log order book state
  if (yesPrices.bestAsk === Infinity || noPrices.bestAsk === Infinity) {
    console.log(`[OrderMatcher] WARNING: Order book missing - YES ask=${yesPrices.bestAsk === Infinity ? 'MISSING' : yesPrices.bestAsk}, NO ask=${noPrices.bestAsk === Infinity ? 'MISSING' : noPrices.bestAsk}`);
  }

  // Re-fetch open orders each iteration to get fresh state
  let openOrders = getOpenOrdersByBotId(botId);

  for (let i = 0; i < openOrders.length; i++) {
    const order = openOrders[i];
    const orderPrice = parseFloat(order.price);
    const remainingQty = parseFloat(order.quantity) - parseFloat(order.filled_quantity);

    if (remainingQty <= 0) continue;

    // Select the correct order book based on outcome
    const isNoOrder = order.outcome === 'NO';
    const prices = isNoOrder ? noPrices : yesPrices;

    let shouldFill = false;
    let fillPrice = '';

    if (order.side === 'BUY' && prices.bestAsk < Infinity && orderPrice >= prices.bestAsk) {
      shouldFill = true;
      fillPrice = prices.sortedAsks[0].price;
    } else if (order.side === 'SELL' && prices.bestBid > 0 && orderPrice <= prices.bestBid) {
      shouldFill = true;
      fillPrice = prices.sortedBids[0].price;
    }

    if (shouldFill) {
      console.log(
        `[OrderMatcher] Filling marketable ${order.outcome} ${order.side} @ ${orderPrice} against ${order.side === 'BUY' ? 'ask' : 'bid'} @ ${fillPrice}`
      );

      // Fill this specific order only (not all matching orders)
      const fill = fillSingleOrder(order, fillPrice, remainingQty);
      if (fill) {
        fills.push(fill);
      }

      // Re-fetch orders to get fresh state for next iteration
      openOrders = getOpenOrdersByBotId(botId);
    }
  }

  return fills;
}
