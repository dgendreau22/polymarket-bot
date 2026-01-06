/**
 * Bot Class
 *
 * Represents a trading bot instance with state machine lifecycle management.
 * Uses MarketDataManager for market data and executor metadata for behavior configuration.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  BotConfig,
  BotInstance,
  BotState,
  BotMode,
  Position,
  BotMetrics,
  StrategyContext,
  StrategySignal,
  Trade,
  BotEvent,
  LimitOrder,
  FillResult,
  ExecutorMetadata,
  PendingOrderStats,
  MarketResolution,
} from './types';
import type { OrderBook, LastTrade, TickSize } from '../polymarket/types';
import { getExecutor } from '../strategies/registry';
import { MarketDataManager, type AssetConfig } from './MarketDataManager';
import { processTradeForBotFills, fillMarketableOrders } from './LimitOrderMatcher';
import {
  getPositionsByBotId,
  getOrCreatePosition,
  updatePosition,
  rowToPosition,
  updateBotState,
} from '../persistence/BotRepository';
import {
  getOpenOrdersByBotId,
  cancelAllBotOrders,
  cancelStaleOrders,
  cancelStaleOrdersForOutcome,
  rowToLimitOrder,
} from '../persistence/LimitOrderRepository';
import { calculatePositionUpdate } from '../utils/PositionCalculator';
import { detectResolution, settleAllPositions } from '../utils/MarketResolver';

export type BotEventHandler = (event: BotEvent) => void;

export class Bot {
  private config: BotConfig;
  private state: BotState = 'stopped';
  private position: Position;
  private metrics: BotMetrics;
  private createdAt: Date;
  private updatedAt: Date;
  private startedAt?: Date;
  private stoppedAt?: Date;
  private marketEndTime?: Date;

  private intervalId?: NodeJS.Timeout;
  private eventHandlers: BotEventHandler[] = [];

  // Market data manager (replaces individual order book/price fields)
  private marketData: MarketDataManager | null = null;

  // Executor metadata (loaded on start)
  private executorMetadata: ExecutorMetadata | null = null;

  // Executor for trade execution (set by BotManager)
  private tradeExecutor?: (bot: Bot, signal: StrategySignal) => Promise<Trade | null>;

  // Market status tracking (auto-stop when market closes)
  private lastMarketCheck: number = 0;
  private readonly MARKET_CHECK_INTERVAL_MS = 60000;

  constructor(config: Omit<BotConfig, 'id'> & { id?: string }) {
    this.config = {
      ...config,
      id: config.id || uuidv4(),
    };

    this.position = {
      marketId: config.marketId,
      assetId: config.assetId || '',
      outcome: 'YES',
      size: '0',
      avgEntryPrice: '0',
      realizedPnl: '0',
    };

    this.metrics = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalPnl: '0',
      unrealizedPnl: '0',
      maxDrawdown: '0',
      avgTradeSize: '0',
    };

    this.createdAt = new Date();
    this.updatedAt = new Date();
  }

  // ============================================================================
  // Getters
  // ============================================================================

  get id(): string {
    return this.config.id;
  }

  get name(): string {
    return this.config.name;
  }

  get strategySlug(): string {
    return this.config.strategySlug;
  }

  get marketId(): string {
    return this.config.marketId;
  }

  get assetId(): string | undefined {
    return this.config.assetId;
  }

  get noAssetId(): string | undefined {
    return this.config.noAssetId;
  }

  get mode(): BotMode {
    return this.config.mode;
  }

  get currentState(): BotState {
    return this.state;
  }

  get isRunning(): boolean {
    return this.state === 'running';
  }

  get isPaused(): boolean {
    return this.state === 'paused';
  }

  get isStopped(): boolean {
    return this.state === 'stopped';
  }

  // ============================================================================
  // Lifecycle Methods
  // ============================================================================

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    if (this.state === 'running') {
      console.log(`[Bot ${this.id}] Already running`);
      return;
    }

    if (this.state === 'paused') {
      await this.resume();
      return;
    }

    console.log(`[Bot ${this.id}] Starting...`);

    // Get executor and metadata
    const executor = getExecutor(this.config.strategySlug);
    if (!executor) {
      throw new Error(`Unknown strategy: ${this.config.strategySlug}`);
    }
    this.executorMetadata = executor.metadata;

    // Build asset list from executor metadata
    const assets: AssetConfig[] = this.executorMetadata.requiredAssets
      .map(req => ({
        assetId: this.config[req.configKey] as string,
        label: req.label,
        subscriptions: req.subscriptions,
      }))
      .filter(a => a.assetId);

    // Initialize market data manager
    this.marketData = new MarketDataManager(this.id, assets);

    // Set up callbacks
    this.marketData.onUpdate(() => {
      if (this.state === 'running') {
        this.executeCycle().catch(err => {
          console.error(`[Bot ${this.id}] Execution cycle error:`, err);
          this.emitEvent({ type: 'ERROR', error: err.message, timestamp: new Date() });
        });
      }
    });

    this.marketData.onTrade((label, trade) => {
      if (this.state === 'running' && this.config.mode === 'dry_run') {
        const fills = processTradeForBotFills(this.id, trade);
        for (const fill of fills) {
          this.handleOrderFilled(fill);
        }
      }
    });

    // Fetch market end time for time-based position scaling
    await this.fetchMarketEndTime();

    // Connect to market data
    await this.marketData.connect();

    // Set state to running
    this.state = 'running';
    this.startedAt = new Date();
    this.updatedAt = new Date();

    // Start fallback interval (30 seconds) - refreshes data and runs cycle
    this.intervalId = setInterval(async () => {
      if (this.state === 'running' && this.marketData) {
        try {
          // Refresh data from CLOB API as fallback when WebSocket is slow
          await this.marketData.refreshAll();
          await this.executeCycle();
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          console.error(`[Bot ${this.id}] Fallback execution cycle error:`, error);
          this.emitEvent({ type: 'ERROR', error: error.message, timestamp: new Date() });
        }
      }
    }, 30000);

    this.emitEvent({ type: 'STARTED', timestamp: new Date() });
    console.log(`[Bot ${this.id}] Started with ${assets.length} assets`);
  }

  /**
   * Fetch market end time from Gamma API for time-based position scaling
   */
  private async fetchMarketEndTime(): Promise<void> {
    const marketId = this.config.marketId;
    if (!marketId) return;

    try {
      const GAMMA_HOST = process.env.POLYMARKET_GAMMA_HOST || 'https://gamma-api.polymarket.com';
      const response = await fetch(`${GAMMA_HOST}/markets/${encodeURIComponent(marketId)}`);

      if (response.ok) {
        const market = await response.json();
        if (market.endDateIso) {
          this.marketEndTime = new Date(market.endDateIso);
          console.log(`[Bot ${this.id.slice(0, 8)}] Market ends at: ${this.marketEndTime.toISOString()}`);
        }
      }
    } catch (error) {
      console.warn(`[Bot ${this.id.slice(0, 8)}] Failed to fetch market end time:`, error);
    }
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    if (this.state === 'stopped') {
      console.log(`[Bot ${this.id}] Already stopped`);
      return;
    }

    console.log(`[Bot ${this.id}] Stopping...`);

    // Clear interval
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    // Disconnect market data manager
    if (this.marketData) {
      this.marketData.disconnect();
      this.marketData = null;
    }

    // Cancel all pending orders
    const cancelledCount = cancelAllBotOrders(this.id);
    if (cancelledCount > 0) {
      console.log(`[Bot ${this.id}] Cancelled ${cancelledCount} pending orders`);
    }

    this.state = 'stopped';
    this.stoppedAt = new Date();
    this.updatedAt = new Date();

    this.emitEvent({ type: 'STOPPED', timestamp: new Date() });
    console.log(`[Bot ${this.id}] Stopped`);
  }

  /**
   * Pause the bot (keeps state, stops execution)
   */
  async pause(): Promise<void> {
    if (this.state !== 'running') {
      console.log(`[Bot ${this.id}] Cannot pause - not running`);
      return;
    }

    console.log(`[Bot ${this.id}] Pausing...`);

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    this.state = 'paused';
    this.updatedAt = new Date();

    this.emitEvent({ type: 'PAUSED', timestamp: new Date() });
    console.log(`[Bot ${this.id}] Paused`);
  }

  /**
   * Resume a paused bot
   */
  async resume(): Promise<void> {
    if (this.state !== 'paused') {
      console.log(`[Bot ${this.id}] Cannot resume - not paused`);
      return;
    }

    console.log(`[Bot ${this.id}] Resuming...`);

    this.intervalId = setInterval(() => {
      if (this.state === 'running') {
        this.executeCycle().catch(err => {
          console.error(`[Bot ${this.id}] Execution cycle error:`, err);
          this.emitEvent({ type: 'ERROR', error: err.message, timestamp: new Date() });
        });
      }
    }, 30000);

    this.state = 'running';
    this.updatedAt = new Date();

    this.emitEvent({ type: 'RESUMED', timestamp: new Date() });
    console.log(`[Bot ${this.id}] Resumed`);
  }

  // ============================================================================
  // Execution
  // ============================================================================

  /**
   * Execute one strategy cycle
   */
  private async executeCycle(): Promise<void> {
    if (this.state !== 'running' || !this.marketData || !this.executorMetadata) {
      return;
    }

    // Check if market is still open
    const marketOpen = await this.checkMarketStatus();
    if (!marketOpen) {
      await this.handleMarketClosed();
      return;
    }

    // Note: Don't call refreshAll() here - WebSocket provides real-time updates
    // refreshAll() is only called on initial connect and by the fallback interval

    const executor = getExecutor(this.config.strategySlug);
    if (!executor) {
      console.error(`[Bot ${this.id}] No executor found for strategy: ${this.config.strategySlug}`);
      return;
    }

    // Cancel stale orders using metadata rules
    this.cancelStaleOrders();

    // Check and fill marketable orders
    this.checkMarketableOrders();

    // Calculate pending order statistics
    const pendingStats = this.calculatePendingOrders();

    // Fetch positions from database
    const positionRows = getPositionsByBotId(this.id);
    const positions = positionRows.map(rowToPosition);

    // Get current price
    const currentPrice = this.marketData.getCurrentPrice();

    // Get YES order book and prices for context
    const orderBook = this.marketData.getOrderBook('YES') || undefined;
    const noOrderBook = this.marketData.getOrderBook('NO') || undefined;
    const tickSize = this.marketData.getAnyTickSize() || undefined;
    const lastTrade = this.marketData.getLastTrade('YES') || undefined;

    // Build YES/NO prices
    const yesPrices = this.marketData.getPrices('YES');
    const noPrices = this.marketData.getPrices('NO');

    // Build context
    const context: StrategyContext = {
      bot: this.toInstance(),
      currentPrice,
      position: this.position,
      orderBook,
      lastTrade,
      tickSize,
      pendingBuyQuantity: pendingStats.totalBuy,
      pendingSellQuantity: pendingStats.totalSell,
      yesPendingBuy: pendingStats.perAsset.get('YES')?.qty ?? 0,
      noPendingBuy: pendingStats.perAsset.get('NO')?.qty ?? 0,
      yesPendingAvgPrice: this.calculateAvgPrice(pendingStats.perAsset.get('YES')),
      noPendingAvgPrice: this.calculateAvgPrice(pendingStats.perAsset.get('NO')),
      positions: positions.length > 0 ? positions : undefined,
      noAssetId: this.config.noAssetId,
      noOrderBook,
      yesPrices: yesPrices ? { bestBid: yesPrices.bestBid, bestAsk: yesPrices.bestAsk } : undefined,
      noPrices: noPrices ? { bestBid: noPrices.bestBid, bestAsk: noPrices.bestAsk } : undefined,
      botStartTime: this.startedAt,
      marketEndTime: this.marketEndTime,
    };

    // Execute strategy
    const signal = await executor.execute(context);

    if (signal && signal.action !== 'HOLD') {
      console.log(`[Bot ${this.id}] Signal: ${signal.action} ${signal.quantity} ${signal.side} @ ${signal.price}`);

      if (this.tradeExecutor) {
        const trade = await this.tradeExecutor(this, signal);
        if (trade) {
          if (trade.status === 'filled') {
            this.updatePositionFromTrade(trade);
          }
          this.emitEvent({ type: 'TRADE_EXECUTED', trade });
        }
      }
    }
  }

  /**
   * Cancel stale orders using executor metadata rules
   */
  private cancelStaleOrders(): void {
    if (!this.executorMetadata?.staleOrderRules || !this.marketData) return;

    const rules = this.executorMetadata.staleOrderRules;

    if (rules.perOutcome) {
      // Per-outcome cancellation (multi-asset strategies)
      for (const [label, prices] of this.marketData.getAllPrices()) {
        const cancelled = cancelStaleOrdersForOutcome(
          this.id,
          label as 'YES' | 'NO',
          prices.midPrice,
          rules.maxOrderAge,
          rules.maxPriceDistance
        );
        if (cancelled.length > 0) {
          console.log(`[Bot ${this.id}] Cancelled ${cancelled.length} stale ${label} orders`);
        }
      }
    } else {
      // Single-outcome cancellation
      const prices = this.marketData.getPrices('YES');
      if (prices && prices.midPrice > 0 && prices.midPrice < 1) {
        const cancelled = cancelStaleOrders(
          this.id,
          prices.midPrice,
          rules.maxOrderAge,
          rules.maxPriceDistance
        );
        if (cancelled.length > 0) {
          console.log(`[Bot ${this.id}] Cancelled ${cancelled.length} stale orders`);
        }
      }
    }
  }

  /**
   * Check and fill marketable orders
   */
  private checkMarketableOrders(): void {
    if (!this.marketData) return;

    const yesOrderBook = this.marketData.getOrderBook('YES');
    const noOrderBook = this.marketData.getOrderBook('NO');

    if (yesOrderBook || noOrderBook) {
      const fills = fillMarketableOrders(this.id, yesOrderBook, noOrderBook);
      for (const fill of fills) {
        this.handleOrderFilled(fill);
      }
    }
  }

  /**
   * Calculate pending order statistics
   */
  private calculatePendingOrders(): PendingOrderStats {
    const openOrders = getOpenOrdersByBotId(this.id);
    const threshold = this.executorMetadata?.fillabilityThreshold ?? 1.0;

    const stats: PendingOrderStats = {
      totalBuy: 0,
      totalSell: 0,
      perAsset: new Map(),
    };

    for (const order of openOrders) {
      const remaining = parseFloat(order.quantity) - parseFloat(order.filled_quantity);
      const orderPrice = parseFloat(order.price);

      if (order.side === 'BUY') {
        stats.totalBuy += remaining;

        // Fillability check using metadata threshold
        const prices = this.marketData?.getPrices(order.outcome);
        const isFillable = !prices || orderPrice >= prices.bestAsk * threshold;

        if (isFillable) {
          const assetStats = stats.perAsset.get(order.outcome) || { qty: 0, value: 0 };
          assetStats.qty += remaining;
          assetStats.value += remaining * orderPrice;
          stats.perAsset.set(order.outcome, assetStats);
        }
      } else {
        stats.totalSell += remaining;
      }
    }

    return stats;
  }

  private calculateAvgPrice(stats: { qty: number; value: number } | undefined): number {
    if (!stats || stats.qty === 0) return 0;
    return stats.value / stats.qty;
  }

  /**
   * Set the trade executor function
   */
  setTradeExecutor(executor: (bot: Bot, signal: StrategySignal) => Promise<Trade | null>): void {
    this.tradeExecutor = executor;
  }

  // ============================================================================
  // Position Management
  // ============================================================================

  /**
   * Update position after a trade
   */
  private updatePositionFromTrade(trade: Trade): void {
    const currentSize = parseFloat(this.position.size);
    const currentAvg = parseFloat(this.position.avgEntryPrice);
    const tradeQty = parseFloat(trade.quantity);
    const tradePrice = parseFloat(trade.price);

    // Use centralized position calculator
    const update = calculatePositionUpdate(
      currentSize,
      currentAvg,
      tradeQty,
      tradePrice,
      trade.side
    );

    const newPnl = parseFloat(this.position.realizedPnl) + update.realizedPnl;

    this.position.size = update.newSize.toString();
    this.position.avgEntryPrice = update.newAvgPrice.toFixed(6);
    this.position.realizedPnl = newPnl.toFixed(6);

    // Persist to database
    const assetId = trade.assetId || this.config.assetId || '';
    getOrCreatePosition(this.id, this.config.marketId, assetId, trade.outcome);
    updatePosition(this.id, assetId, {
      size: update.newSize.toFixed(6),
      avgEntryPrice: update.newAvgPrice.toFixed(6),
      realizedPnl: newPnl.toFixed(6),
    });

    // Update metrics
    this.metrics.totalTrades++;
    if (trade.side === 'SELL' && parseFloat(trade.pnl) > 0) {
      this.metrics.winningTrades++;
    } else if (trade.side === 'SELL' && parseFloat(trade.pnl) < 0) {
      this.metrics.losingTrades++;
    }
    this.metrics.totalPnl = this.position.realizedPnl;
    this.updatedAt = new Date();
  }

  /**
   * Set position directly (for loading from database)
   */
  setPosition(position: Position): void {
    this.position = position;
  }

  /**
   * Set metrics directly (for loading from database)
   */
  setMetrics(metrics: BotMetrics): void {
    this.metrics = metrics;
  }

  /**
   * Update current price (backward compatibility)
   */
  updatePrice(yes: string, no: string): void {
    // No-op - prices now managed by MarketDataManager
  }

  // ============================================================================
  // Order Management
  // ============================================================================

  /**
   * Get active limit orders for this bot
   */
  getActiveOrders(): LimitOrder[] {
    const orderRows = getOpenOrdersByBotId(this.id);
    return orderRows.map(rowToLimitOrder);
  }

  /**
   * Handle an order fill
   */
  handleOrderFilled(fill: FillResult): void {
    // Use metadata to determine position handling
    if (this.executorMetadata?.positionHandler === 'multi') {
      // Multi-asset: DB is source of truth, only update metrics
      this.metrics.totalTrades++;
      this.updatedAt = new Date();
      console.log(
        `[Bot ${this.id}] Multi-asset fill: ${fill.side} ${fill.outcome} ${parseFloat(fill.filledQuantity).toFixed(4)} @ ${fill.fillPrice}`
      );
    } else {
      // Single-asset: update in-memory position
      this.updateSinglePositionFromFill(fill);
    }

    this.emitEvent({ type: 'ORDER_FILLED', fill, timestamp: new Date() });
  }

  private updateSinglePositionFromFill(fill: FillResult): void {
    const fillQty = parseFloat(fill.filledQuantity);
    const fillPrice = parseFloat(fill.fillPrice);
    const currentSize = parseFloat(this.position.size);

    if (fill.side === 'BUY') {
      const newSize = currentSize + fillQty;
      const currentAvg = parseFloat(this.position.avgEntryPrice);
      const newAvg = currentSize === 0
        ? fillPrice
        : (currentAvg * currentSize + fillPrice * fillQty) / newSize;

      this.position.size = newSize.toString();
      this.position.avgEntryPrice = newAvg.toFixed(6);
      this.position.outcome = fill.outcome;

      console.log(
        `[Bot ${this.id}] Position updated (BUY fill): size=${newSize.toFixed(4)}, avgPrice=${newAvg.toFixed(4)}`
      );
    } else {
      const newSize = currentSize - fillQty;
      const avgEntry = parseFloat(this.position.avgEntryPrice);
      const pnl = (fillPrice - avgEntry) * fillQty;
      const currentPnl = parseFloat(this.position.realizedPnl);

      this.position.size = Math.max(0, newSize).toString();
      this.position.realizedPnl = (currentPnl + pnl).toFixed(6);

      if (newSize <= 0) {
        this.position.avgEntryPrice = '0';
      }

      console.log(
        `[Bot ${this.id}] Position updated (SELL fill): size=${Math.max(0, newSize).toFixed(4)}, pnl=${pnl.toFixed(4)}`
      );

      if (pnl > 0) {
        this.metrics.winningTrades++;
      } else if (pnl < 0) {
        this.metrics.losingTrades++;
      }
    }

    this.metrics.totalTrades++;
    this.metrics.totalPnl = this.position.realizedPnl;
    this.updatedAt = new Date();
  }

  // ============================================================================
  // Market Data Access (for DryRunExecutor compatibility)
  // ============================================================================

  /**
   * Get market data manager
   */
  getMarketData(): MarketDataManager | null {
    return this.marketData;
  }

  /**
   * Get order book (backward compatibility)
   */
  getOrderBook(): OrderBook | null {
    return this.marketData?.getOrderBook('YES') || null;
  }

  /**
   * Get NO order book (backward compatibility)
   */
  getNoOrderBook(): OrderBook | null {
    return this.marketData?.getOrderBook('NO') || null;
  }

  // ============================================================================
  // Events
  // ============================================================================

  onEvent(handler: BotEventHandler): void {
    this.eventHandlers.push(handler);
  }

  offEvent(handler: BotEventHandler): void {
    this.eventHandlers = this.eventHandlers.filter(h => h !== handler);
  }

  private emitEvent(event: BotEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error(`[Bot ${this.id}] Event handler error:`, error);
      }
    }
  }

  // ============================================================================
  // Serialization
  // ============================================================================

  toInstance(): BotInstance {
    const positionRows = getPositionsByBotId(this.id);
    const positions = positionRows.map(row => ({
      marketId: row.market_id,
      assetId: row.asset_id,
      outcome: row.outcome as 'YES' | 'NO',
      size: row.size,
      avgEntryPrice: row.avg_entry_price,
      realizedPnl: row.realized_pnl,
    }));

    const totalPositionSize = positions.reduce(
      (sum, pos) => sum + parseFloat(pos.size),
      0
    );

    return {
      config: { ...this.config },
      state: this.state,
      position: { ...this.position },
      metrics: { ...this.metrics },
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      totalPositionSize,
      positions,
    };
  }

  getConfig(): BotConfig {
    return { ...this.config };
  }

  getPosition(): Position {
    return { ...this.position };
  }

  getMetrics(): BotMetrics {
    return { ...this.metrics };
  }

  restoreTimestamps(data: {
    createdAt: Date;
    updatedAt: Date;
    startedAt?: Date;
    stoppedAt?: Date;
  }): void {
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
    this.startedAt = data.startedAt;
    this.stoppedAt = data.stoppedAt;
  }

  setState(state: BotState): void {
    this.state = state;
  }

  // ============================================================================
  // Market Status Monitoring
  // ============================================================================

  private async checkMarketStatus(): Promise<boolean> {
    const now = Date.now();

    if (now - this.lastMarketCheck < this.MARKET_CHECK_INTERVAL_MS) {
      return true;
    }

    this.lastMarketCheck = now;

    const assetId = this.config.assetId;
    if (!assetId) return true;

    try {
      const CLOB_HOST = process.env.POLYMARKET_CLOB_HOST || 'https://clob.polymarket.com';
      const response = await fetch(`${CLOB_HOST}/book?token_id=${encodeURIComponent(assetId)}`);

      if (!response.ok) {
        const text = await response.text();
        if (text.includes('No orderbook exists') || text.includes('market not found')) {
          console.log(`[Bot ${this.id}] Market closed - order book no longer exists`);
          return false;
        }
        return true;
      }

      const data = await response.json();
      if (data.error && (data.error.includes('No orderbook') || data.error.includes('not found'))) {
        console.log(`[Bot ${this.id}] Market closed - order book no longer exists`);
        return false;
      }

      return true;
    } catch (error) {
      console.warn(`[Bot ${this.id}] Error checking market status:`, error);
      return true;
    }
  }

  private async handleMarketClosed(): Promise<void> {
    console.log(`[Bot ${this.id}] Market closed - settling positions`);

    // 1. Cancel all pending orders first
    const cancelledCount = cancelAllBotOrders(this.id);
    if (cancelledCount > 0) {
      console.log(`[Bot ${this.id}] Cancelled ${cancelledCount} pending orders due to market closure`);
    }

    // 2. Detect winning outcome from last trade prices
    const lastTrades = this.marketData?.getAllLastTrades() || new Map();
    const resolution = detectResolution(lastTrades);

    if (resolution.winningOutcome !== 'UNKNOWN') {
      // 3. Settle all positions at resolution prices
      const settlements = settleAllPositions(this.id, resolution);
      const totalPnl = settlements.reduce((sum, s) => sum + s.realizedPnl, 0);

      // 4. Build resolution event data
      const marketResolution: MarketResolution = {
        winningOutcome: resolution.winningOutcome,
        yesResolutionPrice: resolution.yesResolutionPrice,
        noResolutionPrice: resolution.noResolutionPrice,
        settlements: settlements.map(s => ({
          outcome: s.outcome,
          size: s.originalSize,
          entryPrice: s.avgEntryPrice,
          settlementPrice: s.settlementPrice,
          pnl: s.realizedPnl,
        })),
        totalRealizedPnl: totalPnl,
      };

      // 5. Emit resolution event
      this.emitEvent({
        type: 'MARKET_RESOLVED',
        resolution: marketResolution,
        timestamp: new Date(),
      });

      console.log(
        `[Bot ${this.id}] Market resolved - ${resolution.winningOutcome} won | ` +
        `Settlements: ${settlements.length} | Total PnL: ${totalPnl.toFixed(4)}`
      );
    } else {
      // Could not determine resolution - emit error
      this.emitEvent({
        type: 'ERROR',
        error: 'Market closed - could not determine resolution. Positions remain unsettled.',
        timestamp: new Date(),
      });
      console.warn(`[Bot ${this.id}] Could not determine market resolution from last trade prices`);
    }

    // 6. Stop the bot
    await this.stop();

    updateBotState(this.id, 'stopped', {
      stoppedAt: new Date().toISOString(),
    });
  }
}
