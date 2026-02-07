/**
 * Portfolio Manager
 *
 * Tracks positions across multiple strikes for IV smile arbitrage.
 * Enforces notional risk limits per strike and per expiry.
 */

// ============================================================================
// Types
// ============================================================================

/** Position at a specific strike */
export interface StrikePosition {
  strike: number;
  yesQuantity: number;
  noQuantity: number;
  avgYesPrice: number;
  avgNoPrice: number;
  /** Total cost basis (notional) at this strike */
  notional: number;
}

/** Pending order awaiting fill */
export interface PendingOrder {
  orderId: string;
  strike: number;
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO';
  quantity: number;
  price: number;
}

/** Risk metrics for the portfolio */
export interface RiskMetrics {
  /** Total notional across all strikes */
  totalNotional: number;
  /** Notional per strike (filled only) */
  perStrikeNotionals: Map<number, number>;
  /** Total pending notional (unfilled orders) */
  pendingNotional: number;
}

// ============================================================================
// Portfolio Manager
// ============================================================================

export class PortfolioManager {
  private positions: Map<number, StrikePosition> = new Map();
  private pendingOrders: Map<string, PendingOrder> = new Map();

  constructor(
    private readonly maxNotionalPerStrike: number = 200,
    private readonly maxNotionalPerExpiry: number = 1000
  ) {}

  /**
   * Update position after a fill
   * Recalculates weighted average entry price
   */
  updatePosition(
    strike: number,
    outcome: 'YES' | 'NO',
    side: 'BUY' | 'SELL',
    quantity: number,
    price: number
  ): StrikePosition {
    const existing = this.positions.get(strike) ?? this.createEmptyPosition(strike);

    const isYes = outcome === 'YES';
    const isBuy = side === 'BUY';

    let newPosition: StrikePosition;

    if (isBuy) {
      // Buying adds to position
      const currentQty = isYes ? existing.yesQuantity : existing.noQuantity;
      const currentAvg = isYes ? existing.avgYesPrice : existing.avgNoPrice;
      const newQty = currentQty + quantity;
      const newAvg = currentQty > 0
        ? (currentQty * currentAvg + quantity * price) / newQty
        : price;

      newPosition = isYes
        ? {
            ...existing,
            yesQuantity: newQty,
            avgYesPrice: newAvg,
            notional: this.calculateNotional(newQty, newAvg, existing.noQuantity, existing.avgNoPrice),
          }
        : {
            ...existing,
            noQuantity: newQty,
            avgNoPrice: newAvg,
            notional: this.calculateNotional(existing.yesQuantity, existing.avgYesPrice, newQty, newAvg),
          };
    } else {
      // Selling reduces position
      const currentQty = isYes ? existing.yesQuantity : existing.noQuantity;
      const newQty = Math.max(0, currentQty - quantity);

      newPosition = isYes
        ? {
            ...existing,
            yesQuantity: newQty,
            notional: this.calculateNotional(newQty, existing.avgYesPrice, existing.noQuantity, existing.avgNoPrice),
          }
        : {
            ...existing,
            noQuantity: newQty,
            notional: this.calculateNotional(existing.yesQuantity, existing.avgYesPrice, newQty, existing.avgNoPrice),
          };
    }

    this.positions.set(strike, newPosition);
    return newPosition;
  }

  /**
   * Add a pending order for tracking
   */
  addPendingOrder(order: PendingOrder): void {
    this.pendingOrders.set(order.orderId, { ...order });
  }

  /**
   * Remove a pending order when filled or cancelled
   */
  removePendingOrder(orderId: string): boolean {
    return this.pendingOrders.delete(orderId);
  }

  /**
   * Get position for a specific strike
   */
  getPosition(strike: number): StrikePosition | undefined {
    return this.positions.get(strike);
  }

  /**
   * Get all positions
   */
  getAllPositions(): StrikePosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Calculate risk metrics for the portfolio
   */
  getRiskMetrics(): RiskMetrics {
    const perStrikeNotionals = new Map<number, number>();
    let totalNotional = 0;

    for (const position of this.positions.values()) {
      perStrikeNotionals.set(position.strike, position.notional);
      totalNotional += position.notional;
    }

    let pendingNotional = 0;
    for (const order of this.pendingOrders.values()) {
      if (order.side === 'BUY') {
        pendingNotional += order.quantity * order.price;
      }
    }

    return {
      totalNotional,
      perStrikeNotionals,
      pendingNotional,
    };
  }

  /**
   * Check if a trade is allowed within risk limits
   * Returns true if the trade can proceed
   */
  canTrade(strike: number, quantity: number, price: number): boolean {
    const tradeNotional = quantity * price;

    // Get current filled notional at this strike
    const currentPosition = this.positions.get(strike);
    const filledNotionalAtStrike = currentPosition?.notional ?? 0;

    // Get pending notional at this strike
    const pendingAtStrike = this.getPendingNotionalAtStrike(strike);

    // Check per-strike limit (filled + pending + new trade)
    const totalAtStrike = filledNotionalAtStrike + pendingAtStrike + tradeNotional;
    if (totalAtStrike > this.maxNotionalPerStrike) {
      return false;
    }

    // Get total notional across all strikes
    const metrics = this.getRiskMetrics();
    const totalExpiry = metrics.totalNotional + metrics.pendingNotional + tradeNotional;

    // Check per-expiry limit
    if (totalExpiry > this.maxNotionalPerExpiry) {
      return false;
    }

    return true;
  }

  /**
   * Reset all positions and pending orders
   */
  reset(): void {
    this.positions.clear();
    this.pendingOrders.clear();
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private createEmptyPosition(strike: number): StrikePosition {
    return {
      strike,
      yesQuantity: 0,
      noQuantity: 0,
      avgYesPrice: 0,
      avgNoPrice: 0,
      notional: 0,
    };
  }

  private calculateNotional(
    yesQty: number,
    yesPrice: number,
    noQty: number,
    noPrice: number
  ): number {
    return yesQty * yesPrice + noQty * noPrice;
  }

  private getPendingNotionalAtStrike(strike: number): number {
    let total = 0;
    for (const order of this.pendingOrders.values()) {
      if (order.strike === strike && order.side === 'BUY') {
        total += order.quantity * order.price;
      }
    }
    return total;
  }
}
