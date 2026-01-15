/**
 * Limit Order Repository
 *
 * CRUD operations for limit order persistence.
 */

import { getDatabase } from './database';
import { log } from '@/lib/logger';
import type { LimitOrder, LimitOrderRow, LimitOrderStatus } from '../bots/types';

// ============================================================================
// Limit Order CRUD
// ============================================================================

/**
 * Create a new limit order
 */
export function createLimitOrder(order: Omit<LimitOrder, 'filledQuantity' | 'status' | 'updatedAt'>): LimitOrderRow {
  const db = getDatabase();

  const stmt = db.prepare(`
    INSERT INTO limit_orders (
      id, bot_id, asset_id, side, outcome, price, quantity,
      filled_quantity, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, '0', 'open', ?, ?)
  `);

  const now = new Date().toISOString();
  stmt.run(
    order.id,
    order.botId,
    order.assetId,
    order.side,
    order.outcome,
    order.price,
    order.quantity,
    order.createdAt.toISOString(),
    now
  );

  return getLimitOrderById(order.id)!;
}

/**
 * Get a limit order by ID
 */
export function getLimitOrderById(id: string): LimitOrderRow | null {
  const db = getDatabase();
  return db.prepare('SELECT * FROM limit_orders WHERE id = ?').get(id) as LimitOrderRow | null;
}

/**
 * Get open orders for a bot
 */
export function getOpenOrdersByBotId(botId: string): LimitOrderRow[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM limit_orders
    WHERE bot_id = ? AND status IN ('open', 'partially_filled')
    ORDER BY created_at ASC
  `).all(botId) as LimitOrderRow[];
}

/**
 * Get all orders for a bot (including filled/cancelled)
 */
export function getAllOrdersByBotId(botId: string, limit?: number): LimitOrderRow[] {
  const db = getDatabase();
  let query = `
    SELECT * FROM limit_orders
    WHERE bot_id = ?
    ORDER BY created_at DESC
  `;

  if (limit) {
    query += ` LIMIT ${limit}`;
  }

  return db.prepare(query).all(botId) as LimitOrderRow[];
}

/**
 * Get open orders by asset ID (for fill matching across all bots)
 */
export function getOpenOrdersByAssetId(assetId: string): LimitOrderRow[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM limit_orders
    WHERE asset_id = ? AND status IN ('open', 'partially_filled')
    ORDER BY created_at ASC
  `).all(assetId) as LimitOrderRow[];
}

/**
 * Get open orders at a specific price level
 */
export function getOpenOrdersAtPrice(
  assetId: string,
  price: string,
  side: 'BUY' | 'SELL'
): LimitOrderRow[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM limit_orders
    WHERE asset_id = ? AND price = ? AND side = ? AND status IN ('open', 'partially_filled')
    ORDER BY created_at ASC
  `).all(assetId, price, side) as LimitOrderRow[];
}

/**
 * Update order fill quantity and status
 */
export function updateOrderFill(
  orderId: string,
  filledQuantity: string,
  status: LimitOrderStatus
): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE limit_orders
    SET filled_quantity = ?, status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(filledQuantity, status, orderId);
}

/**
 * Cancel a specific order
 */
export function cancelOrder(orderId: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE limit_orders
    SET status = 'cancelled', updated_at = datetime('now')
    WHERE id = ? AND status IN ('open', 'partially_filled')
  `).run(orderId);
}

/**
 * Cancel all open orders for a bot
 */
export function cancelAllBotOrders(botId: string): number {
  const db = getDatabase();
  const result = db.prepare(`
    UPDATE limit_orders
    SET status = 'cancelled', updated_at = datetime('now')
    WHERE bot_id = ? AND status IN ('open', 'partially_filled')
  `).run(botId);

  return result.changes;
}

/**
 * Cancel stale orders for a bot based on age and/or price distance
 *
 * @param botId - The bot ID
 * @param currentMidPrice - Current market mid price
 * @param maxAgeSeconds - Cancel orders older than this (optional)
 * @param maxPriceDistance - Cancel orders more than this % from mid price (optional)
 * @returns Array of cancelled order IDs
 */
export function cancelStaleOrders(
  botId: string,
  currentMidPrice: number,
  maxAgeSeconds?: number,
  maxPriceDistance?: number
): string[] {
  const openOrders = getOpenOrdersByBotId(botId);
  const cancelledIds: string[] = [];
  const now = Date.now();

  for (const order of openOrders) {
    const orderPrice = parseFloat(order.price);
    const orderAgeMs = now - new Date(order.created_at).getTime();
    const orderAgeSeconds = orderAgeMs / 1000;

    // Check if order is too old
    const isTooOld = maxAgeSeconds !== undefined && orderAgeSeconds > maxAgeSeconds;

    // Check if order is too far from current price
    const priceDistance = Math.abs(orderPrice - currentMidPrice) / currentMidPrice;
    const isTooFar = maxPriceDistance !== undefined && priceDistance > maxPriceDistance;

    if (isTooOld || isTooFar) {
      cancelOrder(order.id);
      cancelledIds.push(order.id);

      const reason = isTooOld && isTooFar
        ? `age=${orderAgeSeconds.toFixed(0)}s, distance=${(priceDistance * 100).toFixed(1)}%`
        : isTooOld
          ? `age=${orderAgeSeconds.toFixed(0)}s`
          : `distance=${(priceDistance * 100).toFixed(1)}%`;

      log(
        'OrderManager',
        `Cancelled stale ${order.side} order ${order.id.slice(0, 8)}... @ ${order.price} (${reason})`
      );
    }
  }

  return cancelledIds;
}

/**
 * Cancel stale orders for a specific outcome (YES/NO) based on price distance
 * Used by arbitrage strategy to cancel phantom orders on each leg separately
 *
 * @param botId - The bot ID
 * @param outcome - The outcome to filter by ('YES' or 'NO')
 * @param currentMidPrice - Current market mid price for this outcome
 * @param maxAgeSeconds - Cancel orders older than this (optional)
 * @param maxPriceDistance - Cancel orders more than this % from mid price (optional)
 * @returns Array of cancelled order IDs
 */
export function cancelStaleOrdersForOutcome(
  botId: string,
  outcome: 'YES' | 'NO',
  currentMidPrice: number,
  maxAgeSeconds?: number,
  maxPriceDistance?: number
): string[] {
  const openOrders = getOpenOrdersByBotId(botId);
  const cancelledIds: string[] = [];
  const now = Date.now();

  for (const order of openOrders) {
    // Skip orders for other outcomes
    if (order.outcome !== outcome) continue;

    const orderPrice = parseFloat(order.price);
    const orderAgeMs = now - new Date(order.created_at).getTime();
    const orderAgeSeconds = orderAgeMs / 1000;

    // Check if order is too old
    const isTooOld = maxAgeSeconds !== undefined && orderAgeSeconds > maxAgeSeconds;

    // Check if order is too far from current price
    const priceDistance = Math.abs(orderPrice - currentMidPrice) / currentMidPrice;
    const isTooFar = maxPriceDistance !== undefined && priceDistance > maxPriceDistance;

    if (isTooOld || isTooFar) {
      cancelOrder(order.id);
      cancelledIds.push(order.id);

      const reason = isTooOld && isTooFar
        ? `age=${orderAgeSeconds.toFixed(0)}s, distance=${(priceDistance * 100).toFixed(1)}%`
        : isTooOld
          ? `age=${orderAgeSeconds.toFixed(0)}s`
          : `distance=${(priceDistance * 100).toFixed(1)}%`;

      log(
        'OrderManager',
        `Cancelled stale ${outcome} ${order.side} order ${order.id.slice(0, 8)}... @ ${order.price} (${reason})`
      );
    }
  }

  return cancelledIds;
}

/**
 * Get order count by status for a bot
 */
export function getOrderCountByStatus(botId: string): Record<LimitOrderStatus, number> {
  const db = getDatabase();
  const results = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM limit_orders
    WHERE bot_id = ?
    GROUP BY status
  `).all(botId) as Array<{ status: LimitOrderStatus; count: number }>;

  const counts: Record<LimitOrderStatus, number> = {
    open: 0,
    partially_filled: 0,
    filled: 0,
    cancelled: 0,
  };

  for (const row of results) {
    counts[row.status] = row.count;
  }

  return counts;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert LimitOrderRow to LimitOrder
 */
export function rowToLimitOrder(row: LimitOrderRow): LimitOrder {
  return {
    id: row.id,
    botId: row.bot_id,
    assetId: row.asset_id,
    side: row.side,
    outcome: row.outcome,
    price: row.price,
    quantity: row.quantity,
    filledQuantity: row.filled_quantity,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Convert LimitOrder to LimitOrderRow
 */
export function limitOrderToRow(order: LimitOrder): LimitOrderRow {
  return {
    id: order.id,
    bot_id: order.botId,
    asset_id: order.assetId,
    side: order.side,
    outcome: order.outcome,
    price: order.price,
    quantity: order.quantity,
    filled_quantity: order.filledQuantity,
    status: order.status,
    created_at: order.createdAt.toISOString(),
    updated_at: order.updatedAt.toISOString(),
  };
}
