/**
 * UP + DOWN < $1 Arbitrage Strategy Executor
 *
 * Exploits pricing inefficiencies where UP + DOWN prices sum to less than $1.00.
 * Enters legs separately during price dislocations, holds until resolution.
 *
 * Algorithm:
 * 1. Always prioritize the LAGGING leg (smaller position) to balance
 * 2. Dynamic maxPosition: Leading leg capped at maxPosition, lagging can exceed to catch up
 * 3. Projected cost check (wouldCostBeValid): Ensure avg cost sum < $1 AFTER new order would fill
 * 4. Adaptive orders: Passive (below bid) normally, aggressive (at ask) when imbalance > 50%
 * 5. Order throttling: Cooldown period per leg to prevent burst trading
 * 6. Time-based scaling: maxPosition decreases as market approaches close
 * 7. Close-out mode: In last 10% of time, force hedging on lagging leg
 */

import type { IStrategyExecutor, StrategyContext, StrategySignal } from '../bots/types';
import type { OrderBook } from '../polymarket/types';

export class ArbitrageExecutor implements IStrategyExecutor {
  // Order throttling: track last order time per leg PER BOT to prevent burst trading
  // Using a Map keyed by botId so multiple bots don't share cooldown state
  private botCooldowns: Map<string, { lastYesOrderTime: number; lastNoOrderTime: number }> = new Map();
  private readonly NORMAL_COOLDOWN_MS = 3000; // 3 second cooldown per leg in normal mode
  private readonly CLOSEOUT_COOLDOWN_MS = 500; // 500ms cooldown in close-out mode (6x faster)

  // Round-robin leg selection: track last bought leg per bot to alternate YES/NO
  private lastBoughtLeg: Map<string, 'YES' | 'NO'> = new Map();

  /**
   * Clean up state for a deleted bot to prevent memory leaks
   */
  cleanupBot(botId: string): void {
    this.botCooldowns.delete(botId);
    this.lastBoughtLeg.delete(botId);
  }

  // Get or initialize cooldown state for a specific bot
  private getCooldowns(botId: string): { lastYesOrderTime: number; lastNoOrderTime: number } {
    if (!this.botCooldowns.has(botId)) {
      this.botCooldowns.set(botId, { lastYesOrderTime: 0, lastNoOrderTime: 0 });
    }
    return this.botCooldowns.get(botId)!;
  }
  // Round price to tick size
  private roundToTick(price: number, tickSize: number): string {
    const rounded = Math.round(price / tickSize) * tickSize;
    const decimals = tickSize >= 1 ? 0 : Math.max(0, Math.ceil(-Math.log10(tickSize)));
    return rounded.toFixed(decimals);
  }

  // Get best ask from order book
  private getBestAsk(orderBook: OrderBook | undefined): number | null {
    if (!orderBook?.asks?.length) return null;
    const sorted = [...orderBook.asks].sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
    return parseFloat(sorted[0].price);
  }

  // Get best bid from order book
  private getBestBid(orderBook: OrderBook | undefined): number | null {
    if (!orderBook?.bids?.length) return null;
    const sorted = [...orderBook.bids].sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
    return parseFloat(sorted[0].price);
  }

  // Calculate projected average cost after adding new position
  private getProjectedAvg(currentSize: number, currentAvg: number, addSize: number, addPrice: number): number {
    if (currentSize + addSize === 0) return 0;
    return (currentSize * currentAvg + addSize * addPrice) / (currentSize + addSize);
  }

  // Check if adding a position would keep combined avg cost under threshold
  // Using $0.98 to ensure 2% minimum profit margin on matched pairs
  private readonly PROFIT_THRESHOLD = 0.98;

  // Per-leg price ceiling to prevent buying at terrible prices
  // When no other leg exists, never pay more than this for a single leg
  private readonly MAX_SINGLE_LEG_PRICE = 0.75;

  /**
   * Check if a leg's entry price is acceptable based on profit constraints.
   * - If other leg has position: dynamic ceiling = PROFIT_THRESHOLD - otherLegAvg - 0.01
   * - If no other leg: absolute ceiling = MAX_SINGLE_LEG_PRICE
   */
  private isLegPriceAcceptable(
    side: 'YES' | 'NO',
    price: number,
    otherLegAvg: number
  ): boolean {
    // If we have other leg position, use dynamic ceiling
    if (otherLegAvg > 0) {
      const maxPrice = this.PROFIT_THRESHOLD - otherLegAvg - 0.01; // 1c buffer
      if (price > maxPrice) {
        console.log(
          `[Arb] BLOCKED: ${side} @ ${price.toFixed(3)} exceeds dynamic ceiling ` +
          `${maxPrice.toFixed(3)} (other leg avg=${otherLegAvg.toFixed(3)})`
        );
        return false;
      }
      return true;
    }

    // No other leg yet - use absolute ceiling
    if (price > this.MAX_SINGLE_LEG_PRICE) {
      console.log(
        `[Arb] BLOCKED: ${side} @ ${price.toFixed(3)} exceeds absolute ceiling ` +
        `${this.MAX_SINGLE_LEG_PRICE} (no other leg position yet)`
      );
      return false;
    }
    return true;
  }

  private wouldCostBeValid(
    yesSize: number, yesAvg: number,
    noSize: number, noAvg: number,
    side: 'YES' | 'NO',
    addSize: number, addPrice: number
  ): boolean {
    let projectedYesAvg = yesAvg;
    let projectedNoAvg = noAvg;

    if (side === 'YES') {
      projectedYesAvg = this.getProjectedAvg(yesSize, yesAvg, addSize, addPrice);
    } else {
      projectedNoAvg = this.getProjectedAvg(noSize, noAvg, addSize, addPrice);
    }

    // Combined avg cost must be under threshold for guaranteed profit margin
    const combinedAvg = projectedYesAvg + projectedNoAvg;

    if (combinedAvg >= this.PROFIT_THRESHOLD) {
      console.log(`[Arb] BLOCKED: Projected combined $${combinedAvg.toFixed(3)} >= $${this.PROFIT_THRESHOLD}`);
      return false;
    }
    return true;
  }

  async execute(context: StrategyContext): Promise<StrategySignal | null> {
    const {
      bot,
      orderBook,
      noOrderBook,
      positions,
      tickSize,
      yesPrices,
      noPrices,
    } = context;
    const config = (bot.config.strategyConfig || {}) as Record<string, unknown>;

    // Configuration
    const orderSize = parseFloat(String(config.orderSize || '10'));
    const maxPositionPerLeg = parseFloat(String(config.maxPosition || '100'));
    const imbalanceThreshold = 0.5; // 50% imbalance triggers aggressive mode

    // Time-based maxPosition scaling
    // As market approaches close, reduce maxPosition to ensure hedging
    let scaledMaxPosition = maxPositionPerLeg;
    let timeProgress = 0;

    if (context.botStartTime && context.marketEndTime) {
      const now = Date.now();
      const startTime = context.botStartTime.getTime();
      const endTime = context.marketEndTime.getTime();
      const totalDuration = endTime - startTime;

      if (totalDuration > 0 && now >= startTime) {
        const elapsed = now - startTime;
        timeProgress = Math.min(1, Math.max(0, elapsed / totalDuration));
        const timeRemaining = 1 - timeProgress;

        // Scale maxPosition linearly with time remaining
        // At start: 100% of maxPosition, at end: 0% (must be hedged)
        scaledMaxPosition = Math.floor(maxPositionPerLeg * timeRemaining);

        console.log(
          `[Arb] Time: ${(timeProgress * 100).toFixed(1)}% elapsed, ` +
          `maxPosition: ${maxPositionPerLeg} → ${scaledMaxPosition}`
        );
      }
    }

    // Close-out mode: force hedging in last 10% of market time
    const CLOSE_OUT_THRESHOLD = 0.90;  // Activate at 90% time elapsed
    const isCloseOutMode = timeProgress >= CLOSE_OUT_THRESHOLD;

    if (isCloseOutMode) {
      console.log(
        `[Arb] CLOSE-OUT MODE: ${((1 - timeProgress) * 100).toFixed(1)}% time remaining, ` +
        `forcing hedge on lagging leg`
      );
    }

    // Get tick size
    const tick = tickSize ? parseFloat(tickSize.tick_size) : 0.01;

    // Get YES/UP best bid/ask from order book or context
    const yesBestBid = yesPrices?.bestBid ?? this.getBestBid(orderBook) ?? 0;
    const yesBestAsk = yesPrices?.bestAsk ?? this.getBestAsk(orderBook) ?? 1;

    // Get NO/DOWN best bid/ask from order book or context
    const noBestBid = noPrices?.bestBid ?? this.getBestBid(noOrderBook) ?? 0;
    const noBestAsk = noPrices?.bestAsk ?? this.getBestAsk(noOrderBook) ?? 1;

    // Validate order book data
    if (yesBestBid === 0 || noBestBid === 0) {
      console.log(`[Arb] Missing order book data, skipping cycle`);
      return null;
    }

    // Extract YES and NO positions
    const yesPosition = positions?.find(p => p.outcome === 'YES');
    const noPosition = positions?.find(p => p.outcome === 'NO');
    const yesSizeForCeiling = yesPosition ? parseFloat(yesPosition.size) : 0;
    const noSizeForCeiling = noPosition ? parseFloat(noPosition.size) : 0;

    // Check if we're in initial building mode (neither leg has reached scaledMaxPosition)
    const maxPositionReached = yesSizeForCeiling >= scaledMaxPosition || noSizeForCeiling >= scaledMaxPosition;
    const inInitialBuildingMode = !maxPositionReached;

    if (inInitialBuildingMode) {
      console.log(`[Arb] Initial building mode (neither leg >= ${scaledMaxPosition})`);
    }

    // Get pending order quantities per asset (to include in position limit check)
    const yesPendingBuy = context.yesPendingBuy ?? 0;
    const noPendingBuy = context.noPendingBuy ?? 0;
    const yesPendingAvgPrice = context.yesPendingAvgPrice ?? 0;
    const noPendingAvgPrice = context.noPendingAvgPrice ?? 0;

    // Get current position sizes INCLUDING pending orders (for limit enforcement)
    // This prevents placing orders that would exceed limits when they fill
    const yesFilledSize = yesPosition ? parseFloat(yesPosition.size) : 0;
    const noFilledSize = noPosition ? parseFloat(noPosition.size) : 0;
    const yesSize = yesFilledSize + yesPendingBuy;
    const noSize = noFilledSize + noPendingBuy;
    const yesFilledAvg = yesPosition ? parseFloat(yesPosition.avgEntryPrice) : 0;
    const noFilledAvg = noPosition ? parseFloat(noPosition.avgEntryPrice) : 0;

    // Calculate effective avg including pending orders (for wouldCostBeValid check)
    // This prevents the race condition where one leg accumulates before the other fills
    const yesEffectiveAvg = yesFilledSize > 0
      ? (yesPendingBuy > 0
        ? (yesFilledSize * yesFilledAvg + yesPendingBuy * yesPendingAvgPrice) / (yesFilledSize + yesPendingBuy)
        : yesFilledAvg)
      : yesPendingAvgPrice;

    const noEffectiveAvg = noFilledSize > 0
      ? (noPendingBuy > 0
        ? (noFilledSize * noFilledAvg + noPendingBuy * noPendingAvgPrice) / (noFilledSize + noPendingBuy)
        : noFilledAvg)
      : noPendingAvgPrice;

    // Use effective averages for all profitability checks
    const yesAvg = yesEffectiveAvg;
    const noAvg = noEffectiveAvg;

    // Calculate combined metrics
    const combinedAskCost = yesBestAsk + noBestAsk;
    const combinedAvgCost = yesAvg + noAvg;
    const potentialProfit = 1.0 - combinedAskCost;

    console.log(
      `[Arb] YES: bid=${yesBestBid.toFixed(3)} ask=${yesBestAsk.toFixed(3)} | ` +
      `NO: bid=${noBestBid.toFixed(3)} ask=${noBestAsk.toFixed(3)} | ` +
      `Combined ask=${combinedAskCost.toFixed(3)} | Profit=${(potentialProfit * 100).toFixed(2)}%`
    );
    console.log(
      `[Arb] Position: YES=${yesFilledSize.toFixed(0)}+${yesPendingBuy.toFixed(0)}pending NO=${noFilledSize.toFixed(0)}+${noPendingBuy.toFixed(0)}pending | ` +
      `Effective: YES=${yesSize.toFixed(0)} NO=${noSize.toFixed(0)}`
    );

    // Calculate position imbalance
    const totalSize = yesSize + noSize;
    const imbalance = totalSize > 0 ? Math.abs(yesSize - noSize) / Math.max(yesSize, noSize, 1) : 0;
    const isLargeImbalance = imbalance > imbalanceThreshold && totalSize > 0;

    // Determine lagging leg (smaller position)
    const yesIsLagging = yesSize <= noSize;
    const laggingLeg: 'YES' | 'NO' = yesIsLagging ? 'YES' : 'NO';
    const leadingLeg: 'YES' | 'NO' = yesIsLagging ? 'NO' : 'YES';

    // maxPosition limits the DIFFERENCE between legs, not absolute size
    // This ensures one side doesn't grow too much without the other hedging
    const sizeDiff = Math.abs(yesSize - noSize);
    const filledDiff = Math.abs(yesFilledSize - noFilledSize);

    // Calculate projected differences if we buy each leg
    // Check BOTH total difference (with pending) AND filled difference
    // This prevents the filled position from exceeding limits even when pending orders exist
    const newDiffIfBuyYes = Math.abs((yesSize + orderSize) - noSize);
    const newDiffIfBuyNo = Math.abs(yesSize - (noSize + orderSize));
    const newFilledDiffIfBuyYes = Math.abs((yesFilledSize + orderSize) - noFilledSize);
    const newFilledDiffIfBuyNo = Math.abs(yesFilledSize - (noFilledSize + orderSize));

    // Lagging leg can ALWAYS buy (reduces imbalance toward hedge)
    // Leading leg blocked if it would increase diff beyond scaledMaxPosition
    const yesCanBuy = yesIsLagging
      ? true  // Always allow lagging leg to catch up
      : (newDiffIfBuyYes <= scaledMaxPosition && newFilledDiffIfBuyYes <= scaledMaxPosition);

    const noCanBuy = !yesIsLagging
      ? true  // Always allow lagging leg to catch up (NO is lagging)
      : (newDiffIfBuyNo <= scaledMaxPosition && newFilledDiffIfBuyNo <= scaledMaxPosition);

    // Use these for entry decisions
    const yesNeedsMore = yesCanBuy;
    const noNeedsMore = noCanBuy;

    console.log(
      `[Arb] Lagging=${laggingLeg} Imbalance=${(imbalance * 100).toFixed(1)}% ${isLargeImbalance ? '(AGGRESSIVE)' : '(passive)'} | ` +
      `FilledDiff=${filledDiff.toFixed(0)} TotalDiff=${sizeDiff.toFixed(0)} / max=${scaledMaxPosition} | CanBuy: YES=${yesCanBuy} NO=${noCanBuy}`
    );

    // SAFETY CHECK 4: Order throttling - check cooldown per leg (per-bot)
    // Use faster cooldown in close-out mode for urgent hedging
    const now = Date.now();
    const botId = bot.config.id;
    const cooldowns = this.getCooldowns(botId);
    const effectiveCooldown = isCloseOutMode ? this.CLOSEOUT_COOLDOWN_MS : this.NORMAL_COOLDOWN_MS;
    const yesOnCooldown = now - cooldowns.lastYesOrderTime < effectiveCooldown;
    const noOnCooldown = now - cooldowns.lastNoOrderTime < effectiveCooldown;
    if (yesOnCooldown && noOnCooldown && !isCloseOutMode) {
      console.log(`[Arb] Both legs on cooldown, skipping cycle`);
      return null;
    }

    // Helper: Check if a leg can be bought (cooldown + position limit)
    const canBuyLeg = (leg: 'YES' | 'NO'): boolean => {
      const onCooldown = leg === 'YES' ? yesOnCooldown : noOnCooldown;
      const canBuy = leg === 'YES' ? yesNeedsMore : noNeedsMore;
      const isLagging = leg === laggingLeg;

      // In close-out mode, bypass cooldown for lagging leg (urgent hedging)
      if (onCooldown && !(isCloseOutMode && isLagging)) {
        console.log(`[Arb] ${leg} on cooldown, skipping`);
        return false;
      }

      // Position limit already allows lagging leg (see yesCanBuy/noCanBuy)
      if (!canBuy) {
        return false;
      }
      return true;
    };

    // Helper: Generate signal and update cooldown timestamp (per-bot)
    const generateSignal = (leg: 'YES' | 'NO', aggressive: boolean): StrategySignal => {
      // In close-out mode, always use aggressive pricing for fills
      const useAggressivePricing = aggressive || isCloseOutMode;

      if (leg === 'YES') {
        cooldowns.lastYesOrderTime = now;
        return this.createBuySignal('YES', yesBestBid, yesBestAsk, orderSize, tick, potentialProfit, useAggressivePricing);
      } else {
        cooldowns.lastNoOrderTime = now;
        return this.createBuySignal('NO', noBestBid, noBestAsk, orderSize, tick, potentialProfit, useAggressivePricing);
      }
    };

    // PRIORITY 0: Close-out mode - force hedge the lagging leg with larger orders
    if (isCloseOutMode && sizeDiff > 0) {
      if (canBuyLeg(laggingLeg)) {
        // Use 3x order size in close-out mode for faster hedging (capped at remaining imbalance)
        const closeOutSize = Math.min(sizeDiff, orderSize * 3);
        const closeOutPrice = laggingLeg === 'YES' ? yesBestAsk : noBestAsk;
        const closeOutOtherAvg = laggingLeg === 'YES' ? noAvg : yesAvg;

        // Check price ceiling even in close-out mode - don't buy at terrible prices
        if (!this.isLegPriceAcceptable(laggingLeg, closeOutPrice, closeOutOtherAvg)) {
          console.log(`[Arb] CLOSE-OUT: Skipping ${laggingLeg} - price ${closeOutPrice.toFixed(3)} too high`);
        } else {
          console.log(`[Arb] CLOSE-OUT: Buying ${closeOutSize.toFixed(0)} ${laggingLeg} to hedge (imbalance=${sizeDiff.toFixed(0)})`);

          // Generate signal with closeOutSize
          if (laggingLeg === 'YES') {
            cooldowns.lastYesOrderTime = now;
            return this.createBuySignal('YES', yesBestBid, yesBestAsk, closeOutSize, tick, potentialProfit, true);
          } else {
            cooldowns.lastNoOrderTime = now;
            return this.createBuySignal('NO', noBestBid, noBestAsk, closeOutSize, tick, potentialProfit, true);
          }
        }
      }
    }

    // PRIORITY 1: Balance the lagging leg first (if one leg has position)
    if (totalSize > 0) {
      if (laggingLeg === 'YES' && canBuyLeg('YES')) {
        const buyPrice = isLargeImbalance ? yesBestAsk : yesBestBid;
        // Check per-leg price ceiling first
        if (!this.isLegPriceAcceptable('YES', buyPrice, noAvg)) {
          // Price too high, skip this leg
        } else if (this.wouldCostBeValid(yesSize, yesAvg, noSize, noAvg, 'YES', orderSize, buyPrice)) {
          return generateSignal('YES', isLargeImbalance);
        } else {
          console.log(`[Arb] Skipping YES buy - would push combined avg >= $${this.PROFIT_THRESHOLD}`);
        }
      } else if (laggingLeg === 'NO' && canBuyLeg('NO')) {
        const buyPrice = isLargeImbalance ? noBestAsk : noBestBid;
        // Check per-leg price ceiling first
        if (!this.isLegPriceAcceptable('NO', buyPrice, yesAvg)) {
          // Price too high, skip this leg
        } else if (this.wouldCostBeValid(yesSize, yesAvg, noSize, noAvg, 'NO', orderSize, buyPrice)) {
          return generateSignal('NO', isLargeImbalance);
        } else {
          console.log(`[Arb] Skipping NO buy - would push combined avg >= $${this.PROFIT_THRESHOLD}`);
        }
      }
    }

    // PRIORITY 2: Enter either leg (initial entry or balanced accumulation)
    // Use round-robin to alternate between YES and NO, preventing one-sided accumulation
    const lastLeg = this.lastBoughtLeg.get(botId) ?? 'NO';
    const firstLeg: 'YES' | 'NO' = lastLeg === 'YES' ? 'NO' : 'YES';
    const secondLeg: 'YES' | 'NO' = firstLeg === 'YES' ? 'NO' : 'YES';

    // Try first leg (opposite of last bought)
    if (canBuyLeg(firstLeg)) {
      const buyPrice = firstLeg === 'YES' ? yesBestBid : noBestBid;
      const otherAvg = firstLeg === 'YES' ? noAvg : yesAvg;
      // Check per-leg price ceiling first
      if (this.isLegPriceAcceptable(firstLeg, buyPrice, otherAvg) &&
          this.wouldCostBeValid(yesSize, yesAvg, noSize, noAvg, firstLeg, orderSize, buyPrice)) {
        this.lastBoughtLeg.set(botId, firstLeg);
        return generateSignal(firstLeg, false);
      }
    }

    // Try second leg (same as last bought, as fallback)
    if (canBuyLeg(secondLeg)) {
      const buyPrice = secondLeg === 'YES' ? yesBestBid : noBestBid;
      const otherAvg = secondLeg === 'YES' ? noAvg : yesAvg;
      // Check per-leg price ceiling first
      if (this.isLegPriceAcceptable(secondLeg, buyPrice, otherAvg) &&
          this.wouldCostBeValid(yesSize, yesAvg, noSize, noAvg, secondLeg, orderSize, buyPrice)) {
        this.lastBoughtLeg.set(botId, secondLeg);
        return generateSignal(secondLeg, false);
      }
    }

    return null;
  }

  private createBuySignal(
    side: 'YES' | 'NO',
    bestBid: number,
    bestAsk: number,
    orderSize: number,
    tick: number,
    profit: number,
    aggressive: boolean
  ): StrategySignal {
    let price: string;
    let reason: string;

    if (aggressive) {
      // Aggressive: place at best ask to fill immediately
      price = this.roundToTick(bestAsk, tick);
      reason = `Arb[AGG]: BUY ${side} @ ${price} (ask=${bestAsk.toFixed(3)}, profit=${(profit * 100).toFixed(2)}%)`;
    } else {
      // Passive: place below best bid to provide liquidity
      const bidPrice = this.roundToTick(bestBid * (1 - 0.005), tick); // 0.5% below bid

      // Safety: ensure we're not crossing the spread
      if (parseFloat(bidPrice) >= bestAsk) {
        price = this.roundToTick(bestBid - tick, tick);
      } else {
        price = bidPrice;
      }
      reason = `Arb: BUY ${side} @ ${price} (bid=${bestBid.toFixed(3)}, profit=${(profit * 100).toFixed(2)}%)`;
    }

    return {
      action: 'BUY',
      side,
      price,
      quantity: String(orderSize),
      reason,
      confidence: aggressive ? 0.9 : 0.95,
    };
  }
}
