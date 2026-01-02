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
  private currentPrice: { yes: string; no: string } = { yes: '0.5', no: '0.5' };
  private currentOrderBook: OrderBook | null = null;
  private currentLastTrade: LastTrade | null = null;
  private currentTickSize: TickSize | null = null;

  // Arbitrage-specific fields (dual-asset tracking)
  private noOrderBook: OrderBook | null = null;

  // Executor for trade execution (set by BotManager)
  private tradeExecutor?: (bot: Bot, signal: StrategySignal) => Promise<Trade | null>;

  // Market status tracking (auto-stop when market closes)
  private lastMarketCheck: number = 0;
  private readonly MARKET_CHECK_INTERVAL_MS = 60000; // Check every 60 seconds

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

  get isArbitrageStrategy(): boolean {
    return this.config.strategySlug === 'arbitrage';
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

    // Fetch market end time for time-based position scaling
    await this.fetchMarketEndTime();

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

          // Update the current order book with latest best bid/ask for accurate marketable detection
          // This ensures new orders are checked against the most recent prices
          if (!this.currentOrderBook) {
            // Create a minimal order book if none exists
            this.currentOrderBook = {
              market: '',
              asset_id: this.config.assetId || '',
              bids: [{ price: bestBid, size: '1000000' }],
              asks: [{ price: bestAsk, size: '1000000' }],
              timestamp: new Date().toISOString(),
            };
          } else {
            // Update best bid/ask in existing order book
            // Remove old best and add new best at the front
            const existingBids = (this.currentOrderBook.bids || []).filter(b => parseFloat(b.price) < bid);
            const existingAsks = (this.currentOrderBook.asks || []).filter(a => parseFloat(a.price) > ask);
            this.currentOrderBook = {
              ...this.currentOrderBook,
              bids: [{ price: bestBid, size: '1000000' }, ...existingBids],
              asks: [{ price: bestAsk, size: '1000000' }, ...existingAsks],
            };
          }

          // Check for marketable orders on price changes (pass both order books for arbitrage)
          const marketableFills = fillMarketableOrders(this.id, this.currentOrderBook, this.noOrderBook);
          for (const fill of marketableFills) {
            this.handleOrderFilled(fill);
          }
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

    // Subscribe to NO asset order book for arbitrage strategies
    console.log(`[Bot ${this.id}] Arbitrage check: isArbitrage=${this.isArbitrageStrategy}, noAssetId=${this.config.noAssetId || 'NOT SET'}`);
    if (this.isArbitrageStrategy && this.config.noAssetId) {
      const ws = getWebSocket();
      const noAssetId = this.config.noAssetId;

      // Fetch initial NO order book
      await this.fetchNoOrderBook();

      // Subscribe to NO asset order book updates
      ws.subscribeOrderBook([noAssetId], (orderBook) => {
        if (this.state !== 'running') return;
        this.noOrderBook = orderBook;
        console.log(`[Bot ${this.id}] NO order book updated: ${orderBook.bids?.length || 0} bids, ${orderBook.asks?.length || 0} asks`);

        // Check for marketable orders on NO order book changes
        const marketableFills = fillMarketableOrders(this.id, this.currentOrderBook, this.noOrderBook);
        for (const fill of marketableFills) {
          this.handleOrderFilled(fill);
        }
      });

      // Subscribe to NO asset price changes
      ws.subscribePrice([noAssetId], (_assetId, _price, bestBid, bestAsk) => {
        if (this.state !== 'running') return;

        if (bestBid && bestAsk) {
          // Update NO order book with latest prices
          if (!this.noOrderBook) {
            this.noOrderBook = {
              market: '',
              asset_id: noAssetId,
              bids: [{ price: bestBid, size: '1000000' }],
              asks: [{ price: bestAsk, size: '1000000' }],
              timestamp: new Date().toISOString(),
            };
          } else {
            const bid = parseFloat(bestBid);
            const ask = parseFloat(bestAsk);
            const existingBids = (this.noOrderBook.bids || []).filter(b => parseFloat(b.price) < bid);
            const existingAsks = (this.noOrderBook.asks || []).filter(a => parseFloat(a.price) > ask);
            this.noOrderBook = {
              ...this.noOrderBook,
              bids: [{ price: bestBid, size: '1000000' }, ...existingBids],
              asks: [{ price: bestAsk, size: '1000000' }, ...existingAsks],
            };
          }
          console.log(`[Bot ${this.id}] NO price update: bid=${bestBid}, ask=${bestAsk}`);

          // Check for marketable orders on NO price changes
          const marketableFills = fillMarketableOrders(this.id, this.currentOrderBook, this.noOrderBook);
          for (const fill of marketableFills) {
            this.handleOrderFilled(fill);
          }
        }
      });

      console.log(`[Bot ${this.id}] Subscribed to NO asset: ${noAssetId}`);
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
   * Fetch market end time from Gamma API for time-based position scaling
   */
  private async fetchMarketEndTime(): Promise<void> {
    const marketId = this.config.marketId;
    if (!marketId) {
      console.warn(`[Bot ${this.id.slice(0, 8)}] No marketId configured, time-based scaling disabled`);
      return;
    }

    try {
      const GAMMA_HOST = process.env.POLYMARKET_GAMMA_HOST || 'https://gamma-api.polymarket.com';
      const response = await fetch(`${GAMMA_HOST}/markets/${encodeURIComponent(marketId)}`);

      if (response.ok) {
        const market = await response.json();
        if (market.endDateIso) {
          this.marketEndTime = new Date(market.endDateIso);
          console.log(`[Bot ${this.id.slice(0, 8)}] Market ends at: ${this.marketEndTime.toISOString()}`);
        } else {
          console.log(`[Bot ${this.id.slice(0, 8)}] Market has no end date, time-based scaling disabled`);
        }
      } else {
        console.warn(`[Bot ${this.id.slice(0, 8)}] Failed to fetch market data: ${response.status}`);
      }
    } catch (error) {
      console.warn(`[Bot ${this.id.slice(0, 8)}] Failed to fetch market end time:`, error);
      // Continue without time-based scaling
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
   * Fetch initial NO order book for arbitrage strategies
   */
  private async fetchNoOrderBook(): Promise<void> {
    const noAssetId = this.config.noAssetId;
    if (!noAssetId) return;

    try {
      const CLOB_HOST = process.env.POLYMARKET_CLOB_HOST || 'https://clob.polymarket.com';
      const response = await fetch(`${CLOB_HOST}/book?token_id=${encodeURIComponent(noAssetId)}`);
      const orderBook = await response.json();

      if (orderBook) {
        this.noOrderBook = {
          market: '',
          asset_id: noAssetId,
          bids: orderBook.bids || [],
          asks: orderBook.asks || [],
          timestamp: new Date().toISOString(),
        };
        console.log(`[Bot ${this.id}] Fetched initial NO order book: ${this.noOrderBook.bids.length} bids, ${this.noOrderBook.asks.length} asks`);
      }
    } catch (error) {
      console.error(`[Bot ${this.id}] Failed to fetch NO order book:`, error);
    }
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

    // Unsubscribe from NO asset (arbitrage strategies)
    if (this.config.noAssetId) {
      const ws = getWebSocket();
      ws.unsubscribe([this.config.noAssetId]);
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

    // Check if market is still open (periodic check, not every cycle)
    const marketOpen = await this.checkMarketStatus();
    if (!marketOpen) {
      await this.handleMarketClosed();
      return;
    }

    // Refresh price before each cycle to ensure we have the latest
    await this.refreshPrice();

    const executor = getExecutor(this.config.strategySlug);
    if (!executor) {
      console.error(`[Bot ${this.id}] No executor found for strategy: ${this.config.strategySlug}`);
      return;
    }

    // Cancel stale orders for market maker strategy (use defaults if not configured)
    const strategyConfig = this.config.strategyConfig || {};
    const isMarketMaker = this.config.strategySlug === 'market-maker';

    // Use configured values or defaults for market maker
    const maxOrderAge = strategyConfig.maxOrderAge as number | undefined
      ?? (isMarketMaker ? 60 : undefined);  // Default: 60 seconds for market maker
    const maxPriceDistance = strategyConfig.maxPriceDistance as number | undefined
      ?? (isMarketMaker ? 0.05 : undefined);  // Default: 5% for market maker

    if (maxOrderAge !== undefined || maxPriceDistance !== undefined) {
      // Use the correct price based on the outcome being traded
      const outcome = (strategyConfig.outcome as 'YES' | 'NO') || 'YES';
      const currentMidPrice = outcome === 'YES'
        ? parseFloat(this.currentPrice.yes)
        : parseFloat(this.currentPrice.no);

      if (currentMidPrice > 0 && currentMidPrice < 1) {  // Valid price range
        const cancelledIds = cancelStaleOrders(
          this.id,
          currentMidPrice,
          maxOrderAge,
          maxPriceDistance
        );
        if (cancelledIds.length > 0) {
          console.log(`[Bot ${this.id}] Cancelled ${cancelledIds.length} stale orders (mid=${currentMidPrice.toFixed(4)})`);
        }
      }
    }

    // Cancel stale orders for arbitrage strategy (per-leg price distance check)
    // This catches phantom orders that are too far from market to ever fill
    const isArbitrage = this.config.strategySlug === 'arbitrage';
    if (isArbitrage) {
      const yesPrices = this.getYesPrices();
      const noPrices = this.getNoPrices();

      // Calculate mid prices for each leg
      const yesMidPrice = yesPrices
        ? (yesPrices.bestBid + yesPrices.bestAsk) / 2
        : 0;
      const noMidPrice = noPrices
        ? (noPrices.bestBid + noPrices.bestAsk) / 2
        : 0;

      const STALE_PRICE_DISTANCE = 0.20; // 20% from mid = phantom order

      // Cancel YES orders too far from YES mid price
      if (yesMidPrice > 0 && yesMidPrice < 1) {
        const yesCancelled = cancelStaleOrdersForOutcome(
          this.id,
          'YES',
          yesMidPrice,
          undefined,  // No age limit
          STALE_PRICE_DISTANCE
        );
        if (yesCancelled.length > 0) {
          console.log(`[Bot ${this.id}] Cancelled ${yesCancelled.length} stale YES orders (mid=${yesMidPrice.toFixed(4)})`);
        }
      }

      // Cancel NO orders too far from NO mid price
      if (noMidPrice > 0 && noMidPrice < 1) {
        const noCancelled = cancelStaleOrdersForOutcome(
          this.id,
          'NO',
          noMidPrice,
          undefined,  // No age limit
          STALE_PRICE_DISTANCE
        );
        if (noCancelled.length > 0) {
          console.log(`[Bot ${this.id}] Cancelled ${noCancelled.length} stale NO orders (mid=${noMidPrice.toFixed(4)})`);
        }
      }
    }

    // Check and fill any pending orders that are now marketable against the order book(s)
    if (this.currentOrderBook || this.noOrderBook) {
      const marketableFills = fillMarketableOrders(this.id, this.currentOrderBook, this.noOrderBook);
      for (const fill of marketableFills) {
        this.handleOrderFilled(fill);
      }
    }

    // Calculate pending order quantities (total and per-asset for arbitrage)
    // For arbitrage, only count orders that are "fillable" (within 20% of market ask)
    // This prevents phantom orders from inflating position limits
    const openOrders = getOpenOrdersByBotId(this.id);
    let pendingBuyQuantity = 0;
    let pendingSellQuantity = 0;
    let yesPendingBuy = 0;
    let noPendingBuy = 0;
    let yesPendingBuyValue = 0;  // sum of (qty * price) for weighted avg
    let noPendingBuyValue = 0;   // sum of (qty * price) for weighted avg

    // Get market prices for fillability check (arbitrage only)
    const yesPricesForFilter = isArbitrage ? this.getYesPrices() : null;
    const noPricesForFilter = isArbitrage ? this.getNoPrices() : null;
    const FILLABILITY_THRESHOLD = 0.80; // Order must be within 20% of ask to count

    for (const order of openOrders) {
      const remainingQty = parseFloat(order.quantity) - parseFloat(order.filled_quantity);
      if (order.side === 'BUY') {
        // Always count total pending for all strategies
        pendingBuyQuantity += remainingQty;

        // For arbitrage, only count fillable orders toward per-asset pending
        if (isArbitrage) {
          const orderPrice = parseFloat(order.price);
          const marketAsk = order.outcome === 'YES'
            ? yesPricesForFilter?.bestAsk
            : noPricesForFilter?.bestAsk;

          // Order is fillable if no market data OR price is within threshold of ask
          const isFillable = !marketAsk || orderPrice >= marketAsk * FILLABILITY_THRESHOLD;

          if (isFillable) {
            if (order.outcome === 'YES') {
              yesPendingBuy += remainingQty;
              yesPendingBuyValue += remainingQty * orderPrice;
            } else {
              noPendingBuy += remainingQty;
              noPendingBuyValue += remainingQty * orderPrice;
            }
          } else {
            // Log phantom orders for debugging
            console.log(`[Bot ${this.id}] Phantom pending: ${order.outcome} ${remainingQty.toFixed(1)} @ ${orderPrice.toFixed(3)} (ask=${marketAsk?.toFixed(3)})`);
          }
        } else {
          // Non-arbitrage: count all pending orders
          const orderPriceNonArb = parseFloat(order.price);
          if (order.outcome === 'YES') {
            yesPendingBuy += remainingQty;
            yesPendingBuyValue += remainingQty * orderPriceNonArb;
          } else {
            noPendingBuy += remainingQty;
            noPendingBuyValue += remainingQty * orderPriceNonArb;
          }
        }
      } else {
        pendingSellQuantity += remainingQty;
      }
    }

    // Fetch positions from database for multi-asset strategies
    const positionRows = getPositionsByBotId(this.id);
    const positions = positionRows.map(rowToPosition);

    // Build context
    const context: StrategyContext = {
      bot: this.toInstance(),
      currentPrice: this.currentPrice,
      position: this.position,
      orderBook: this.currentOrderBook || undefined,
      lastTrade: this.currentLastTrade || undefined,
      tickSize: this.currentTickSize || undefined,
      pendingBuyQuantity,
      pendingSellQuantity,
      yesPendingBuy,
      noPendingBuy,
      yesPendingAvgPrice: yesPendingBuy > 0 ? yesPendingBuyValue / yesPendingBuy : 0,
      noPendingAvgPrice: noPendingBuy > 0 ? noPendingBuyValue / noPendingBuy : 0,
      // Multi-asset fields
      positions: positions.length > 0 ? positions : undefined,
      noAssetId: this.config.noAssetId,
      noOrderBook: this.noOrderBook || undefined,
      yesPrices: this.getYesPrices(),
      noPrices: this.getNoPrices(),
      // Time-based fields for position scaling
      botStartTime: this.startedAt,
      marketEndTime: this.marketEndTime,
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
   * Refresh current price and order books from CLOB API
   */
  private async refreshPrice(): Promise<void> {
    const assetId = this.config.assetId;
    if (!assetId) return;

    try {
      // Fetch directly from CLOB API to avoid port mismatch issues
      const CLOB_HOST = process.env.POLYMARKET_CLOB_HOST || 'https://clob.polymarket.com';
      const response = await fetch(`${CLOB_HOST}/book?token_id=${encodeURIComponent(assetId)}`);
      const orderBook = await response.json();

      if (orderBook && !orderBook.error) {
        const bids = orderBook.bids || [];
        const asks = orderBook.asks || [];

        // Store order book for marketable order checks
        this.currentOrderBook = {
          market: '',
          asset_id: assetId,
          bids,
          asks,
          timestamp: new Date().toISOString(),
        };

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

      // Also fetch NO order book for arbitrage strategies
      if (this.isArbitrageStrategy && this.config.noAssetId) {
        const noResponse = await fetch(`${CLOB_HOST}/book?token_id=${encodeURIComponent(this.config.noAssetId)}`);
        const noOrderBook = await noResponse.json();

        if (noOrderBook && !noOrderBook.error) {
          this.noOrderBook = {
            market: '',
            asset_id: this.config.noAssetId,
            bids: noOrderBook.bids || [],
            asks: noOrderBook.asks || [],
            timestamp: new Date().toISOString(),
          };
        }
      }
    } catch (error) {
      // Silently continue with previous data
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
   * Update position after a trade (both in-memory and database)
   */
  private updatePositionFromTrade(trade: Trade): void {
    const currentSize = parseFloat(this.position.size);
    const tradeQty = parseFloat(trade.quantity);
    const tradePrice = parseFloat(trade.price);

    let newSize: number;
    let newAvg: number;
    let newPnl: number = parseFloat(this.position.realizedPnl);

    if (trade.side === 'BUY') {
      // Buying increases position
      newSize = currentSize + tradeQty;
      const currentAvg = parseFloat(this.position.avgEntryPrice);
      newAvg = currentSize === 0
        ? tradePrice
        : (currentAvg * currentSize + tradePrice * tradeQty) / newSize;
    } else {
      // Selling decreases position
      newSize = Math.max(0, currentSize - tradeQty);
      newAvg = parseFloat(this.position.avgEntryPrice);

      // Calculate realized PnL
      const pnl = (tradePrice - newAvg) * tradeQty;
      newPnl += pnl;

      // Reset avg entry price if position closed
      if (newSize <= 0) {
        newAvg = 0;
      }
    }

    // Update in-memory position
    this.position.size = newSize.toString();
    this.position.avgEntryPrice = newAvg.toFixed(6);
    this.position.realizedPnl = newPnl.toFixed(6);

    // Persist to database so SSE can fetch updated position immediately
    const assetId = trade.assetId || this.config.assetId || '';
    getOrCreatePosition(this.id, this.config.marketId, assetId, trade.outcome);
    updatePosition(this.id, assetId, {
      size: newSize.toFixed(6),
      avgEntryPrice: newAvg.toFixed(6),
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
   * Update current price
   */
  updatePrice(yes: string, no: string): void {
    this.currentPrice = { yes, no };
  }

  // ============================================================================
  // Arbitrage Position Management
  // ============================================================================

  /**
   * Get NO order book
   */
  getNoOrderBook(): OrderBook | null {
    return this.noOrderBook;
  }

  /**
   * Extract best bid/ask prices from YES order book
   */
  private getYesPrices(): { bestBid: number; bestAsk: number } | undefined {
    if (!this.currentOrderBook) return undefined;

    const bids = this.currentOrderBook.bids || [];
    const asks = this.currentOrderBook.asks || [];

    if (bids.length === 0 || asks.length === 0) return undefined;

    const sortedBids = [...bids].sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
    const sortedAsks = [...asks].sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

    return {
      bestBid: parseFloat(sortedBids[0].price),
      bestAsk: parseFloat(sortedAsks[0].price),
    };
  }

  /**
   * Extract best bid/ask prices from NO order book
   */
  private getNoPrices(): { bestBid: number; bestAsk: number } | undefined {
    if (!this.noOrderBook) return undefined;

    const bids = this.noOrderBook.bids || [];
    const asks = this.noOrderBook.asks || [];

    if (bids.length === 0 || asks.length === 0) return undefined;

    const sortedBids = [...bids].sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
    const sortedAsks = [...asks].sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

    return {
      bestBid: parseFloat(sortedBids[0].price),
      bestAsk: parseFloat(sortedAsks[0].price),
    };
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
   * Updates in-memory position based on the fill result
   * For arbitrage bots, skips in-memory update since DB tracks per-asset positions
   */
  handleOrderFilled(fill: FillResult): void {
    // For arbitrage bots, don't update in-memory position since we track per-asset in DB
    // The single this.position object can't represent YES and NO positions correctly
    // The UI fetches correct positions via SSE from the database
    if (this.isArbitrageStrategy) {
      // Just update metrics and emit event
      this.metrics.totalTrades++;
      this.updatedAt = new Date();
      console.log(
        `[Bot ${this.id}] Arbitrage fill: ${fill.side} ${fill.outcome} ${parseFloat(fill.filledQuantity).toFixed(4)} @ ${fill.fillPrice}`
      );
      this.emitEvent({ type: 'ORDER_FILLED', fill, timestamp: new Date() });
      return;
    }

    const fillQty = parseFloat(fill.filledQuantity);
    const fillPrice = parseFloat(fill.fillPrice);
    const currentSize = parseFloat(this.position.size);

    if (fill.side === 'BUY') {
      // Buying increases position
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

    // Update metrics - count every fill as a trade
    this.metrics.totalTrades++;
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
    // Calculate total position size from all positions in DB (for arbitrage: YES + NO)
    const positionRows = getPositionsByBotId(this.id);
    const totalPositionSize = positionRows.reduce(
      (sum, row) => sum + parseFloat(row.size),
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
   * Get current order book (for marketable order detection)
   */
  getOrderBook(): OrderBook | null {
    return this.currentOrderBook;
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

  // ============================================================================
  // Market Status Monitoring
  // ============================================================================

  /**
   * Check if the market is still active/open
   * Returns true if market check passed (ok to continue), false if market closed
   */
  private async checkMarketStatus(): Promise<boolean> {
    const now = Date.now();

    // Only check periodically to avoid excessive API calls
    if (now - this.lastMarketCheck < this.MARKET_CHECK_INTERVAL_MS) {
      return true; // Skip check, assume still open
    }

    this.lastMarketCheck = now;

    const assetId = this.config.assetId;
    if (!assetId) {
      return true; // No asset ID to check
    }

    try {
      // Use CLOB API to check if order book exists - it's removed when market closes
      const CLOB_HOST = process.env.POLYMARKET_CLOB_HOST || 'https://clob.polymarket.com';
      const response = await fetch(`${CLOB_HOST}/book?token_id=${encodeURIComponent(assetId)}`);

      if (!response.ok) {
        // 404 or other error could mean market is closed
        const text = await response.text();
        if (text.includes('No orderbook exists') || text.includes('market not found')) {
          console.log(`[Bot ${this.id}] Market closed - order book no longer exists`);
          return false;
        }
        console.warn(`[Bot ${this.id}] Failed to check market status: ${response.status}`);
        return true; // Other errors - continue trading
      }

      const data = await response.json();

      // Check if response indicates no order book
      if (data.error && (data.error.includes('No orderbook') || data.error.includes('not found'))) {
        console.log(`[Bot ${this.id}] Market closed - order book no longer exists`);
        return false;
      }

      return true;
    } catch (error) {
      console.warn(`[Bot ${this.id}] Error checking market status:`, error);
      return true; // Don't stop on network errors, continue trading
    }
  }

  /**
   * Handle market closure - stop bot and cancel pending orders
   */
  private async handleMarketClosed(): Promise<void> {
    console.log(`[Bot ${this.id}] Market closed - stopping bot and cancelling pending orders`);

    // Cancel all pending orders
    const cancelledCount = cancelAllBotOrders(this.id);
    if (cancelledCount > 0) {
      console.log(`[Bot ${this.id}] Cancelled ${cancelledCount} pending orders due to market closure`);
    }

    // Emit error event
    this.emitEvent({
      type: 'ERROR',
      error: 'Market closed - bot auto-stopped',
      timestamp: new Date(),
    });

    // Stop the bot
    await this.stop();

    // Update database state (must be done after stop() to sync in-memory and database)
    updateBotState(this.id, 'stopped', {
      stoppedAt: new Date().toISOString(),
    });
  }
}
