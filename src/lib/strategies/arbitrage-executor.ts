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

import type { IStrategyExecutor, StrategyContext, StrategySignal, ExecutorMetadata } from '../bots/types';
import type { OrderBook } from '../polymarket/types';
import {
  parseConfig,
  ArbitrageState,
  analyzePositions,
  PriceValidator,
  DecisionEngine,
  createBuySignal,
  type MarketData,
} from './arbitrage/index';

/**
 * Extract market data from context
 */
function extractMarketData(
  orderBook: OrderBook | undefined,
  noOrderBook: OrderBook | undefined,
  yesPrices: { bestBid: number; bestAsk: number } | undefined,
  noPrices: { bestBid: number; bestAsk: number } | undefined
): MarketData {
  // Helper functions
  const getBestBid = (ob: OrderBook | undefined): number | null => {
    if (!ob?.bids?.length) return null;
    const sorted = [...ob.bids].sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
    return parseFloat(sorted[0].price);
  };

  const getBestAsk = (ob: OrderBook | undefined): number | null => {
    if (!ob?.asks?.length) return null;
    const sorted = [...ob.asks].sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
    return parseFloat(sorted[0].price);
  };

  const yesBestBid = yesPrices?.bestBid ?? getBestBid(orderBook) ?? 0;
  const yesBestAsk = yesPrices?.bestAsk ?? getBestAsk(orderBook) ?? 1;
  const noBestBid = noPrices?.bestBid ?? getBestBid(noOrderBook) ?? 0;
  const noBestAsk = noPrices?.bestAsk ?? getBestAsk(noOrderBook) ?? 1;

  const isValid = yesBestBid > 0 && noBestBid > 0;
  const potentialProfit = 1.0 - (yesBestAsk + noBestAsk);

  return {
    yes: { bestBid: yesBestBid, bestAsk: yesBestAsk },
    no: { bestBid: noBestBid, bestAsk: noBestAsk },
    potentialProfit,
    isValid,
  };
}

/**
 * Calculate time progress and scaled max position
 */
function calculateTimeScaling(
  botStartTime: Date | undefined,
  marketEndTime: Date | undefined,
  maxPositionPerLeg: number
): { timeProgress: number; scaledMaxPosition: number } {
  let timeProgress = 0;
  let scaledMaxPosition = maxPositionPerLeg;

  if (botStartTime && marketEndTime) {
    const now = Date.now();
    const startTime = botStartTime.getTime();
    const endTime = marketEndTime.getTime();
    const totalDuration = endTime - startTime;

    if (totalDuration > 0 && now >= startTime) {
      const elapsed = now - startTime;
      timeProgress = Math.min(1, Math.max(0, elapsed / totalDuration));
      const timeRemaining = 1 - timeProgress;

      scaledMaxPosition = Math.floor(maxPositionPerLeg * timeRemaining);

      console.log(
        `[Arb] Time: ${(timeProgress * 100).toFixed(1)}% elapsed, ` +
        `maxPosition: ${maxPositionPerLeg} → ${scaledMaxPosition}`
      );
    }
  }

  return { timeProgress, scaledMaxPosition };
}

export class ArbitrageExecutor implements IStrategyExecutor {
  /** Executor metadata - declares dual-asset requirements */
  readonly metadata: ExecutorMetadata = {
    requiredAssets: [
      { configKey: 'assetId', label: 'YES', subscriptions: ['orderBook', 'price', 'trades'] },
      { configKey: 'noAssetId', label: 'NO', subscriptions: ['orderBook', 'price', 'trades'] },
    ],
    positionHandler: 'multi',
    staleOrderRules: {
      maxPriceDistance: 0.20,
      perOutcome: true,
    },
    fillabilityThreshold: 0.80,
  };

  // Shared state and decision engine
  private state = new ArbitrageState();
  private decisionEngine: DecisionEngine | null = null;
  private currentConfig: ReturnType<typeof parseConfig> | null = null;

  /**
   * Clean up state for a deleted bot to prevent memory leaks
   */
  cleanup(botId: string): void {
    this.state.cleanup(botId);
  }

  /**
   * Initialize or update the decision engine with current config
   */
  private getDecisionEngine(config: ReturnType<typeof parseConfig>): DecisionEngine {
    // Re-create if config changed
    if (!this.decisionEngine || this.currentConfig !== config) {
      const validator = new PriceValidator(config.profitThreshold, config.maxSingleLegPrice);
      this.decisionEngine = new DecisionEngine(config, this.state, validator);
      this.currentConfig = config;
    }
    return this.decisionEngine;
  }

  async execute(context: StrategyContext): Promise<StrategySignal | null> {
    const { bot, orderBook, noOrderBook, tickSize, yesPrices, noPrices } = context;

    // 1. Parse configuration
    const config = parseConfig((bot.config.strategyConfig || {}) as Record<string, unknown>);
    const decisionEngine = this.getDecisionEngine(config);

    // 2. Extract market data
    const marketData = extractMarketData(orderBook, noOrderBook, yesPrices, noPrices);
    if (!marketData.isValid) {
      console.log(`[Arb] Missing order book data, skipping cycle`);
      return null;
    }

    // 3. Calculate time progress and scaled max position
    const { timeProgress, scaledMaxPosition } = calculateTimeScaling(
      context.botStartTime,
      context.marketEndTime,
      config.maxPositionPerLeg
    );

    // 4. Log close-out mode if active
    if (timeProgress >= config.closeOutThreshold) {
      console.log(
        `[Arb] CLOSE-OUT MODE: ${((1 - timeProgress) * 100).toFixed(1)}% time remaining, ` +
        `forcing hedge on lagging leg`
      );
    }

    // 5. Analyze positions
    const analysis = analyzePositions(context, config.imbalanceThreshold, config.orderSize);

    // 6. Make decision
    const decision = decisionEngine.decide(
      bot.config.id,
      analysis,
      marketData,
      timeProgress,
      scaledMaxPosition
    );

    if (!decision) return null;

    // 7. Create signal
    const tick = tickSize ? parseFloat(tickSize.tick_size) : 0.01;
    const prices = decision.leg === 'YES' ? marketData.yes : marketData.no;

    return createBuySignal(
      decision.leg,
      prices.bestBid,
      prices.bestAsk,
      decision.orderSize,
      tick,
      marketData.potentialProfit,
      decision.aggressive
    );
  }
}
