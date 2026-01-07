/**
 * Signal Factory
 *
 * Creates properly formatted trading signals for the arbitrage strategy.
 */

import type { StrategySignal } from '../../bots/types';

/**
 * Round price to tick size with proper decimal places
 */
export function roundToTick(price: number, tickSize: number): string {
  const rounded = Math.round(price / tickSize) * tickSize;
  const decimals = tickSize >= 1 ? 0 : Math.max(0, Math.ceil(-Math.log10(tickSize)));
  return rounded.toFixed(decimals);
}

/**
 * Create a BUY signal for a specific leg
 *
 * @param leg - 'YES' or 'NO'
 * @param bestBid - Best bid price
 * @param bestAsk - Best ask price
 * @param orderSize - Quantity to buy
 * @param tickSize - Market tick size
 * @param potentialProfit - Potential profit (1 - combinedAskCost)
 * @param aggressive - If true, place at ask; if false, place below bid
 */
export function createBuySignal(
  leg: 'YES' | 'NO',
  bestBid: number,
  bestAsk: number,
  orderSize: number,
  tickSize: number,
  potentialProfit: number,
  aggressive: boolean
): StrategySignal {
  let price: string;
  let reason: string;

  if (aggressive) {
    // Aggressive: place at best ask to fill immediately
    price = roundToTick(bestAsk, tickSize);
    reason = `Arb[AGG]: BUY ${leg} @ ${price} (ask=${bestAsk.toFixed(3)}, profit=${(potentialProfit * 100).toFixed(2)}%)`;
  } else {
    // Passive: place below best bid to provide liquidity
    const bidPrice = roundToTick(bestBid * (1 - 0.005), tickSize); // 0.5% below bid

    // Safety: ensure we're not crossing the spread
    if (parseFloat(bidPrice) >= bestAsk) {
      price = roundToTick(bestBid - tickSize, tickSize);
    } else {
      price = bidPrice;
    }
    reason = `Arb: BUY ${leg} @ ${price} (bid=${bestBid.toFixed(3)}, profit=${(potentialProfit * 100).toFixed(2)}%)`;
  }

  return {
    action: 'BUY',
    side: leg,
    price,
    quantity: String(orderSize),
    reason,
    confidence: aggressive ? 0.9 : 0.95,
  };
}

/**
 * Create a SELL signal for a specific leg (used in close-out mode to unwind positions)
 *
 * @param leg - 'YES' or 'NO'
 * @param bestBid - Best bid price (sell at this price)
 * @param orderSize - Quantity to sell
 * @param tickSize - Market tick size
 * @param entryAvg - Average entry price (for profit calculation)
 */
export function createSellSignal(
  leg: 'YES' | 'NO',
  bestBid: number,
  orderSize: number,
  tickSize: number,
  entryAvg: number
): StrategySignal {
  const price = roundToTick(bestBid, tickSize);
  const profit = (bestBid - entryAvg) * orderSize;
  const reason = `Arb[UNWIND]: SELL ${leg} @ ${price} (bid=${bestBid.toFixed(3)}, entry=${entryAvg.toFixed(3)}, profit=$${profit.toFixed(2)})`;

  return {
    action: 'SELL',
    side: leg,
    price,
    quantity: String(orderSize),
    reason,
    confidence: 0.95,
  };
}
