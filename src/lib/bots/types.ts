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
  /** NO asset ID for dual-asset trading */
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
  /** Total position size summed from all positions (YES + NO for dual-asset bots) */
  totalPositionSize?: number;
  /** All positions for this bot (YES and NO for dual-asset bots) */
  positions?: Position[];
  /** Market end/close time (from Gamma API) */
  marketEndTime?: Date;
}

/** Database row for bot */
export interface BotRow {
  id: string;
  name: string;
  strategy_slug: string;
  market_id: string;
  market_name: string | null;
  asset_id: string | null;
  /** NO asset ID for dual-asset trading */
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
// Trade Types
// ============================================================================

/** Trade status */
export type TradeStatus = 'pending' | 'filled' | 'cancelled' | 'failed' | 'settlement';

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
  /** Pending BUY quantity for YES asset (dual-asset bots) */
  yesPendingBuy?: number;
  /** Pending BUY quantity for NO asset (dual-asset bots) */
  noPendingBuy?: number;
  /** Weighted average price of pending YES BUY orders */
  yesPendingAvgPrice?: number;
  /** Weighted average price of pending NO BUY orders */
  noPendingAvgPrice?: number;
  // Multi-asset fields (for dual-asset and other multi-leg strategies)
  /** All positions for this bot (YES and NO for dual-asset bots) */
  positions?: Position[];
  /** NO asset ID for dual-asset trading */
  noAssetId?: string;
  /** NO side order book for dual-asset bots */
  noOrderBook?: OrderBook;
  /** YES side best bid/ask prices */
  yesPrices?: { bestBid: number; bestAsk: number };
  /** NO side best bid/ask prices */
  noPrices?: { bestBid: number; bestAsk: number };
  // Time-based fields (for position scaling as market approaches close)
  /** When the bot started running */
  botStartTime?: Date;
  /** When the market closes/expires */
  marketEndTime?: Date;
  /** Callback to emit bot events (for real-time updates) */
  emitEvent?: (event: BotEvent) => void;
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

/** Asset subscription types for market data */
export type AssetSubscription = 'orderBook' | 'price' | 'trades' | 'tickSize';

/** Asset requirement for strategy subscriptions */
export interface AssetRequirement {
  /** Key in BotConfig to get asset ID */
  configKey: 'assetId' | 'noAssetId';
  /** Label for this asset (e.g., 'YES', 'NO') */
  label: string;
  /** What data to subscribe to for this asset */
  subscriptions: AssetSubscription[];
}

/** Stale order cancellation rules */
export interface StaleOrderRules {
  /** Max age in seconds before order is considered stale */
  maxOrderAge?: number;
  /** Max distance from mid price (0.05 = 5%) */
  maxPriceDistance?: number;
  /** Check each outcome separately (for multi-asset strategies) */
  perOutcome?: boolean;
}

/** Strategy executor metadata - declares strategy requirements */
export interface ExecutorMetadata {
  /** What assets this strategy needs and their subscriptions */
  requiredAssets: AssetRequirement[];
  /** How to handle position updates: 'single' for in-memory, 'multi' for DB-only */
  positionHandler: 'single' | 'multi';
  /** Rules for cancelling stale orders */
  staleOrderRules?: StaleOrderRules;
  /** Threshold for counting pending orders as fillable (default: 1.0 = all) */
  fillabilityThreshold?: number;
}

/** Strategy executor interface */
export interface IStrategyExecutor {
  /** Metadata declaring strategy requirements */
  readonly metadata: ExecutorMetadata;
  /** Execute strategy and return signal */
  execute(context: StrategyContext): Promise<StrategySignal | null>;
  /** Optional config validation */
  validate?(config: Record<string, unknown>): boolean;
  /** Optional cleanup when bot is deleted */
  cleanup?(botId: string): void;
}

/** Trade execution result */
export interface TradeExecutionResult {
  success: boolean;
  trade?: Trade;
  error?: string;
  orderId?: string;
}

/** Pending order statistics for strategy context */
export interface PendingOrderStats {
  /** Total pending BUY quantity across all assets */
  totalBuy: number;
  /** Total pending SELL quantity across all assets */
  totalSell: number;
  /** Per-asset pending order stats (key: outcome label like 'YES', 'NO') */
  perAsset: Map<string, { qty: number; value: number }>;
}

// ============================================================================
// Event Types
// ============================================================================

/** Settlement summary for a single position */
export interface SettlementSummary {
  outcome: 'YES' | 'NO';
  size: number;
  entryPrice: number;
  settlementPrice: number;
  pnl: number;
}

/** Market resolution result */
export interface MarketResolution {
  winningOutcome: 'YES' | 'NO';
  yesResolutionPrice: number;
  noResolutionPrice: number;
  settlements: SettlementSummary[];
  totalRealizedPnl: number;
}

/** Strategy metric data for real-time charting */
export interface StrategyMetricData {
  botId: string;
  timestamp: number;
  tau: number | null;
  edge: number | null;
  qStar: number | null;
  theta: number | null;
  delta: number | null;
  price: number | null;
  positionYes: number;
  positionNo: number;
  totalPnl: number | null;
}

/** Bot lifecycle events */
export type BotEvent =
  | { type: 'STARTED'; timestamp: Date }
  | { type: 'STOPPED'; timestamp: Date }
  | { type: 'PAUSED'; timestamp: Date }
  | { type: 'RESUMED'; timestamp: Date }
  | { type: 'TRADE_EXECUTED'; trade: Trade }
  | { type: 'ORDER_FILLED'; fill: FillResult; timestamp: Date }
  | { type: 'ERROR'; error: string; timestamp: Date }
  | { type: 'MARKET_RESOLVED'; resolution: MarketResolution; timestamp: Date }
  | { type: 'METRICS_UPDATED'; metrics: StrategyMetricData; timestamp: Date };
