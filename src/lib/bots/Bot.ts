/**
 * Bot Class
 *
 * Represents a trading bot instance with state machine lifecycle management.
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
} from './types';
import type { OrderBook, LastTrade, TickSize } from '../polymarket/types';
import { getExecutor } from '../strategies/registry';
import { getWebSocket } from '../polymarket/websocket';
import { processTradeForBotFills } from './LimitOrderMatcher';
import {
  getOpenOrdersByBotId,
  cancelAllBotOrders,
  rowToLimitOrder,
} from '../persistence/LimitOrderRepository';

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

  private intervalId?: NodeJS.Timeout;
  private eventHandlers: BotEventHandler[] = [];
  private currentPrice: { yes: string; no: string } = { yes: '0.5', no: '0.5' };
  private currentOrderBook: OrderBook | null = null;
  private currentLastTrade: LastTrade | null = null;
  private currentTickSize: TickSize | null = null;

  // Executor for trade execution (set by BotManager)
  private tradeExecutor?: (bot: Bot, signal: StrategySignal) => Promise<Trade | null>;

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
    this.state = 'running';
    this.startedAt = new Date();
    this.updatedAt = new Date();

    // Fetch initial price from API before starting
    await this.fetchInitialPrice();

    // Subscribe to order book updates if we have an asset ID
    if (this.config.assetId) {
      const ws = getWebSocket();
      if (!ws.isConnected()) {
        try {
          await ws.connect();
        } catch (error) {
          console.error(`[Bot ${this.id}] Failed to connect WebSocket:`, error);
        }
      }

      // Subscribe to order book for real-time updates
      ws.subscribeOrderBook([this.config.assetId], (orderBook) => {
        if (this.state !== 'running') return;

        this.currentOrderBook = orderBook;
        this.updatePricesFromOrderBook(orderBook);

        // Trigger execution on order book update
        this.executeCycle().catch(err => {
          console.error(`[Bot ${this.id}] Execution cycle error:`, err);
          this.emitEvent({ type: 'ERROR', error: err.message, timestamp: new Date() });
        });
      });

      // Subscribe to price changes for real-time price updates (more frequent than order book)
      ws.subscribePrice([this.config.assetId], (_assetId, _price, bestBid, bestAsk) => {
        if (this.state !== 'running') return;

        if (bestBid && bestAsk) {
          const bid = parseFloat(bestBid);
          const ask = parseFloat(bestAsk);
          const midPrice = (bid + ask) / 2;
          this.currentPrice.yes = midPrice.toFixed(4);
          this.currentPrice.no = (1 - midPrice).toFixed(4);
          console.log(`[Bot ${this.id}] Price update: YES=${this.currentPrice.yes} (bid=${bestBid}, ask=${bestAsk})`);
        }
      });

      // Subscribe to last trade updates
      ws.subscribeTrades([this.config.assetId], (trade) => {
        if (this.state !== 'running') return;
        this.currentLastTrade = trade;
        console.log(`[Bot ${this.id}] Last trade: ${trade.side} ${trade.size} @ ${trade.price}`);

        // Process trade for potential order fills (dry-run mode)
        if (this.config.mode === 'dry_run') {
          const fills = processTradeForBotFills(this.id, trade);
          for (const fill of fills) {
            this.handleOrderFilled(fill);
          }
        }
      });

      // Subscribe to tick size updates
      ws.subscribeTickSize([this.config.assetId], (tickSize) => {
        if (this.state !== 'running') return;
        this.currentTickSize = tickSize;
        console.log(`[Bot ${this.id}] Tick size updated: ${tickSize.tick_size}`);
      });
    }

    // Fallback interval for cases where WebSocket updates are slow/missing
    const fallbackInterval = 30000; // 30 seconds
    this.intervalId = setInterval(() => {
      if (this.state === 'running') {
        this.executeCycle().catch(err => {
          console.error(`[Bot ${this.id}] Fallback execution cycle error:`, err);
          this.emitEvent({ type: 'ERROR', error: err.message, timestamp: new Date() });
        });
      }
    }, fallbackInterval);

    this.emitEvent({ type: 'STARTED', timestamp: new Date() });
    console.log(`[Bot ${this.id}] Started with real-time order book updates, initial price: YES=${this.currentPrice.yes}`);
  }

  /**
   * Fetch initial price from order book API
   */
  private async fetchInitialPrice(): Promise<void> {
    const assetId = this.config.assetId;
    if (!assetId) {
      console.warn(`[Bot ${this.id}] No assetId configured, using default price 0.5`);
      return;
    }

    try {
      // Fetch directly from CLOB API to avoid port mismatch issues
      const CLOB_HOST = process.env.POLYMARKET_CLOB_HOST || 'https://clob.polymarket.com';
      const response = await fetch(`${CLOB_HOST}/book?token_id=${encodeURIComponent(assetId)}`);
      const orderBook = await response.json();

      if (orderBook) {
        // Get best bid/ask from order book (CLOB API returns bids/asks directly)
        const bids = orderBook.bids || [];
        const asks = orderBook.asks || [];

        // Infer tick size from order book prices
        if (!this.currentTickSize && (bids.length > 0 || asks.length > 0)) {
          const samplePrice = bids[0]?.price || asks[0]?.price;
          if (samplePrice) {
            const inferredTick = this.inferTickSize(samplePrice);
            this.currentTickSize = {
              asset_id: this.config.assetId || '',
              tick_size: inferredTick,
              timestamp: new Date().toISOString(),
            };
            console.log(`[Bot ${this.id}] Inferred tick size: ${inferredTick} from price ${samplePrice}`);
          }
        }

        if (bids.length > 0 && asks.length > 0) {
          // Sort to get best prices
          const sortedBids = [...bids].sort(
            (a: { price: string }, b: { price: string }) =>
              parseFloat(b.price) - parseFloat(a.price)
          );
          const sortedAsks = [...asks].sort(
            (a: { price: string }, b: { price: string }) =>
              parseFloat(a.price) - parseFloat(b.price)
          );

          const bestBid = parseFloat(sortedBids[0].price);
          const bestAsk = parseFloat(sortedAsks[0].price);
          const midPrice = (bestBid + bestAsk) / 2;

          this.currentPrice.yes = midPrice.toFixed(4);
          this.currentPrice.no = (1 - midPrice).toFixed(4);

          console.log(`[Bot ${this.id}] Fetched initial price from order book: YES=${this.currentPrice.yes}, bid=${bestBid}, ask=${bestAsk}`);
        } else if (bids.length > 0) {
          const bestBid = parseFloat(bids[0].price);
          this.currentPrice.yes = bestBid.toFixed(4);
          this.currentPrice.no = (1 - bestBid).toFixed(4);
          console.log(`[Bot ${this.id}] Fetched initial price from best bid: YES=${this.currentPrice.yes}`);
        } else if (asks.length > 0) {
          const bestAsk = parseFloat(asks[0].price);
          this.currentPrice.yes = bestAsk.toFixed(4);
          this.currentPrice.no = (1 - bestAsk).toFixed(4);
          console.log(`[Bot ${this.id}] Fetched initial price from best ask: YES=${this.currentPrice.yes}`);
        }
      }
    } catch (error) {
      console.error(`[Bot ${this.id}] Failed to fetch initial price:`, error);
      // Continue with default price
    }
  }

  /**
   * Infer tick size from price string (e.g., "0.01" -> 0.01, "0.001" -> 0.001)
   */
  private inferTickSize(price: string): string {
    const parts = price.split('.');
    if (parts.length < 2) return '1';
    const decimals = parts[1].length;
    return (1 / Math.pow(10, decimals)).toString();
  }

  /**
   * Update prices from order book data
   */
  private updatePricesFromOrderBook(orderBook: OrderBook): void {
    const bids = orderBook.bids || [];
    const asks = orderBook.asks || [];

    // Infer tick size from order book prices if not already set
    if (!this.currentTickSize && (bids.length > 0 || asks.length > 0)) {
      const samplePrice = bids[0]?.price || asks[0]?.price;
      if (samplePrice) {
        const inferredTick = this.inferTickSize(samplePrice);
        this.currentTickSize = {
          asset_id: this.config.assetId || '',
          tick_size: inferredTick,
          timestamp: new Date().toISOString(),
        };
        console.log(`[Bot ${this.id}] Inferred tick size: ${inferredTick} from price ${samplePrice}`);
      }
    }

    if (bids.length > 0 && asks.length > 0) {
      const bestBid = parseFloat(bids[0].price);
      const bestAsk = parseFloat(asks[0].price);
      const midPrice = (bestBid + bestAsk) / 2;

      this.currentPrice.yes = midPrice.toFixed(4);
      this.currentPrice.no = (1 - midPrice).toFixed(4);
    } else if (bids.length > 0) {
      const bestBid = parseFloat(bids[0].price);
      this.currentPrice.yes = bestBid.toFixed(4);
      this.currentPrice.no = (1 - bestBid).toFixed(4);
    } else if (asks.length > 0) {
      const bestAsk = parseFloat(asks[0].price);
      this.currentPrice.yes = bestAsk.toFixed(4);
      this.currentPrice.no = (1 - bestAsk).toFixed(4);
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

    // Unsubscribe from price updates
    if (this.config.assetId) {
      const ws = getWebSocket();
      ws.unsubscribe([this.config.assetId]);
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

    const interval = (this.config.strategyConfig?.interval as number) || 5000;

    this.intervalId = setInterval(() => {
      this.executeCycle().catch(err => {
        console.error(`[Bot ${this.id}] Execution cycle error:`, err);
        this.emitEvent({ type: 'ERROR', error: err.message, timestamp: new Date() });
      });
    }, interval);

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
    if (this.state !== 'running') {
      return;
    }

    // Refresh price before each cycle to ensure we have the latest
    await this.refreshPrice();

    const executor = getExecutor(this.config.strategySlug);
    if (!executor) {
      console.error(`[Bot ${this.id}] No executor found for strategy: ${this.config.strategySlug}`);
      return;
    }

    // Build context
    const context: StrategyContext = {
      bot: this.toInstance(),
      currentPrice: this.currentPrice,
      position: this.position,
      orderBook: this.currentOrderBook || undefined,
      lastTrade: this.currentLastTrade || undefined,
      tickSize: this.currentTickSize || undefined,
    };

    // Execute strategy
    const signal = await executor.execute(context);

    if (signal && signal.action !== 'HOLD') {
      console.log(`[Bot ${this.id}] Signal: ${signal.action} ${signal.quantity} ${signal.side} @ ${signal.price} (current price: YES=${this.currentPrice.yes})`);

      // Execute trade if executor is set
      if (this.tradeExecutor) {
        const trade = await this.tradeExecutor(this, signal);
        if (trade) {
          // Only update position immediately for filled trades (live mode)
          // For pending trades (dry-run mode), position is updated when order fills via handleOrderFilled
          if (trade.status === 'filled') {
            this.updatePositionFromTrade(trade);
          }
          this.emitEvent({ type: 'TRADE_EXECUTED', trade });
        }
      }
    }
  }

  /**
   * Refresh current price from order book
   */
  private async refreshPrice(): Promise<void> {
    const assetId = this.config.assetId;
    if (!assetId) return;

    try {
      // Fetch directly from CLOB API to avoid port mismatch issues
      const CLOB_HOST = process.env.POLYMARKET_CLOB_HOST || 'https://clob.polymarket.com';
      const response = await fetch(`${CLOB_HOST}/book?token_id=${encodeURIComponent(assetId)}`);
      const orderBook = await response.json();

      if (orderBook) {
        const bids = orderBook.bids || [];
        const asks = orderBook.asks || [];

        if (bids.length > 0 && asks.length > 0) {
          const sortedBids = [...bids].sort(
            (a: { price: string }, b: { price: string }) =>
              parseFloat(b.price) - parseFloat(a.price)
          );
          const sortedAsks = [...asks].sort(
            (a: { price: string }, b: { price: string }) =>
              parseFloat(a.price) - parseFloat(b.price)
          );

          const bestBid = parseFloat(sortedBids[0].price);
          const bestAsk = parseFloat(sortedAsks[0].price);
          const midPrice = (bestBid + bestAsk) / 2;

          this.currentPrice.yes = midPrice.toFixed(4);
          this.currentPrice.no = (1 - midPrice).toFixed(4);
        }
      }
    } catch (error) {
      // Silently continue with previous price
    }
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
    const tradeQty = parseFloat(trade.quantity);
    const tradePrice = parseFloat(trade.price);

    if (trade.side === 'BUY') {
      // Buying increases position
      const newSize = currentSize + tradeQty;
      const currentAvg = parseFloat(this.position.avgEntryPrice);
      const newAvg = currentSize === 0
        ? tradePrice
        : (currentAvg * currentSize + tradePrice * tradeQty) / newSize;

      this.position.size = newSize.toString();
      this.position.avgEntryPrice = newAvg.toFixed(6);
    } else {
      // Selling decreases position
      const newSize = currentSize - tradeQty;

      // Calculate realized PnL
      const avgEntry = parseFloat(this.position.avgEntryPrice);
      const pnl = (tradePrice - avgEntry) * tradeQty;
      const currentPnl = parseFloat(this.position.realizedPnl);

      this.position.size = Math.max(0, newSize).toString();
      this.position.realizedPnl = (currentPnl + pnl).toFixed(6);

      // Reset avg entry price if position closed
      if (newSize <= 0) {
        this.position.avgEntryPrice = '0';
      }
    }

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
   * Update current price
   */
  updatePrice(yes: string, no: string): void {
    this.currentPrice = { yes, no };
  }

  // ============================================================================
  // Order Management
  // ============================================================================

  /**
   * Get active (open/partially filled) limit orders for this bot
   */
  getActiveOrders(): LimitOrder[] {
    const orderRows = getOpenOrdersByBotId(this.id);
    return orderRows.map(rowToLimitOrder);
  }

  /**
   * Handle an order fill
   * Updates position based on the filled order
   */
  handleOrderFilled(fill: FillResult): void {
    const orders = getOpenOrdersByBotId(this.id);
    const orderRow = orders.find(o => o.id === fill.orderId);

    if (!orderRow) {
      console.warn(`[Bot ${this.id}] Order ${fill.orderId} not found for fill`);
      return;
    }

    const fillQty = parseFloat(fill.filledQuantity);
    const fillPrice = parseFloat(fill.fillPrice);
    const currentSize = parseFloat(this.position.size);

    if (orderRow.side === 'BUY') {
      // Buying increases position
      const newSize = currentSize + fillQty;
      const currentAvg = parseFloat(this.position.avgEntryPrice);
      const newAvg = currentSize === 0
        ? fillPrice
        : (currentAvg * currentSize + fillPrice * fillQty) / newSize;

      this.position.size = newSize.toString();
      this.position.avgEntryPrice = newAvg.toFixed(6);
      this.position.outcome = orderRow.outcome;

      console.log(
        `[Bot ${this.id}] Position updated (BUY fill): size=${newSize.toFixed(4)}, avgPrice=${newAvg.toFixed(4)}`
      );
    } else {
      // Selling decreases position
      const newSize = currentSize - fillQty;

      // Calculate realized PnL
      const avgEntry = parseFloat(this.position.avgEntryPrice);
      const pnl = (fillPrice - avgEntry) * fillQty;
      const currentPnl = parseFloat(this.position.realizedPnl);

      this.position.size = Math.max(0, newSize).toString();
      this.position.realizedPnl = (currentPnl + pnl).toFixed(6);

      // Reset avg entry price if position closed
      if (newSize <= 0) {
        this.position.avgEntryPrice = '0';
      }

      console.log(
        `[Bot ${this.id}] Position updated (SELL fill): size=${Math.max(0, newSize).toFixed(4)}, pnl=${pnl.toFixed(4)}`
      );

      // Update metrics
      if (pnl > 0) {
        this.metrics.winningTrades++;
      } else if (pnl < 0) {
        this.metrics.losingTrades++;
      }
    }

    // Update metrics
    if (fill.isFullyFilled) {
      this.metrics.totalTrades++;
    }
    this.metrics.totalPnl = this.position.realizedPnl;
    this.updatedAt = new Date();

    // Emit event so BotManager can persist the updated position
    this.emitEvent({ type: 'ORDER_FILLED', fill, timestamp: new Date() });
  }

  // ============================================================================
  // Events
  // ============================================================================

  /**
   * Add event handler
   */
  onEvent(handler: BotEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Remove event handler
   */
  offEvent(handler: BotEventHandler): void {
    this.eventHandlers = this.eventHandlers.filter(h => h !== handler);
  }

  /**
   * Emit an event to all handlers
   */
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

  /**
   * Convert to BotInstance
   */
  toInstance(): BotInstance {
    return {
      config: { ...this.config },
      state: this.state,
      position: { ...this.position },
      metrics: { ...this.metrics },
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
    };
  }

  /**
   * Get config for persistence
   */
  getConfig(): BotConfig {
    return { ...this.config };
  }

  /**
   * Get position for persistence
   */
  getPosition(): Position {
    return { ...this.position };
  }

  /**
   * Get metrics for persistence
   */
  getMetrics(): BotMetrics {
    return { ...this.metrics };
  }

  /**
   * Restore timestamps from database
   */
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

  /**
   * Set state directly (for loading from database)
   */
  setState(state: BotState): void {
    this.state = state;
  }
}
