/**
 * Market Maker Strategy Executor
 *
 * Places bid/ask orders around the mid-price to provide liquidity.
 * Earns the spread when both sides fill.
 */

import type { IStrategyExecutor, StrategyContext, StrategySignal, ExecutorMetadata } from '../bots/types';

export class MarketMakerExecutor implements IStrategyExecutor {
  /** Executor metadata - declares single-asset requirements */
  readonly metadata: ExecutorMetadata = {
    requiredAssets: [
      { configKey: 'assetId', label: 'YES', subscriptions: ['orderBook', 'price', 'trades', 'tickSize'] },
    ],
    positionHandler: 'single',
    staleOrderRules: {
      maxOrderAge: 60,
      maxPriceDistance: 0.05,
    },
  };

  // Round price to tick size
  private roundToTick(price: number, tickSize: number): string {
    const rounded = Math.round(price / tickSize) * tickSize;
    // Calculate decimal places from tick size
    const decimals = tickSize >= 1 ? 0 : Math.max(0, Math.ceil(-Math.log10(tickSize)));
    return rounded.toFixed(decimals);
  }

  async execute(context: StrategyContext): Promise<StrategySignal | null> {
    const { position, currentPrice, bot, tickSize, pendingBuyQuantity = 0, orderBook } = context;
    const config = (bot.config.strategyConfig || {}) as Record<string, unknown>;

    const spread = (config.spread as number) || 0.02;
    const orderSize = String(config.orderSize || '10');
    const maxPositionUsd = parseFloat(String(config.maxPosition || '100')); // Max position in USDC
    const outcome = (config.outcome as 'YES' | 'NO') || 'YES';

    // Get tick size (default to 0.01 if not available)
    const tick = tickSize ? parseFloat(tickSize.tick_size) : 0.01;

    // Extract best bid/ask from order book (required for non-marketable order placement)
    const bids = orderBook?.bids || [];
    const asks = orderBook?.asks || [];

    if (bids.length === 0 || asks.length === 0) {
      // No order book data, skip this cycle
      return null;
    }

    const bestBid = parseFloat(bids[0].price);
    const bestAsk = parseFloat(asks[0].price);

    // Use mid-price only for position value calculation
    const midPrice = (bestBid + bestAsk) / 2;
    const positionSize = parseFloat(position.size);

    // Calculate position value in USDC
    const positionValueUsd = positionSize * midPrice;
    const pendingBuyValueUsd = pendingBuyQuantity * midPrice;
    const effectiveValueUsd = positionValueUsd + pendingBuyValueUsd;

    // Only place BUY if effective position value (in USDC) is below maxPosition
    if (effectiveValueUsd < maxPositionUsd) {
      // Place bid BELOW best bid (providing liquidity, not taking it)
      const bidPrice = this.roundToTick(bestBid * (1 - spread / 2), tick);

      // Safety check: ensure order is not marketable
      if (parseFloat(bidPrice) >= bestAsk) {
        console.warn(`[MM] Skipping BUY - price ${bidPrice} would be marketable (ask=${bestAsk})`);
        return null;
      }

      return {
        action: 'BUY',
        side: outcome,
        price: bidPrice,
        quantity: orderSize,
        reason: `Market making - bid @ ${bidPrice} (bestBid=${bestBid}, value: $${positionValueUsd.toFixed(2)}, max: $${maxPositionUsd})`,
        confidence: 0.8,
      };
    }

    // Place SELL if we have position to sell
    if (positionSize > 0) {
      // Place ask ABOVE best ask (providing liquidity, not taking it)
      const askPrice = this.roundToTick(bestAsk * (1 + spread / 2), tick);

      // Safety check: ensure order is not marketable
      if (parseFloat(askPrice) <= bestBid) {
        console.warn(`[MM] Skipping SELL - price ${askPrice} would be marketable (bid=${bestBid})`);
        return null;
      }

      return {
        action: 'SELL',
        side: outcome,
        price: askPrice,
        quantity: orderSize,
        reason: `Market making - ask @ ${askPrice} (bestAsk=${bestAsk})`,
        confidence: 0.8,
      };
    }

    return null;
  }
}
