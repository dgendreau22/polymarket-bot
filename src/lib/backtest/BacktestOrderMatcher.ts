/**
 * Backtest Order Matcher
 *
 * Simulates limit order fills during backtest by scanning historical ticks.
 * Reuses the same price crossing logic as the live LimitOrderMatcher.
 */

import type {
  BacktestPendingOrder,
  BacktestFill,
  ProcessedTick,
  SnapshotPrice,
} from './types';

/**
 * Check if a trade price crosses the order price (triggers a fill)
 *
 * Logic matches LimitOrderMatcher.ts:132-146:
 * - BUY orders fill when trade price <= order price (someone sold at/below our buy price)
 * - SELL orders fill when trade price >= order price (someone bought at/above our sell price)
 *
 * @param orderSide - The side of the order (BUY or SELL)
 * @param tradePrice - The price of the market trade
 * @param orderPrice - The price of the limit order
 * @returns true if the order should be filled
 */
export function checkPriceCrossing(
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
 * Check if an order would fill immediately at creation (marketable order)
 *
 * A marketable order crosses the current spread:
 * - BUY at or above best ask fills immediately at best ask
 * - SELL at or below best bid fills immediately at best bid
 *
 * @param side - Order side (BUY or SELL)
 * @param price - Order limit price
 * @param snapshot - Current market snapshot with bid/ask
 * @param outcome - YES or NO outcome
 * @returns Fill price if marketable, null if not
 */
export function getMarketableFillPrice(
  side: 'BUY' | 'SELL',
  price: number,
  snapshot: SnapshotPrice | null,
  outcome: 'YES' | 'NO'
): number | null {
  if (!snapshot) return null;

  // Get bid/ask for the correct outcome
  const bid = outcome === 'YES' ? snapshot.yesBid : snapshot.noBid;
  const ask = outcome === 'YES' ? snapshot.yesAsk : snapshot.noAsk;

  if (side === 'BUY') {
    // BUY order at or above best ask fills immediately at best ask
    if (price >= ask && ask > 0) {
      return ask;
    }
  } else {
    // SELL order at or below best bid fills immediately at best bid
    if (price <= bid && bid > 0) {
      return bid;
    }
  }

  return null;
}

/**
 * Process historical ticks to find order fills
 *
 * Scans ticks between startTime and endTime, checking each against pending orders.
 * When a tick price crosses an order's limit price, the order fills.
 *
 * @param orders - Array of pending orders to check
 * @param ticks - Array of historical ticks (must be sorted by timestamp)
 * @param startTime - Start of time window (Unix ms)
 * @param endTime - End of time window (Unix ms)
 * @returns Array of fills that occurred
 */
export function processTicksForFills(
  orders: BacktestPendingOrder[],
  ticks: ProcessedTick[],
  startTime: number,
  endTime: number
): BacktestFill[] {
  const fills: BacktestFill[] = [];

  // Filter ticks to the time window
  const windowTicks = ticks.filter(
    (t) => t.timestamp >= startTime && t.timestamp <= endTime
  );

  if (windowTicks.length === 0 || orders.length === 0) {
    return fills;
  }

  // Create a map of orders by ID for efficient updates
  const orderMap = new Map<string, BacktestPendingOrder>();
  for (const order of orders) {
    // Only process orders with unfilled quantity
    if (order.quantity - order.filledQuantity > 0) {
      orderMap.set(order.id, { ...order });
    }
  }

  // Process each tick in chronological order
  for (const tick of windowTicks) {
    // Check each order against this tick
    for (const [orderId, order] of orderMap.entries()) {
      // Only check orders for matching outcome
      if (order.outcome !== tick.outcome) continue;

      // Check if order was created before this tick
      if (order.createdAt > tick.timestamp) continue;

      const remainingQty = order.quantity - order.filledQuantity;
      if (remainingQty <= 0) continue;

      // Check if price crosses
      if (checkPriceCrossing(order.side, tick.price, order.price)) {
        // Fill at the tick price (the actual market trade price)
        // For realistic simulation, fill quantity is limited by tick size
        const fillQty = Math.min(remainingQty, tick.size);
        if (fillQty <= 0) continue;

        const newFilledQty = order.filledQuantity + fillQty;
        const isFullyFilled = newFilledQty >= order.quantity;

        fills.push({
          orderId,
          fillPrice: tick.price,
          fillQuantity: fillQty,
          timestamp: tick.timestamp,
          isFullyFilled,
        });

        // Update order state in map
        order.filledQuantity = newFilledQty;

        // Remove fully filled orders from map
        if (isFullyFilled) {
          orderMap.delete(orderId);
        }
      }
    }
  }

  return fills;
}

/**
 * Find pending orders that would be filled by a given snapshot
 *
 * Useful for checking orders against current market state without processing ticks.
 *
 * @param orders - Array of pending orders
 * @param snapshot - Current market snapshot
 * @returns Array of orders that would fill and their fill prices
 */
export function findMarketableOrders(
  orders: BacktestPendingOrder[],
  snapshot: SnapshotPrice
): Array<{ order: BacktestPendingOrder; fillPrice: number }> {
  const marketable: Array<{ order: BacktestPendingOrder; fillPrice: number }> = [];

  for (const order of orders) {
    if (order.quantity - order.filledQuantity <= 0) continue;

    const fillPrice = getMarketableFillPrice(
      order.side,
      order.price,
      snapshot,
      order.outcome
    );

    if (fillPrice !== null) {
      marketable.push({ order, fillPrice });
    }
  }

  return marketable;
}

/**
 * Check if any ticks in a time window would fill an order
 *
 * Quick check without creating fill records - useful for validation.
 *
 * @param order - The pending order to check
 * @param ticks - Array of historical ticks
 * @param startTime - Start of time window (Unix ms)
 * @param endTime - End of time window (Unix ms)
 * @returns true if any tick would trigger a fill
 */
export function wouldOrderFillInWindow(
  order: BacktestPendingOrder,
  ticks: ProcessedTick[],
  startTime: number,
  endTime: number
): boolean {
  const remainingQty = order.quantity - order.filledQuantity;
  if (remainingQty <= 0) return false;

  for (const tick of ticks) {
    if (tick.timestamp < startTime || tick.timestamp > endTime) continue;
    if (tick.outcome !== order.outcome) continue;
    if (tick.timestamp < order.createdAt) continue;

    if (checkPriceCrossing(order.side, tick.price, order.price)) {
      return true;
    }
  }

  return false;
}
