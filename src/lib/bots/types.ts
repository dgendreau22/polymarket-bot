/**
 * Bot Framework Type Definitions
 */

import type { OrderBook, LastTrade, TickSize } from '../polymarket/types';

// ============================================================================
// Bot Types
// ============================================================================

/** Bot execution mode */
export type BotMode = 'live' | 'dry_run';

/** Bot lifecycle state */
export type BotState = 'running' | 'stopped' | 'paused';

/** Bot configuration */
export interface BotConfig {
  id: string;
  name: string;
  strategySlug: string;
  marketId: string;
  marketName?: string;
  assetId?: string;
  /** NO asset ID for arbitrage strategies */
  noAssetId?: string;
  mode: BotMode;
  strategyConfig?: Record<string, unknown>;
}

/** Bot instance with runtime state */
export interface BotInstance {
  config: BotConfig;
  state: BotState;
  position: Position;
  metrics: BotMetrics;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  stoppedAt?: Date;
}

/** Database row for bot */
export interface BotRow {
  id: string;
  name: string;
  strategy_slug: string;
  market_id: string;
  market_name: string | null;
  asset_id: string | null;
  /** NO asset ID for arbitrage strategies */
  no_asset_id: string | null;
  mode: BotMode;
  state: BotState;
  config: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  stopped_at: string | null;
}

// ============================================================================
// Position Types
// ============================================================================

/** Position tracking */
export interface Position {
  marketId: string;
  assetId: string;
  outcome: 'YES' | 'NO';
  size: string;
  avgEntryPrice: string;
  realizedPnl: string;
}

/** Database row for position */
export interface PositionRow {
  id: string;
  bot_id: string;
  market_id: string;
  asset_id: string;
  outcome: 'YES' | 'NO';
  size: string;
  avg_entry_price: string;
  realized_pnl: string;
  updated_at: string;
}

// ============================================================================
// Arbitrage Position Types (dual-leg YES + NO)
// ============================================================================

/** Arbitrage position status */
export type ArbitragePositionStatus = 'building' | 'complete' | 'closed';

/** Arbitrage position tracking (YES + NO legs) */
export interface ArbitragePosition {
  marketId: string;
  yesAssetId: string;
  noAssetId: string;
  yesSize: string;
  noSize: string;
  yesAvgEntryPrice: string;
  noAvgEntryPrice: string;
  combinedCost: string;
  realizedPnl: string;
  status: ArbitragePositionStatus;
}

/** Database row for arbitrage position */
export interface ArbitragePositionRow {
  id: string;
  bot_id: string;
  market_id: string;
  yes_asset_id: string;
  no_asset_id: string;
  yes_size: string;
  no_size: string;
  yes_avg_entry_price: string;
  no_avg_entry_price: string;
  combined_cost: string;
  realized_pnl: string;
  status: ArbitragePositionStatus;
  updated_at: string;
}

// ============================================================================
// Trade Types
// ============================================================================

/** Trade status */
export type TradeStatus = 'pending' | 'filled' | 'cancelled' | 'failed';

/** Trade record */
export interface Trade {
  id: string;
  botId: string;
  botName?: string;
  strategySlug: string;
  marketId: string;
  assetId: string;
  mode: BotMode;
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO';
  price: string;
  quantity: string;
  totalValue: string;
  fee: string;
  pnl: string;
  status: TradeStatus;
  orderId?: string;
  executedAt: Date;
  createdAt: Date;
}

/** Database row for trade */
export interface TradeRow {
  id: string;
  bot_id: string;
  bot_name?: string;
  strategy_slug: string;
  market_id: string;
  asset_id: string;
  mode: BotMode;
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO';
  price: string;
  quantity: string;
  total_value: string;
  fee: string;
  pnl: string;
  status: TradeStatus;
  order_id: string | null;
  executed_at: string;
  created_at: string;
}

/** Trade filters for querying */
export interface TradeFilters {
  botId?: string;
  strategySlug?: string;
  marketId?: string;
  mode?: BotMode;
  side?: 'BUY' | 'SELL';
  outcome?: 'YES' | 'NO';
  status?: TradeStatus;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Limit Order Types
// ============================================================================

/** Limit order status */
export type LimitOrderStatus = 'open' | 'partially_filled' | 'filled' | 'cancelled';

/** Limit order record */
export interface LimitOrder {
  id: string;
  botId: string;
  assetId: string;
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO';
  price: string;
  quantity: string;
  filledQuantity: string;
  status: LimitOrderStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Database row for limit order */
export interface LimitOrderRow {
  id: string;
  bot_id: string;
  asset_id: string;
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO';
  price: string;
  quantity: string;
  filled_quantity: string;
  status: LimitOrderStatus;
  created_at: string;
  updated_at: string;
}

/** Fill result from order matching */
export interface FillResult {
  orderId: string;
  botId: string;
  filledQuantity: string;
  remainingQuantity: string;
  fillPrice: string;
  isFullyFilled: boolean;
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO';
}

// ============================================================================
// Metrics Types
// ============================================================================

/** Bot performance metrics */
export interface BotMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnl: string;
  unrealizedPnl: string;
  maxDrawdown: string;
  avgTradeSize: string;
}

// ============================================================================
// Strategy Types
// ============================================================================

/** Strategy parameter definition */
export interface StrategyParameter {
  name: string;
  type: 'number' | 'string' | 'boolean';
  description: string;
  default: string | number | boolean;
  min?: number;
  max?: number;
  required: boolean;
}

/** Risk management rules */
export interface RiskManagementRules {
  maxPositionSize: string;
  maxDrawdown: string;
  stopLoss?: string;
  takeProfit?: string;
  maxDailyLoss?: string;
  maxOpenOrders?: number;
}

/** Strategy definition from .md file */
export interface StrategyDefinition {
  slug: string;
  name: string;
  version: string;
  description: string;
  algorithm: string;
  parameters: StrategyParameter[];
  riskManagement: RiskManagementRules;
  author?: string;
}

/** Strategy execution context */
export interface StrategyContext {
  bot: BotInstance;
  currentPrice: { yes: string; no: string };
  position: Position;
  orderBook?: OrderBook;
  lastTrade?: LastTrade;
  tickSize?: TickSize;
  /** Total quantity of pending BUY orders (not yet filled) */
  pendingBuyQuantity?: number;
  /** Total quantity of pending SELL orders (not yet filled) */
  pendingSellQuantity?: number;
  /** Pending BUY quantity for YES asset (arbitrage) */
  yesPendingBuy?: number;
  /** Pending BUY quantity for NO asset (arbitrage) */
  noPendingBuy?: number;
  // Multi-asset fields (for arbitrage and other multi-leg strategies)
  /** All positions for this bot (YES and NO for arbitrage) */
  positions?: Position[];
  /** NO asset ID for arbitrage strategies */
  noAssetId?: string;
  /** NO side order book for arbitrage strategies */
  noOrderBook?: OrderBook;
  /** YES side best bid/ask prices */
  yesPrices?: { bestBid: number; bestAsk: number };
  /** NO side best bid/ask prices */
  noPrices?: { bestBid: number; bestAsk: number };
}

/** Strategy signal output */
export interface StrategySignal {
  action: 'BUY' | 'SELL' | 'HOLD';
  side: 'YES' | 'NO';
  price: string;
  quantity: string;
  reason: string;
  confidence: number;
}

/** Strategy statistics */
export interface StrategyStats {
  slug: string;
  name: string;
  totalBots: number;
  activeBots: number;
  totalTrades: number;
  winRate: number;
  totalPnl: string;
  avgTradeSize: string;
  maxDrawdown: string;
  profitFactor: number;
}

// ============================================================================
// Executor Interface
// ============================================================================

/** Strategy executor interface */
export interface IStrategyExecutor {
  execute(context: StrategyContext): Promise<StrategySignal | null>;
  validate?(config: Record<string, unknown>): boolean;
}

/** Trade execution result */
export interface TradeExecutionResult {
  success: boolean;
  trade?: Trade;
  error?: string;
  orderId?: string;
}

// ============================================================================
// Event Types
// ============================================================================

/** Bot lifecycle events */
export type BotEvent =
  | { type: 'STARTED'; timestamp: Date }
  | { type: 'STOPPED'; timestamp: Date }
  | { type: 'PAUSED'; timestamp: Date }
  | { type: 'RESUMED'; timestamp: Date }
  | { type: 'TRADE_EXECUTED'; trade: Trade }
  | { type: 'ORDER_FILLED'; fill: FillResult; timestamp: Date }
  | { type: 'ERROR'; error: string; timestamp: Date };
