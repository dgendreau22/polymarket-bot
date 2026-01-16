/**
 * Mock Factory for Strategy Testing
 *
 * Provides helper functions to create mock StrategyContext and related objects
 * for unit testing strategy algorithms.
 */

import type {
  StrategyContext,
  BotInstance,
  BotConfig,
  Position,
  BotMetrics,
} from '@/lib/bots/types';
import type { OrderBook, LastTrade, TickSize } from '@/lib/polymarket/types';

/**
 * Create a mock BotConfig
 */
export function createMockBotConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    id: 'test-bot-1',
    name: 'Test Bot',
    strategySlug: 'test-strategy',
    marketId: 'test-market-1',
    marketName: 'Test Market',
    assetId: 'test-asset-yes',
    noAssetId: 'test-asset-no',
    mode: 'dry_run',
    strategyConfig: {},
    ...overrides,
  };
}

/**
 * Create a mock Position
 */
export function createMockPosition(overrides: Partial<Position> = {}): Position {
  return {
    marketId: 'test-market-1',
    assetId: 'test-asset-yes',
    outcome: 'YES',
    size: '0',
    avgEntryPrice: '0',
    realizedPnl: '0',
    ...overrides,
  };
}

/**
 * Create a mock BotMetrics
 */
export function createMockBotMetrics(overrides: Partial<BotMetrics> = {}): BotMetrics {
  return {
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    totalPnl: '0',
    unrealizedPnl: '0',
    maxDrawdown: '0',
    avgTradeSize: '0',
    ...overrides,
  };
}

/**
 * Create a mock BotInstance
 */
export function createMockBotInstance(overrides: Partial<BotInstance> = {}): BotInstance {
  return {
    config: createMockBotConfig(overrides.config),
    state: 'running',
    position: createMockPosition(overrides.position),
    metrics: createMockBotMetrics(overrides.metrics),
    createdAt: new Date(),
    updatedAt: new Date(),
    startedAt: new Date(),
    ...overrides,
  };
}

/**
 * Create a mock OrderBook
 */
export function createMockOrderBook(
  bestBid = 0.49,
  bestAsk = 0.51,
  depth = 5
): OrderBook {
  const bids = Array.from({ length: depth }, (_, i) => ({
    price: (bestBid - i * 0.01).toFixed(2),
    size: '100',
  }));

  const asks = Array.from({ length: depth }, (_, i) => ({
    price: (bestAsk + i * 0.01).toFixed(2),
    size: '100',
  }));

  return {
    market: 'test-market',
    asset_id: 'test-asset',
    bids,
    asks,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a mock LastTrade
 */
export function createMockLastTrade(overrides: Partial<LastTrade> = {}): LastTrade {
  return {
    asset_id: 'test-asset',
    price: '0.50',
    side: 'BUY',
    size: '10',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a mock TickSize
 */
export function createMockTickSize(tickSize = '0.01'): TickSize {
  return {
    asset_id: 'test-asset',
    tick_size: tickSize,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a complete mock StrategyContext
 */
export function createMockContext(overrides: Partial<StrategyContext> = {}): StrategyContext {
  const bot = createMockBotInstance(overrides.bot);
  const position = overrides.position ?? createMockPosition();
  const orderBook = overrides.orderBook ?? createMockOrderBook();
  const noOrderBook = overrides.noOrderBook ?? createMockOrderBook(0.49, 0.51);

  return {
    bot,
    currentPrice: { yes: '0.50', no: '0.50' },
    position,
    orderBook,
    noOrderBook,
    lastTrade: createMockLastTrade(overrides.lastTrade),
    tickSize: createMockTickSize(),
    pendingBuyQuantity: 0,
    pendingSellQuantity: 0,
    yesPendingBuy: 0,
    noPendingBuy: 0,
    yesPendingAvgPrice: 0,
    noPendingAvgPrice: 0,
    positions: [position],
    noAssetId: bot.config.noAssetId,
    yesPrices: { bestBid: 0.49, bestAsk: 0.51 },
    noPrices: { bestBid: 0.49, bestAsk: 0.51 },
    ...overrides,
  };
}

/**
 * Create a context with specific YES/NO positions
 */
export function createContextWithPositions(
  yesSize: number,
  yesAvg: number,
  noSize: number,
  noAvg: number,
  pendingOverrides: Partial<StrategyContext> = {}
): StrategyContext {
  const yesPosition = createMockPosition({
    outcome: 'YES',
    size: yesSize.toString(),
    avgEntryPrice: yesAvg.toString(),
  });

  const noPosition = createMockPosition({
    outcome: 'NO',
    assetId: 'test-asset-no',
    size: noSize.toString(),
    avgEntryPrice: noAvg.toString(),
  });

  return createMockContext({
    position: yesPosition,
    positions: [yesPosition, noPosition],
    ...pendingOverrides,
  });
}

/**
 * Create a context with specific order book spread
 */
export function createContextWithSpread(
  yesBid: number,
  yesAsk: number,
  noBid = 0.49,
  noAsk = 0.51
): StrategyContext {
  return createMockContext({
    orderBook: createMockOrderBook(yesBid, yesAsk),
    noOrderBook: createMockOrderBook(noBid, noAsk),
    yesPrices: { bestBid: yesBid, bestAsk: yesAsk },
    noPrices: { bestBid: noBid, bestAsk: noAsk },
  });
}
