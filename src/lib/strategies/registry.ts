/**
 * Strategy Registry
 *
 * Maps strategy slugs to their executor implementations.
 */

import type { IStrategyExecutor, StrategyContext, StrategySignal, Position } from '../bots/types';
import type { OrderBook } from '../polymarket/types';

// Registry of strategy executors
const executors: Map<string, IStrategyExecutor> = new Map();

/**
 * Register a strategy executor
 */
export function registerStrategy(slug: string, executor: IStrategyExecutor): void {
  executors.set(slug, executor);
  console.log(`[Registry] Registered strategy executor: ${slug}`);
}

/**
 * Get a strategy executor by slug
 */
export function getExecutor(slug: string): IStrategyExecutor | undefined {
  return executors.get(slug);
}

/**
 * Check if a strategy executor is registered
 */
export function hasExecutor(slug: string): boolean {
  return executors.has(slug);
}

/**
 * Get all registered strategy slugs
 */
export function getRegisteredStrategies(): string[] {
  return Array.from(executors.keys());
}

/**
 * Unregister a strategy executor
 */
export function unregisterStrategy(slug: string): boolean {
  return executors.delete(slug);
}

/**
 * Clean up any per-bot state stored by strategy executors.
 * Call this when a bot is deleted to prevent memory leaks.
 */
export function cleanupBotState(botId: string): void {
  const arbExecutor = executors.get('arbitrage') as ArbitrageExecutor | undefined;
  if (arbExecutor?.cleanupBot) {
    arbExecutor.cleanupBot(botId);
  }
}

// ============================================================================
// Built-in Strategy Executors
// ============================================================================

/**
 * Test Oscillator Strategy Executor
 * Alternates between buying and selling 1 share
 */
export class TestOscillatorExecutor implements IStrategyExecutor {
  async execute(context: StrategyContext): Promise<StrategySignal | null> {
    const { position, currentPrice, bot } = context;
    const config = (bot.config.strategyConfig || {}) as Record<string, unknown>;

    const quantity = String(config.quantity || '1');
    const outcome = (config.outcome as 'YES' | 'NO') || 'YES';
    const price = outcome === 'YES' ? currentPrice.yes : currentPrice.no;

    const currentSize = parseFloat(position.size);

    // If no position, buy
    if (currentSize === 0) {
      return {
        action: 'BUY',
        side: outcome,
        price,
        quantity,
        reason: 'Opening oscillator position',
        confidence: 1.0,
      };
    }

    // If holding, sell
    if (currentSize > 0) {
      return {
        action: 'SELL',
        side: outcome,
        price,
        quantity,
        reason: 'Closing oscillator position',
        confidence: 1.0,
      };
    }

    return null;
  }

  validate(config: Record<string, unknown>): boolean {
    const interval = config.interval as number;
    if (interval && (interval < 1000 || interval > 60000)) {
      return false;
    }

    const outcome = config.outcome as string;
    if (outcome && !['YES', 'NO'].includes(outcome)) {
      return false;
    }

    return true;
  }
}

/**
 * Market Maker Strategy Executor (placeholder)
 * Full implementation in market-maker.ts
 */
export class MarketMakerExecutor implements IStrategyExecutor {
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

    // PRIORITY 1: Balance the lagging leg first (if one leg has position)
    if (totalSize > 0) {
      if (laggingLeg === 'YES' && canBuyLeg('YES')) {
        const buyPrice = isLargeImbalance ? yesBestAsk : yesBestBid;
        // Entry decision based solely on whether new position would be profitable
        if (this.wouldCostBeValid(yesSize, yesAvg, noSize, noAvg, 'YES', orderSize, buyPrice)) {
          return generateSignal('YES', isLargeImbalance);
        } else {
          console.log(`[Arb] Skipping YES buy - would push combined avg >= $1`);
        }
      } else if (laggingLeg === 'NO' && canBuyLeg('NO')) {
        const buyPrice = isLargeImbalance ? noBestAsk : noBestBid;
        if (this.wouldCostBeValid(yesSize, yesAvg, noSize, noAvg, 'NO', orderSize, buyPrice)) {
          return generateSignal('NO', isLargeImbalance);
        } else {
          console.log(`[Arb] Skipping NO buy - would push combined avg >= $1`);
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
      if (this.wouldCostBeValid(yesSize, yesAvg, noSize, noAvg, firstLeg, orderSize, buyPrice)) {
        this.lastBoughtLeg.set(botId, firstLeg);
        return generateSignal(firstLeg, false);
      }
    }

    // Try second leg (same as last bought, as fallback)
    if (canBuyLeg(secondLeg)) {
      const buyPrice = secondLeg === 'YES' ? yesBestBid : noBestBid;
      if (this.wouldCostBeValid(yesSize, yesAvg, noSize, noAvg, secondLeg, orderSize, buyPrice)) {
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

// ============================================================================
// Register Built-in Strategies
// ============================================================================

// Register built-in executors
registerStrategy('test-oscillator', new TestOscillatorExecutor());
registerStrategy('market-maker', new MarketMakerExecutor());
registerStrategy('arbitrage', new ArbitrageExecutor());
