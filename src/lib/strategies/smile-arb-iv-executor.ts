/**
 * Smile Arbitrage IV Strategy Executor
 *
 * Exploits IV mispricing between Deribit options and Polymarket binary options.
 * Uses Black-Scholes theoretical pricing from interpolated IV surface to find
 * edges on Polymarket markets.
 *
 * Algorithm:
 * 1. Periodically refresh Deribit IV surface snapshot
 * 2. Discover relevant Polymarket markets (auto-scan or manual)
 * 3. For each discovered market/strike:
 *    - Compute theoretical price using interpolated IV
 *    - Calculate edges for YES/NO buy/sell opportunities
 *    - Track best edge opportunity
 * 4. Execute best trade if edge > 0 and within risk limits
 */

import { log, warn, createLogger } from '@/lib/logger';
import type {
  IStrategyExecutor,
  StrategyContext,
  StrategySignal,
  ExecutorMetadata,
} from '../bots/types';
import { DeribitClient } from '@/lib/deribit/client';
import type { IVSnapshot } from '@/lib/deribit/types';
import {
  isWithinCutoff,
  computeTheoreticalPriceWithDiagnostics,
  PortfolioManager,
  MarketDiscovery,
  type DiscoveredMarket,
} from './smile-arb-iv';

// ============================================================================
// Types
// ============================================================================

interface SmileArbIVConfig {
  discoveryMode: 'auto-scan' | 'manual';
  searchPattern: string;
  manualMarketIds: string[];
  settlementDate: string;
  maxNotionalPerExpiry: number;
  maxNotionalPerStrike: number;
  cutoffMinutes: number;
  edgeBuffer: number;
  minDepth: number;
  ivRefreshSeconds: number;
  orderSize: number;
}

interface PerBotState {
  lastIVRefresh: number;
  lastDiscovery: number;
  portfolioManager: PortfolioManager;
  discoveredMarkets: DiscoveredMarket[];
  ivSnapshot: IVSnapshot | null;
}

interface EdgeOpportunity {
  market: DiscoveredMarket;
  action: 'BUY' | 'SELL';
  side: 'YES' | 'NO';
  edge: number;
  price: number;
  theoPrice: number;
  iv: number;
  confidence: number;
  depth: number;
}

// ============================================================================
// Constants
// ============================================================================

const logger = createLogger('SmileArbIV');
const DISCOVERY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_CONFIG: SmileArbIVConfig = {
  discoveryMode: 'auto-scan',
  searchPattern: 'BTC above $',
  manualMarketIds: [],
  settlementDate: '',
  maxNotionalPerExpiry: 1000,
  maxNotionalPerStrike: 200,
  cutoffMinutes: 10,
  edgeBuffer: 0.02,
  minDepth: 100,
  ivRefreshSeconds: 30,
  orderSize: 10,
};

// ============================================================================
// Configuration Parsing
// ============================================================================

function parseConfig(raw: Record<string, unknown>): SmileArbIVConfig {
  return {
    discoveryMode:
      raw.discoveryMode === 'manual' ? 'manual' : DEFAULT_CONFIG.discoveryMode,
    searchPattern:
      typeof raw.searchPattern === 'string'
        ? raw.searchPattern
        : DEFAULT_CONFIG.searchPattern,
    manualMarketIds: Array.isArray(raw.manualMarketIds)
      ? raw.manualMarketIds.filter((id): id is string => typeof id === 'string')
      : DEFAULT_CONFIG.manualMarketIds,
    settlementDate:
      typeof raw.settlementDate === 'string'
        ? raw.settlementDate
        : DEFAULT_CONFIG.settlementDate,
    maxNotionalPerExpiry:
      typeof raw.maxNotionalPerExpiry === 'number'
        ? raw.maxNotionalPerExpiry
        : DEFAULT_CONFIG.maxNotionalPerExpiry,
    maxNotionalPerStrike:
      typeof raw.maxNotionalPerStrike === 'number'
        ? raw.maxNotionalPerStrike
        : DEFAULT_CONFIG.maxNotionalPerStrike,
    cutoffMinutes:
      typeof raw.cutoffMinutes === 'number'
        ? raw.cutoffMinutes
        : DEFAULT_CONFIG.cutoffMinutes,
    edgeBuffer:
      typeof raw.edgeBuffer === 'number'
        ? raw.edgeBuffer
        : DEFAULT_CONFIG.edgeBuffer,
    minDepth:
      typeof raw.minDepth === 'number'
        ? raw.minDepth
        : DEFAULT_CONFIG.minDepth,
    ivRefreshSeconds:
      typeof raw.ivRefreshSeconds === 'number'
        ? raw.ivRefreshSeconds
        : DEFAULT_CONFIG.ivRefreshSeconds,
    orderSize:
      typeof raw.orderSize === 'number'
        ? raw.orderSize
        : DEFAULT_CONFIG.orderSize,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract best bid/ask prices from order book
 */
function extractPrices(orderBook: {
  bids?: Array<{ price: string; size: string }>;
  asks?: Array<{ price: string; size: string }>;
}): { bestBid: number; bestAsk: number; bidDepth: number; askDepth: number } {
  const sortedBids = [...(orderBook.bids || [])].sort(
    (a, b) => parseFloat(b.price) - parseFloat(a.price)
  );
  const sortedAsks = [...(orderBook.asks || [])].sort(
    (a, b) => parseFloat(a.price) - parseFloat(b.price)
  );

  const bestBid = sortedBids.length > 0 ? parseFloat(sortedBids[0].price) : 0;
  const bestAsk = sortedAsks.length > 0 ? parseFloat(sortedAsks[0].price) : 1;

  // Calculate depth at best level
  const bidDepth = sortedBids.length > 0 ? parseFloat(sortedBids[0].size) : 0;
  const askDepth = sortedAsks.length > 0 ? parseFloat(sortedAsks[0].size) : 0;

  return { bestBid, bestAsk, bidDepth, askDepth };
}

/**
 * Convert confidence level to numeric value (0-1)
 */
function confidenceToNumber(confidence: 'high' | 'medium' | 'low'): number {
  switch (confidence) {
    case 'high':
      return 0.9;
    case 'medium':
      return 0.6;
    case 'low':
      return 0.3;
  }
}

/**
 * Round price to tick size
 */
function roundToTick(price: number, tickSize: number): number {
  return Math.round(price / tickSize) * tickSize;
}

// ============================================================================
// SmileArbIVExecutor
// ============================================================================

export class SmileArbIVExecutor implements IStrategyExecutor {
  /** Executor metadata */
  readonly metadata: ExecutorMetadata = {
    requiredAssets: [
      {
        configKey: 'assetId',
        label: 'YES',
        subscriptions: ['orderBook', 'price'],
      },
      {
        configKey: 'noAssetId',
        label: 'NO',
        subscriptions: ['orderBook', 'price'],
      },
    ],
    positionHandler: 'multi',
    staleOrderRules: {
      maxPriceDistance: 0.15,
      perOutcome: true,
    },
  };

  // Per-bot state management
  private botStates: Map<string, PerBotState> = new Map();
  private marketDiscovery = new MarketDiscovery();

  /**
   * Clean up state for a deleted bot
   */
  cleanup(botId: string): void {
    this.botStates.delete(botId);
    log('SmileArbIV', `Cleaned up state for bot ${botId}`);
  }

  /**
   * Initialize or get state for a bot
   */
  private getBotState(botId: string, config: SmileArbIVConfig): PerBotState {
    let state = this.botStates.get(botId);

    if (!state) {
      state = {
        lastIVRefresh: 0,
        lastDiscovery: 0,
        portfolioManager: new PortfolioManager(
          config.maxNotionalPerStrike,
          config.maxNotionalPerExpiry
        ),
        discoveredMarkets: [],
        ivSnapshot: null,
      };
      this.botStates.set(botId, state);
      log('SmileArbIV', `Initialized state for bot ${botId}`);
    }

    return state;
  }

  /**
   * Main execution method
   */
  async execute(context: StrategyContext): Promise<StrategySignal | null> {
    const { bot, orderBook, noOrderBook, tickSize } = context;
    const botId = bot.config.id;

    // 1. Parse configuration
    const config = parseConfig(
      (bot.config.strategyConfig || {}) as Record<string, unknown>
    );

    // Validate required configuration
    if (!config.settlementDate) {
      warn('SmileArbIV', `Bot ${botId}: settlementDate is required`);
      return null;
    }

    // 2. Initialize/get bot state
    const state = this.getBotState(botId, config);

    // 3. Check cutoff - skip if within cutoffMinutes of settlement
    const settlementDate = new Date(config.settlementDate);
    if (isWithinCutoff(settlementDate, config.cutoffMinutes)) {
      log(
        'SmileArbIV',
        `Bot ${botId}: Within ${config.cutoffMinutes}min cutoff, skipping`
      );
      return null;
    }

    // 4. Refresh IV surface if needed
    const now = Date.now();
    const ivRefreshIntervalMs = config.ivRefreshSeconds * 1000;

    if (now - state.lastIVRefresh >= ivRefreshIntervalMs) {
      try {
        state.ivSnapshot = await DeribitClient.getInstance().getIVSnapshot();
        state.lastIVRefresh = now;
        logger.log(
          `Bot ${botId}: Refreshed IV snapshot, underlying=${state.ivSnapshot.underlying_price}`
        );
      } catch (err) {
        warn('SmileArbIV', `Bot ${botId}: Failed to refresh IV`, err);
        // Continue with cached IV if available
        if (!state.ivSnapshot) {
          warn('SmileArbIV', `Bot ${botId}: No IV data available, skipping`);
          return null;
        }
      }
    }

    if (!state.ivSnapshot) {
      warn('SmileArbIV', `Bot ${botId}: No IV snapshot available`);
      return null;
    }

    // 5. Refresh market discovery if needed
    if (now - state.lastDiscovery >= DISCOVERY_INTERVAL_MS) {
      try {
        state.discoveredMarkets = await this.marketDiscovery.discoverMarkets({
          mode: config.discoveryMode,
          searchPattern: config.searchPattern,
          manualMarketIds: config.manualMarketIds,
          settlementDate: config.settlementDate,
        });
        state.lastDiscovery = now;
        logger.log(
          `Bot ${botId}: Discovered ${state.discoveredMarkets.length} markets`
        );
      } catch (err) {
        warn('SmileArbIV', `Bot ${botId}: Market discovery failed`, err);
        // Continue with cached markets
      }
    }

    if (state.discoveredMarkets.length === 0) {
      log('SmileArbIV', `Bot ${botId}: No markets discovered, skipping`);
      return null;
    }

    // 6. Extract order book data for current market
    // Note: In multi-market mode, we'd need order books for each discovered market
    // For now, we use the context's order book (single market mode)
    const yesPrices = extractPrices(orderBook || { bids: [], asks: [] });
    const noPrices = extractPrices(noOrderBook || { bids: [], asks: [] });

    if (yesPrices.bestBid === 0 || noPrices.bestBid === 0) {
      log('SmileArbIV', `Bot ${botId}: Missing order book data, skipping`);
      return null;
    }

    // 7. Find best edge opportunity across all markets/strikes
    const opportunities: EdgeOpportunity[] = [];

    for (const market of state.discoveredMarkets) {
      // Skip markets without valid settlement date
      if (!market.settlementDate) continue;

      // Compute theoretical price
      const pricingResult = computeTheoreticalPriceWithDiagnostics(
        state.ivSnapshot,
        market.strike,
        market.settlementDate
      );

      const pTheo = pricingResult.price;
      const iv = pricingResult.iv;
      const confidence = confidenceToNumber(pricingResult.confidence);

      // Calculate edges (with buffer)
      const edgeBuyYes = pTheo - yesPrices.bestAsk - config.edgeBuffer;
      const edgeBuyNo = 1 - pTheo - noPrices.bestAsk - config.edgeBuffer;
      const edgeSellYes = yesPrices.bestBid - pTheo - config.edgeBuffer;
      const edgeSellNo = noPrices.bestBid - (1 - pTheo) - config.edgeBuffer;

      // Log edge calculations for debugging
      logger.log(
        `Bot ${botId} | Strike ${market.strike}: theo=${pTheo.toFixed(3)}, ` +
          `iv=${(iv * 100).toFixed(1)}%, edges=[buyY:${edgeBuyYes.toFixed(3)}, ` +
          `buyN:${edgeBuyNo.toFixed(3)}, sellY:${edgeSellYes.toFixed(3)}, ` +
          `sellN:${edgeSellNo.toFixed(3)}]`
      );

      // Check BUY YES opportunity
      if (edgeBuyYes > 0 && yesPrices.askDepth >= config.minDepth) {
        opportunities.push({
          market,
          action: 'BUY',
          side: 'YES',
          edge: edgeBuyYes,
          price: yesPrices.bestAsk,
          theoPrice: pTheo,
          iv,
          confidence,
          depth: yesPrices.askDepth,
        });
      }

      // Check BUY NO opportunity
      if (edgeBuyNo > 0 && noPrices.askDepth >= config.minDepth) {
        opportunities.push({
          market,
          action: 'BUY',
          side: 'NO',
          edge: edgeBuyNo,
          price: noPrices.bestAsk,
          theoPrice: 1 - pTheo,
          iv,
          confidence,
          depth: noPrices.askDepth,
        });
      }

      // Check SELL YES opportunity (if we have a position to sell)
      if (edgeSellYes > 0 && yesPrices.bidDepth >= config.minDepth) {
        opportunities.push({
          market,
          action: 'SELL',
          side: 'YES',
          edge: edgeSellYes,
          price: yesPrices.bestBid,
          theoPrice: pTheo,
          iv,
          confidence,
          depth: yesPrices.bidDepth,
        });
      }

      // Check SELL NO opportunity (if we have a position to sell)
      if (edgeSellNo > 0 && noPrices.bidDepth >= config.minDepth) {
        opportunities.push({
          market,
          action: 'SELL',
          side: 'NO',
          edge: edgeSellNo,
          price: noPrices.bestBid,
          theoPrice: 1 - pTheo,
          iv,
          confidence,
          depth: noPrices.bidDepth,
        });
      }
    }

    // 8. Select best opportunity
    if (opportunities.length === 0) {
      log('SmileArbIV', `Bot ${botId}: No edge opportunities found`);
      return null;
    }

    // Sort by edge (highest first)
    opportunities.sort((a, b) => b.edge - a.edge);
    const best = opportunities[0];

    // 9. Check risk limits via portfolio manager
    if (!state.portfolioManager.canTrade(best.market.strike, config.orderSize, best.price)) {
      log(
        'SmileArbIV',
        `Bot ${botId}: Risk limit reached for strike ${best.market.strike}`
      );
      return null;
    }

    // 10. Generate signal
    const tick = tickSize ? parseFloat(tickSize.tick_size) : 0.01;
    const roundedPrice = roundToTick(best.price, tick);

    const signal: StrategySignal = {
      action: best.action,
      side: best.side,
      price: roundedPrice.toFixed(getDecimalPlaces(tick)),
      quantity: config.orderSize.toString(),
      reason:
        `Edge ${(best.edge * 100).toFixed(1)}% | theo=${best.theoPrice.toFixed(3)} | ` +
        `IV=${(best.iv * 100).toFixed(1)}% | strike=${best.market.strike}`,
      confidence: best.confidence,
    };

    log(
      'SmileArbIV',
      `Bot ${botId}: Signal ${signal.action} ${signal.side} @ ${signal.price} | ${signal.reason}`
    );

    return signal;
  }
}

/**
 * Get number of decimal places for a tick size
 */
function getDecimalPlaces(tickSize: number): number {
  const str = tickSize.toString();
  const decimalIndex = str.indexOf('.');
  if (decimalIndex === -1) return 0;
  return str.length - decimalIndex - 1;
}
