/**
 * MarketDataManager
 *
 * Handles WebSocket subscriptions, order book caching, and price management.
 * Extracted from Bot.ts to provide clean separation of concerns.
 */

import type { OrderBook, LastTrade, TickSize } from '../polymarket/types';
import type { AssetSubscription } from './types';
import { getWebSocket } from '../polymarket/websocket';
import { log, warn, error } from '@/lib/logger';

/** Price information extracted from order book */
export interface AssetPrices {
  bestBid: number;
  bestAsk: number;
  midPrice: number;
}

/** Asset configuration for subscriptions */
export interface AssetConfig {
  assetId: string;
  label: string;
  subscriptions: AssetSubscription[];
}

/** Callback types */
type UpdateCallback = () => void;
type TradeCallback = (label: string, trade: LastTrade) => void;

export class MarketDataManager {
  private orderBooks: Map<string, OrderBook> = new Map();
  private prices: Map<string, AssetPrices> = new Map();
  private tickSizes: Map<string, TickSize> = new Map();
  private lastTrades: Map<string, LastTrade> = new Map();

  private updateCallbacks: UpdateCallback[] = [];
  private tradeCallbacks: TradeCallback[] = [];

  // Map assetId -> label for reverse lookup
  private assetIdToLabel: Map<string, string> = new Map();

  private isConnected = false;

  constructor(
    private botId: string,
    private assets: AssetConfig[]
  ) {
    // Build reverse lookup
    for (const asset of assets) {
      this.assetIdToLabel.set(asset.assetId, asset.label);
    }
  }

  /**
   * Connect to WebSocket and set up subscriptions
   */
  async connect(): Promise<void> {
    const ws = getWebSocket();

    if (!ws.isConnected()) {
      try {
        await ws.connect();
      } catch (err) {
        error(`MarketData ${this.botId.slice(0, 8)}`, 'Failed to connect WebSocket:', err);
      }
    }

    // Fetch initial data from API before subscribing
    await this.refreshAll();

    // Set up subscriptions for each asset
    for (const asset of this.assets) {
      const { assetId, label, subscriptions } = asset;

      if (subscriptions.includes('orderBook')) {
        ws.subscribeOrderBook([assetId], (orderBook) => {
          this.handleOrderBookUpdate(label, orderBook);
        });
      }

      if (subscriptions.includes('price')) {
        ws.subscribePrice([assetId], (_assetId, _price, bestBid, bestAsk) => {
          this.handlePriceUpdate(label, bestBid, bestAsk, assetId);
        });
      }

      if (subscriptions.includes('trades')) {
        ws.subscribeTrades([assetId], (trade) => {
          this.handleTradeUpdate(label, trade);
        });
      }

      if (subscriptions.includes('tickSize')) {
        ws.subscribeTickSize([assetId], (tickSize) => {
          this.handleTickSizeUpdate(label, tickSize);
        });
      }
    }

    this.isConnected = true;
    log(`MarketData ${this.botId.slice(0, 8)}`, `Connected with ${this.assets.length} assets`);
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    const ws = getWebSocket();
    const assetIds = this.assets.map(a => a.assetId);
    ws.unsubscribe(assetIds);
    this.isConnected = false;
    log(`MarketData ${this.botId.slice(0, 8)}`, 'Disconnected');
  }

  /**
   * Refresh all order books from CLOB API
   */
  async refreshAll(): Promise<void> {
    const CLOB_HOST = process.env.POLYMARKET_CLOB_HOST || 'https://clob.polymarket.com';

    for (const asset of this.assets) {
      try {
        const response = await fetch(`${CLOB_HOST}/book?token_id=${encodeURIComponent(asset.assetId)}`);
        const data = await response.json();

        if (data && !data.error) {
          const orderBook: OrderBook = {
            market: '',
            asset_id: asset.assetId,
            bids: data.bids || [],
            asks: data.asks || [],
            timestamp: new Date().toISOString(),
          };

          this.handleOrderBookUpdate(asset.label, orderBook);
        }
      } catch (err) {
        warn(`MarketData ${this.botId.slice(0, 8)}`, `Failed to refresh ${asset.label}:`, err);
      }
    }
  }

  // ===========================================================================
  // Getters
  // ===========================================================================

  getOrderBook(label: string): OrderBook | null {
    return this.orderBooks.get(label) || null;
  }

  getPrices(label: string): AssetPrices | null {
    return this.prices.get(label) || null;
  }

  getTickSize(label: string): TickSize | null {
    return this.tickSizes.get(label) || null;
  }

  getLastTrade(label: string): LastTrade | null {
    return this.lastTrades.get(label) || null;
  }

  getAllOrderBooks(): Map<string, OrderBook> {
    return this.orderBooks;
  }

  getAllPrices(): Map<string, AssetPrices> {
    return this.prices;
  }

  /**
   * Get all last trades (for market resolution detection)
   * Returns a copy to prevent external modification
   */
  getAllLastTrades(): Map<string, LastTrade> {
    return new Map(this.lastTrades);
  }

  /**
   * Get current price as { yes: string, no: string } for backward compatibility
   */
  getCurrentPrice(): { yes: string; no: string } {
    const yesPrice = this.prices.get('YES')?.midPrice ?? 0.5;
    const noPrice = this.prices.get('NO')?.midPrice ?? (1 - yesPrice);

    return {
      yes: yesPrice.toFixed(4),
      no: noPrice.toFixed(4),
    };
  }

  /**
   * Get any tick size (for formatting purposes)
   */
  getAnyTickSize(): TickSize | null {
    for (const tickSize of this.tickSizes.values()) {
      return tickSize;
    }
    return null;
  }

  // ===========================================================================
  // Callbacks
  // ===========================================================================

  onUpdate(callback: UpdateCallback): void {
    this.updateCallbacks.push(callback);
  }

  onTrade(callback: TradeCallback): void {
    this.tradeCallbacks.push(callback);
  }

  // ===========================================================================
  // Private Handlers
  // ===========================================================================

  private handleOrderBookUpdate(label: string, orderBook: OrderBook): void {
    this.orderBooks.set(label, orderBook);

    // Extract prices from order book
    const prices = this.extractPricesFromOrderBook(orderBook);
    if (prices) {
      this.prices.set(label, prices);
    }

    // Infer tick size if not already set
    if (!this.tickSizes.has(label)) {
      const tickSize = this.inferTickSize(orderBook);
      if (tickSize) {
        this.tickSizes.set(label, tickSize);
      }
    }

    // Notify listeners
    this.notifyUpdate();
  }

  private handlePriceUpdate(label: string, bestBid?: string, bestAsk?: string, assetId?: string): void {
    if (!bestBid || !bestAsk) return;

    const bid = parseFloat(bestBid);
    const ask = parseFloat(bestAsk);
    const midPrice = (bid + ask) / 2;

    this.prices.set(label, { bestBid: bid, bestAsk: ask, midPrice });

    // Update order book with latest best prices
    const orderBook = this.orderBooks.get(label);
    if (orderBook) {
      // Keep existing depth, update best prices
      const existingBids = (orderBook.bids || []).filter(b => parseFloat(b.price) < bid);
      const existingAsks = (orderBook.asks || []).filter(a => parseFloat(a.price) > ask);

      this.orderBooks.set(label, {
        ...orderBook,
        bids: [{ price: bestBid, size: '1000000' }, ...existingBids],
        asks: [{ price: bestAsk, size: '1000000' }, ...existingAsks],
      });
    } else if (assetId) {
      // Create minimal order book if none exists
      this.orderBooks.set(label, {
        market: '',
        asset_id: assetId,
        bids: [{ price: bestBid, size: '1000000' }],
        asks: [{ price: bestAsk, size: '1000000' }],
        timestamp: new Date().toISOString(),
      });
    }

    // Notify listeners
    this.notifyUpdate();
  }

  private handleTradeUpdate(label: string, trade: LastTrade): void {
    this.lastTrades.set(label, trade);

    // Notify trade listeners
    for (const callback of this.tradeCallbacks) {
      try {
        callback(label, trade);
      } catch (err) {
        error(`MarketData ${this.botId.slice(0, 8)}`, 'Trade callback error:', err);
      }
    }
  }

  private handleTickSizeUpdate(label: string, tickSize: TickSize): void {
    this.tickSizes.set(label, tickSize);
    log(`MarketData ${this.botId.slice(0, 8)}`, `${label} tick size: ${tickSize.tick_size}`);
  }

  private extractPricesFromOrderBook(orderBook: OrderBook): AssetPrices | null {
    const bids = orderBook.bids || [];
    const asks = orderBook.asks || [];

    if (bids.length === 0 && asks.length === 0) return null;

    // Sort to get best prices
    const sortedBids = [...bids].sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
    const sortedAsks = [...asks].sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

    let bestBid = 0;
    let bestAsk = 1;

    if (sortedBids.length > 0) {
      bestBid = parseFloat(sortedBids[0].price);
    }

    if (sortedAsks.length > 0) {
      bestAsk = parseFloat(sortedAsks[0].price);
    }

    // Calculate mid price
    let midPrice: number;
    if (sortedBids.length > 0 && sortedAsks.length > 0) {
      midPrice = (bestBid + bestAsk) / 2;
    } else if (sortedBids.length > 0) {
      midPrice = bestBid;
    } else {
      midPrice = bestAsk;
    }

    return { bestBid, bestAsk, midPrice };
  }

  private inferTickSize(orderBook: OrderBook): TickSize | null {
    const bids = orderBook.bids || [];
    const asks = orderBook.asks || [];

    const samplePrice = bids[0]?.price || asks[0]?.price;
    if (!samplePrice) return null;

    const parts = samplePrice.split('.');
    if (parts.length < 2) {
      return {
        asset_id: orderBook.asset_id,
        tick_size: '1',
        timestamp: new Date().toISOString(),
      };
    }

    const decimals = parts[1].length;
    const tickSize = (1 / Math.pow(10, decimals)).toString();

    return {
      asset_id: orderBook.asset_id,
      tick_size: tickSize,
      timestamp: new Date().toISOString(),
    };
  }

  private notifyUpdate(): void {
    for (const callback of this.updateCallbacks) {
      try {
        callback();
      } catch (err) {
        error(`MarketData ${this.botId.slice(0, 8)}`, 'Update callback error:', err);
      }
    }
  }
}
