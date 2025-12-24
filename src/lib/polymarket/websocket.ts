/**
 * Polymarket WebSocket Manager
 *
 * Handles real-time market data streaming with auto-reconnection.
 * Essential for market making and arbitrage strategies.
 */

import type { OrderBook, OrderBookEntry, LastTrade, TickSize } from "./types";

type OrderBookCallback = (orderBook: OrderBook) => void;
type PriceCallback = (assetId: string, price: string, bestBid?: string, bestAsk?: string) => void;
type TradeCallback = (trade: LastTrade) => void;
type TickSizeCallback = (tickSize: TickSize) => void;
type ErrorCallback = (error: Error) => void;

interface WebSocketConfig {
  url?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

interface Subscription {
  assetIds: string[];
  onOrderBook?: OrderBookCallback;
  onPrice?: PriceCallback;
}

const DEFAULT_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

export class PolymarketWebSocket {
  private ws: WebSocket | null = null;
  private config: Required<WebSocketConfig>;
  private subscriptions: Map<string, Subscription> = new Map();
  private reconnectAttempts = 0;
  private isConnecting = false;
  private shouldReconnect = true;
  private orderBookCallbacks: Map<string, OrderBookCallback[]> = new Map();
  private priceCallbacks: Map<string, PriceCallback[]> = new Map();
  private tradeCallbacks: Map<string, TradeCallback[]> = new Map();
  private tickSizeCallbacks: Map<string, TickSizeCallback[]> = new Map();
  private subscribedAssets: Set<string> = new Set();
  private onError: ErrorCallback | null = null;

  constructor(config: WebSocketConfig = {}) {
    this.config = {
      url: config.url || DEFAULT_WS_URL,
      reconnectInterval: config.reconnectInterval || 5000,
      maxReconnectAttempts: config.maxReconnectAttempts || 10,
    };
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.url);

        this.ws.onopen = () => {
          console.log("[WS] Connected to Polymarket");
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.resubscribeAll();
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
          console.error("[WS] Error:", error);
          this.isConnecting = false;
          if (this.onError) {
            this.onError(new Error("WebSocket error"));
          }
        };

        this.ws.onclose = () => {
          console.log("[WS] Connection closed");
          this.isConnecting = false;
          this.attemptReconnect();
        };
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Subscribe to order book updates for specific assets
   */
  subscribeOrderBook(assetIds: string[], callback: OrderBookCallback): void {
    const newAssets: string[] = [];

    for (const assetId of assetIds) {
      const callbacks = this.orderBookCallbacks.get(assetId) || [];
      callbacks.push(callback);
      this.orderBookCallbacks.set(assetId, callbacks);

      // Track new assets that need subscription
      if (!this.subscribedAssets.has(assetId)) {
        newAssets.push(assetId);
        this.subscribedAssets.add(assetId);
      }
    }

    // Only send subscription for new assets
    if (this.ws?.readyState === WebSocket.OPEN && newAssets.length > 0) {
      this.sendSubscription(newAssets, "book");
    }
  }

  /**
   * Subscribe to price updates for specific assets
   */
  subscribePrice(assetIds: string[], callback: PriceCallback): void {
    const newAssets: string[] = [];

    for (const assetId of assetIds) {
      const callbacks = this.priceCallbacks.get(assetId) || [];
      callbacks.push(callback);
      this.priceCallbacks.set(assetId, callbacks);

      // Track new assets that need subscription
      if (!this.subscribedAssets.has(assetId)) {
        newAssets.push(assetId);
        this.subscribedAssets.add(assetId);
      }
    }

    // Only send subscription for new assets
    if (this.ws?.readyState === WebSocket.OPEN && newAssets.length > 0) {
      this.sendSubscription(newAssets, "price");
    }
  }

  /**
   * Subscribe to trade updates for specific assets
   */
  subscribeTrades(assetIds: string[], callback: TradeCallback): void {
    const newAssets: string[] = [];

    for (const assetId of assetIds) {
      const callbacks = this.tradeCallbacks.get(assetId) || [];
      callbacks.push(callback);
      this.tradeCallbacks.set(assetId, callbacks);
      console.log(`[WS] subscribeTrades: ${assetId.slice(0, 8)}... now has ${callbacks.length} callbacks`);

      // Track new assets that need subscription
      if (!this.subscribedAssets.has(assetId)) {
        newAssets.push(assetId);
        this.subscribedAssets.add(assetId);
      }
    }

    // Only send subscription for new assets
    if (this.ws?.readyState === WebSocket.OPEN && newAssets.length > 0) {
      this.sendSubscription(newAssets, "book");
    }
  }

  /**
   * Subscribe to tick size updates for specific assets
   */
  subscribeTickSize(assetIds: string[], callback: TickSizeCallback): void {
    const newAssets: string[] = [];

    for (const assetId of assetIds) {
      const callbacks = this.tickSizeCallbacks.get(assetId) || [];
      callbacks.push(callback);
      this.tickSizeCallbacks.set(assetId, callbacks);

      // Track new assets that need subscription
      if (!this.subscribedAssets.has(assetId)) {
        newAssets.push(assetId);
        this.subscribedAssets.add(assetId);
      }
    }

    // Only send subscription for new assets
    if (this.ws?.readyState === WebSocket.OPEN && newAssets.length > 0) {
      this.sendSubscription(newAssets, "book");
    }
  }

  /**
   * Unsubscribe from asset updates (removes all callbacks for these assets)
   * WARNING: Only use this when stopping a bot - it removes ALL callbacks
   */
  unsubscribe(assetIds: string[]): void {
    for (const assetId of assetIds) {
      this.orderBookCallbacks.delete(assetId);
      this.priceCallbacks.delete(assetId);
      this.tradeCallbacks.delete(assetId);
      this.tickSizeCallbacks.delete(assetId);
      this.subscribedAssets.delete(assetId);
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "unsubscribe",
          assets_ids: assetIds,
        })
      );
    }
  }

  /**
   * Remove a specific order book callback (safe for UI cleanup)
   */
  removeOrderBookCallback(assetId: string, callback: OrderBookCallback): void {
    const callbacks = this.orderBookCallbacks.get(assetId);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Remove a specific trade callback (safe for UI cleanup)
   */
  removeTradeCallback(assetId: string, callback: TradeCallback): void {
    const callbacks = this.tradeCallbacks.get(assetId);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Set error callback
   */
  setErrorHandler(callback: ErrorCallback): void {
    this.onError = callback;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private sendSubscription(
    assetIds: string[],
    type: "book" | "price" | "user"
  ): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    // Polymarket market channel subscription format
    // Single "market" subscription receives all events: book, price_change, last_trade_price, tick_size_change
    const subscriptionMsg = {
      assets_ids: assetIds,
      type: "market",
    };
    console.log("[WS] Sending subscription:", subscriptionMsg);
    this.ws.send(JSON.stringify(subscriptionMsg));
  }

  private handleMessage(data: string): void {
    // Ignore non-JSON messages like PING/PONG heartbeats
    if (!data.startsWith("{") && !data.startsWith("[")) {
      return;
    }

    try {
      const message = JSON.parse(data);

      // Log all event types for debugging
      if (message.event_type) {
        console.log(`[WS] Event: ${message.event_type}`, message.asset_id ? `asset: ${message.asset_id.slice(0, 8)}...` : "");
      }

      // Handle array of order books (initial snapshot)
      if (Array.isArray(message)) {
        for (const item of message) {
          if (item.event_type === "book" && item.bids && item.asks) {
            const orderBook = this.parseOrderBookItem(item);
            const callbacks = this.orderBookCallbacks.get(item.asset_id) || [];
            for (const callback of callbacks) {
              callback(orderBook);
            }
          }
        }
        return;
      }

      // Handle single order book update
      if (message.event_type === "book" && message.bids && message.asks) {
        const orderBook = this.parseOrderBookItem(message);
        const callbacks = this.orderBookCallbacks.get(message.asset_id) || [];
        for (const callback of callbacks) {
          callback(orderBook);
        }
      }

      // Handle price change events - these contain best_bid/best_ask updates
      if (message.event_type === "price_change" && message.price_changes) {
        for (const change of message.price_changes) {
          const callbacks = this.priceCallbacks.get(change.asset_id) || [];
          for (const callback of callbacks) {
            callback(change.asset_id, change.price, change.best_bid, change.best_ask);
          }
        }
      }

      // Handle last trade price events
      if (message.event_type === "last_trade_price") {
        const assetId = message.asset_id as string;
        const trade: LastTrade = {
          asset_id: assetId,
          price: message.price as string,
          size: message.size as string || "0",
          side: (message.side as "BUY" | "SELL") || "BUY",
          timestamp: (message.timestamp as string) || new Date().toISOString(),
        };
        const callbacks = this.tradeCallbacks.get(assetId) || [];
        console.log(`[WS] last_trade_price: ${trade.price} (${callbacks.length} callbacks)`);
        for (const callback of callbacks) {
          callback(trade);
        }
      }

      // Handle tick size change events
      if (message.event_type === "tick_size_change") {
        const assetId = message.asset_id as string;
        const tickSize: TickSize = {
          asset_id: assetId,
          tick_size: message.tick_size as string,
          timestamp: (message.timestamp as string) || new Date().toISOString(),
        };
        const callbacks = this.tickSizeCallbacks.get(assetId) || [];
        for (const callback of callbacks) {
          callback(tickSize);
        }
      }
    } catch (error) {
      console.error("[WS] Failed to parse message:", error);
    }
  }

  private parseOrderBookItem(item: Record<string, unknown>): OrderBook {
    return {
      market: (item.market as string) || "",
      asset_id: item.asset_id as string,
      bids: (item.bids as OrderBookEntry[]) || [],
      asks: (item.asks as OrderBookEntry[]) || [],
      timestamp: (item.timestamp as string) || new Date().toISOString(),
    };
  }

  private resubscribeAll(): void {
    // Combine all asset IDs from all callbacks (deduped)
    const bookAssets = Array.from(this.orderBookCallbacks.keys());
    const priceAssets = Array.from(this.priceCallbacks.keys());
    const tradeAssets = Array.from(this.tradeCallbacks.keys());
    const tickSizeAssets = Array.from(this.tickSizeCallbacks.keys());
    const allAssets = [...new Set([...bookAssets, ...priceAssets, ...tradeAssets, ...tickSizeAssets])];

    // Reset subscribed assets tracking (reconnection requires resubscription)
    this.subscribedAssets.clear();

    if (allAssets.length > 0) {
      // Single subscription for all assets - market channel includes all event types
      for (const assetId of allAssets) {
        this.subscribedAssets.add(assetId);
      }
      this.sendSubscription(allAssets, "book"); // type param ignored, always sends "market"
    }
  }

  private attemptReconnect(): void {
    if (!this.shouldReconnect) {
      return;
    }

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error("[WS] Max reconnection attempts reached");
      if (this.onError) {
        this.onError(new Error("Max reconnection attempts reached"));
      }
      return;
    }

    this.reconnectAttempts++;
    console.log(
      `[WS] Reconnecting in ${this.config.reconnectInterval}ms (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`
    );

    setTimeout(() => {
      this.connect().catch((error) => {
        console.error("[WS] Reconnection failed:", error);
      });
    }, this.config.reconnectInterval);
  }
}

// Singleton instance for shared use
let wsInstance: PolymarketWebSocket | null = null;

export function getWebSocket(): PolymarketWebSocket {
  if (!wsInstance) {
    wsInstance = new PolymarketWebSocket();
  }
  return wsInstance;
}
