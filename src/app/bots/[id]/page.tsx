"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BotStatusBadge, BotControls } from "@/components/bots";
import { TradesTable } from "@/components/trades";
import {
  ArrowLeft,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Activity,
  Package,
} from "lucide-react";
import { getWebSocket } from "@/lib/polymarket/websocket";
import type { BotInstance, Trade, StrategyDefinition, LimitOrder } from "@/lib/bots/types";
import type { LastTrade, OrderBook, OrderBookEntry } from "@/lib/polymarket/types";
import { cn } from "@/lib/utils";
import { CircleDot, XCircle } from "lucide-react";

// Format strategy slug to display name (e.g., "test-oscillator" -> "Test Oscillator")
function formatStrategyName(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default function BotDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [bot, setBot] = useState<BotInstance | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [strategy, setStrategy] = useState<StrategyDefinition | null>(null);
  const [activeOrders, setActiveOrders] = useState<LimitOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingOrders, setCancellingOrders] = useState(false);

  // Market data state
  const [bestBid, setBestBid] = useState<string | null>(null);
  const [bestAsk, setBestAsk] = useState<string | null>(null);
  const [lastTrade, setLastTrade] = useState<LastTrade | null>(null);
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [tickSize, setTickSize] = useState<string>("0.0001"); // Default 4 decimals

  // Calculate decimal places from tick size
  const getDecimals = useCallback((tick: string) => {
    const tickNum = parseFloat(tick);
    if (tickNum >= 1) return 0;
    return Math.max(0, Math.ceil(-Math.log10(tickNum)));
  }, []);

  // Format price based on tick size
  const formatPrice = useCallback((price: string | number) => {
    const decimals = getDecimals(tickSize);
    return parseFloat(String(price)).toFixed(decimals);
  }, [tickSize, getDecimals]);

  const fetchData = useCallback(async () => {
    try {
      // Fetch bot, trades, and active orders in parallel
      // Only fetch filled trades for Recent Trades section (pending trades have order prices, not fill prices)
      const [botRes, tradesRes, ordersRes] = await Promise.all([
        fetch(`/api/bots/${id}`),
        fetch(`/api/trades?botId=${id}&limit=50&status=filled`),
        fetch(`/api/bots/${id}/orders`),
      ]);

      const botData = await botRes.json();
      const tradesData = await tradesRes.json();
      const ordersData = await ordersRes.json();

      if (botData.success) {
        setBot(botData.data);
        setError(null);

        // Fetch strategy info for description and parameters
        const strategyRes = await fetch(`/api/strategies/${botData.data.config.strategySlug}`);
        const strategyData = await strategyRes.json();
        if (strategyData.success) {
          setStrategy(strategyData.data.strategy);
        }
      } else {
        setError(botData.error || "Failed to fetch bot");
      }

      if (tradesData.success) {
        setTrades(tradesData.data);
      }

      if (ordersData.success) {
        setActiveOrders(ordersData.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch bot");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const cancelAllOrders = async () => {
    setCancellingOrders(true);
    try {
      const res = await fetch(`/api/bots/${id}/orders`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setActiveOrders([]);
        fetchData();
      }
    } catch (err) {
      console.error("Failed to cancel orders:", err);
    } finally {
      setCancellingOrders(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Fetch order book data
  const fetchOrderBook = useCallback(async (assetId: string) => {
    try {
      const response = await fetch(`/api/orderbook?token_id=${encodeURIComponent(assetId)}`);
      const data = await response.json();
      if (data.success && data.data) {
        const bids = data.data.bids || [];
        const asks = data.data.asks || [];

        // Store full order book
        setOrderBook({
          market: "",
          asset_id: assetId,
          bids: bids,
          asks: asks,
          timestamp: new Date().toISOString(),
        });

        if (bids.length > 0) {
          const sortedBids = [...bids].sort(
            (a: { price: string }, b: { price: string }) =>
              parseFloat(b.price) - parseFloat(a.price)
          );
          setBestBid(sortedBids[0].price);
        }
        if (asks.length > 0) {
          const sortedAsks = [...asks].sort(
            (a: { price: string }, b: { price: string }) =>
              parseFloat(a.price) - parseFloat(b.price)
          );
          setBestAsk(sortedAsks[0].price);
        }
      }
    } catch (error) {
      console.error("Failed to fetch order book:", error);
    }
  }, []);

  // Fetch last trade price from order book mid-price (more accurate than market-level lastTradePrice)
  const fetchLastTradePrice = useCallback(async (assetId: string) => {
    try {
      const response = await fetch(`/api/orderbook?token_id=${encodeURIComponent(assetId)}`);
      const data = await response.json();
      if (data.success && data.data) {
        const bids = data.data.bids || [];
        const asks = data.data.asks || [];

        if (bids.length > 0 && asks.length > 0) {
          // Calculate mid-price from best bid/ask
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
          const midPrice = ((bestBid + bestAsk) / 2).toFixed(4);

          setLastTrade((prev) => {
            // Only update if we don't have real WebSocket trade data
            const hasWebSocketDetails = prev && prev.asset_id !== "" && prev.size !== "0";
            if (hasWebSocketDetails) {
              return prev; // Keep WebSocket data
            }
            return {
              asset_id: "",
              price: midPrice,
              size: "0",
              side: "BUY",
              timestamp: new Date().toISOString(),
            };
          });
        }
      }
    } catch (error) {
      console.error("Failed to fetch last trade price:", error);
    }
  }, []);

  // WebSocket subscription for live market data
  useEffect(() => {
    if (!bot?.config.assetId) return;

    const assetId = bot.config.assetId;
    const ws = getWebSocket();

    // Fetch initial data
    fetchOrderBook(assetId);
    fetchLastTradePrice(assetId);

    // Store callback references for cleanup
    const orderBookCallback = (book: OrderBook) => {
      setOrderBook(book);
      const bids = book.bids || [];
      const asks = book.asks || [];

      // Sort to get best bid (highest) and best ask (lowest)
      if (bids.length > 0) {
        const sortedBids = [...bids].sort(
          (a, b) => parseFloat(b.price) - parseFloat(a.price)
        );
        setBestBid(sortedBids[0].price);
      }
      if (asks.length > 0) {
        const sortedAsks = [...asks].sort(
          (a, b) => parseFloat(a.price) - parseFloat(b.price)
        );
        setBestAsk(sortedAsks[0].price);
      }
    };

    const tradeCallback = (trade: LastTrade) => {
      console.log("[BotPage] Received last trade:", trade.price);
      setLastTrade(trade);
    };

    const tickSizeCallback = (tick: { asset_id: string; tick_size: string }) => {
      console.log("[BotPage] Tick size update:", tick.tick_size);
      setTickSize(tick.tick_size);
    };

    ws.connect()
      .then(() => {
        setIsConnected(true);

        // Subscribe to order book updates
        ws.subscribeOrderBook([assetId], orderBookCallback);

        // Subscribe to last trade updates
        ws.subscribeTrades([assetId], tradeCallback);

        // Subscribe to tick size updates
        ws.subscribeTickSize([assetId], tickSizeCallback);
      })
      .catch((error) => {
        console.error("WebSocket connection failed:", error);
        setIsConnected(false);
      });

    // Poll order book every 3 seconds as backup (also updates last trade mid-price)
    const pollInterval = setInterval(() => {
      fetchOrderBook(assetId);
      fetchLastTradePrice(assetId);
    }, 3000);

    return () => {
      clearInterval(pollInterval);
      // Remove only our callbacks, don't unsubscribe completely (bot may still need events)
      ws.removeOrderBookCallback(assetId, orderBookCallback);
      ws.removeTradeCallback(assetId, tradeCallback);
    };
  }, [bot?.config.assetId, fetchOrderBook, fetchLastTradePrice]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !bot) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="max-w-4xl mx-auto">
          <Link href="/dashboard" className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6">
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
          <div className="bg-destructive/10 border border-destructive rounded-lg p-6">
            <p className="text-destructive">{error || "Bot not found"}</p>
          </div>
        </div>
      </div>
    );
  }

  const strategyName = formatStrategyName(bot.config.strategySlug);
  const pnl = parseFloat(bot.metrics.totalPnl);
  const positionSize = parseFloat(bot.position.size);
  const avgPrice = parseFloat(bot.position.avgEntryPrice);
  const winRate = bot.metrics.totalTrades > 0
    ? (bot.metrics.winningTrades / bot.metrics.totalTrades) * 100
    : 0;

  // Get bot's configured parameters
  const configuredParams = bot.config.strategyConfig || {};

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-bold">{strategyName}</h1>
                  <BotStatusBadge state={bot.state} mode={bot.config.mode} />
                </div>
                <Link
                  href={`/market/${bot.config.marketId}`}
                  className="text-sm text-muted-foreground hover:text-primary"
                >
                  {bot.config.marketName || bot.config.marketId}
                </Link>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <BotControls
                botId={bot.config.id}
                state={bot.state}
                onStateChange={fetchData}
              />
              <Button variant="outline" size="sm" onClick={fetchData}>
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-8">
        {/* Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-card border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Package className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Position</span>
            </div>
            <p className="text-2xl font-bold">
              {positionSize > 0 ? positionSize.toFixed(2) : "0"}
            </p>
            {positionSize > 0 && (
              <p className="text-xs text-muted-foreground">
                @ ${avgPrice.toFixed(4)}
              </p>
            )}
          </div>

          <div className="bg-card border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Win Rate</span>
            </div>
            <p className="text-2xl font-bold">{winRate.toFixed(1)}%</p>
          </div>

          <div className="bg-card border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              {pnl >= 0 ? (
                <TrendingUp className="w-4 h-4 text-green-500" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-500" />
              )}
              <span className="text-xs text-muted-foreground">Total PnL</span>
            </div>
            <p className={`text-2xl font-bold ${pnl >= 0 ? "text-green-500" : "text-red-500"}`}>
              ${pnl.toFixed(4)}
            </p>
          </div>

          <div className="bg-card border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Trades</span>
            </div>
            <p className="text-2xl font-bold">{bot.metrics.totalTrades}</p>
          </div>
        </div>

        {/* Market Data & Pending Orders - Side by Side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6 lg:h-[700px]">
          {/* Market Data */}
          <div className="bg-card border rounded-lg p-6 flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <h2 className="font-semibold">Market Data</h2>
              {bot.config.assetId && (
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "w-2 h-2 rounded-full",
                      isConnected ? "bg-green-500" : "bg-yellow-500"
                    )}
                  />
                  <span className="text-xs text-muted-foreground">
                    {isConnected ? "Live" : "Connecting..."}
                  </span>
                </div>
              )}
            </div>
            {!bot.config.assetId ? (
              <p className="text-muted-foreground text-sm">
                No asset ID configured for this bot. Market data requires an asset ID.
              </p>
            ) : (
              <div className="flex-1 overflow-auto">
                <div className="grid grid-cols-2 gap-4 flex-shrink-0">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Best Bid</p>
                    <p className="text-xl font-semibold text-green-600">
                      {bestBid ? formatPrice(bestBid) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Best Ask</p>
                    <p className="text-xl font-semibold text-red-600">
                      {bestAsk ? formatPrice(bestAsk) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Spread</p>
                    <p className="text-xl font-semibold">
                      {bestBid && bestAsk
                        ? `${((parseFloat(bestAsk) - parseFloat(bestBid)) * 100).toFixed(2)}%`
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Last Trade</p>
                    <p className="text-xl font-semibold">
                      {lastTrade ? (
                        <span className={lastTrade.size !== "0" ? (lastTrade.side === "BUY" ? "text-green-600" : "text-red-600") : "text-foreground"}>
                          {formatPrice(lastTrade.price)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </p>
                    {lastTrade && lastTrade.size !== "0" && (
                      <p className="text-xs text-muted-foreground">
                        {lastTrade.side} {parseFloat(lastTrade.size).toFixed(2)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Order Book Table */}
                {orderBook && (
                  <div className="mt-6 pt-6 border-t">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-muted-foreground">
                        Order Book (Top 10)
                      </h3>
                      {orderBook && (
                        <span className="text-xs text-green-500 inline-flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                          Live
                        </span>
                      )}
                    </div>
                    {(() => {
                      const topBids = orderBook?.bids
                        ? [...orderBook.bids]
                            .sort((a, b) => parseFloat(b.price) - parseFloat(a.price))
                            .slice(0, 10)
                        : [];
                      const topAsks = orderBook?.asks
                        ? [...orderBook.asks]
                            .sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
                            .slice(0, 10)
                        : [];

                      // Get active order prices for highlighting
                      const buyOrderPrices = new Set(
                        activeOrders
                          .filter((o) => o.side === "BUY")
                          .map((o) => o.price)
                      );
                      const sellOrderPrices = new Set(
                        activeOrders
                          .filter((o) => o.side === "SELL")
                          .map((o) => o.price)
                      );

                      if (topBids.length === 0 && topAsks.length === 0) {
                        return (
                          <p className="text-center text-muted-foreground py-4">
                            Loading order book...
                          </p>
                        );
                      }

                      return (
                        <div className="overflow-x-auto">
                          {/* Legend for order markers */}
                          {activeOrders.length > 0 && (
                            <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                              <CircleDot className="w-3 h-3 text-blue-500" />
                              <span>Pending Orders</span>
                            </div>
                          )}
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-muted-foreground border-b">
                                <th className="w-6 py-2 px-1"></th>
                                <th className="text-left py-2 px-2">Bid Size</th>
                                <th className="text-left py-2 px-2">Bid Price</th>
                                <th className="text-right py-2 px-2">Ask Price</th>
                                <th className="text-right py-2 px-2">Ask Size</th>
                                <th className="w-6 py-2 px-1"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {Array.from({ length: 10 }).map((_, i) => {
                                const bid: OrderBookEntry | undefined = topBids[i];
                                const ask: OrderBookEntry | undefined = topAsks[i];
                                const hasBuyOrder = bid && buyOrderPrices.has(bid.price);
                                const hasSellOrder = ask && sellOrderPrices.has(ask.price);
                                return (
                                  <tr
                                    key={i}
                                    className="border-b border-muted last:border-0"
                                  >
                                    <td className={cn(
                                      "py-1.5 px-1 text-center",
                                      hasBuyOrder && "bg-blue-500/10"
                                    )}>
                                      {hasBuyOrder && (
                                        <CircleDot className="w-3 h-3 text-blue-500 inline" />
                                      )}
                                    </td>
                                    <td className={cn(
                                      "py-1.5 px-2 text-green-600",
                                      hasBuyOrder && "bg-blue-500/10"
                                    )}>
                                      {bid?.size
                                        ? parseFloat(bid.size).toLocaleString()
                                        : "—"}
                                    </td>
                                    <td className={cn(
                                      "py-1.5 px-2 text-green-600 font-medium",
                                      hasBuyOrder && "bg-blue-500/10"
                                    )}>
                                      {bid?.price || "—"}
                                    </td>
                                    <td className={cn(
                                      "py-1.5 px-2 text-right text-red-600 font-medium",
                                      hasSellOrder && "bg-blue-500/10"
                                    )}>
                                      {ask?.price || "—"}
                                    </td>
                                    <td className={cn(
                                      "py-1.5 px-2 text-right text-red-600",
                                      hasSellOrder && "bg-blue-500/10"
                                    )}>
                                      {ask?.size
                                        ? parseFloat(ask.size).toLocaleString()
                                        : "—"}
                                    </td>
                                    <td className={cn(
                                      "py-1.5 px-1 text-center",
                                      hasSellOrder && "bg-blue-500/10"
                                    )}>
                                      {hasSellOrder && (
                                        <CircleDot className="w-3 h-3 text-blue-500 inline" />
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Pending Orders */}
          <div className="bg-card border rounded-lg p-6 flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">Pending Orders</h2>
                {activeOrders.length > 0 && (
                  <span className="text-sm text-muted-foreground">
                    ({activeOrders.length})
                  </span>
                )}
              </div>
              {activeOrders.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={cancelAllOrders}
                  disabled={cancellingOrders}
                  className="text-red-500 hover:text-red-600"
                >
                  <XCircle className="w-4 h-4 mr-1" />
                  {cancellingOrders ? "Cancelling..." : "Cancel All"}
                </Button>
              )}
            </div>
            {activeOrders.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-4">
                No pending orders
              </p>
            ) : (
              <div className="overflow-auto flex-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left py-2 px-2">Side</th>
                    <th className="text-left py-2 px-2">Outcome</th>
                    <th className="text-right py-2 px-2">Price</th>
                    <th className="text-right py-2 px-2">Quantity</th>
                    <th className="text-right py-2 px-2">Filled</th>
                    <th className="text-left py-2 px-2">Status</th>
                    <th className="text-left py-2 px-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {activeOrders.map((order) => {
                    const filled = parseFloat(order.filledQuantity);
                    const total = parseFloat(order.quantity);
                    const fillPercent = total > 0 ? (filled / total) * 100 : 0;
                    return (
                      <tr key={order.id} className="border-b border-muted last:border-0">
                        <td
                          className={cn(
                            "py-2 px-2 font-medium",
                            order.side === "BUY" ? "text-green-600" : "text-red-600"
                          )}
                        >
                          {order.side}
                        </td>
                        <td className="py-2 px-2">{order.outcome}</td>
                        <td className="py-2 px-2 text-right font-mono">
                          {formatPrice(order.price)}
                        </td>
                        <td className="py-2 px-2 text-right font-mono">
                          {parseFloat(order.quantity).toFixed(2)}
                        </td>
                        <td className="py-2 px-2 text-right font-mono">
                          <span className="text-muted-foreground">
                            {filled.toFixed(2)} ({fillPercent.toFixed(0)}%)
                          </span>
                        </td>
                        <td className="py-2 px-2">
                          <span
                            className={cn(
                              "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                              order.status === "open" && "bg-blue-500/10 text-blue-500",
                              order.status === "partially_filled" &&
                                "bg-yellow-500/10 text-yellow-500"
                            )}
                          >
                            {order.status === "partially_filled"
                              ? "Partial"
                              : order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-muted-foreground text-xs">
                          {new Date(order.createdAt).toLocaleTimeString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          </div>
        </div>

        {/* Recent Trades */}
        <div className="bg-card border rounded-lg p-6 mb-6">
          <h2 className="font-semibold mb-4">Recent Trades</h2>
          <div className="max-h-[400px] overflow-auto">
            <TradesTable trades={trades} />
          </div>
        </div>

        {/* Parameters */}
        {strategy?.parameters && strategy.parameters.length > 0 && (
          <div className="bg-card border rounded-lg p-6 mb-6">
            <h2 className="font-semibold mb-3">Parameters</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">Name</th>
                    <th className="pb-2 pr-4">Value</th>
                    <th className="pb-2">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {strategy.parameters.map((param) => (
                    <tr key={param.name} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-blue-500">{param.name}</td>
                      <td className="py-2 pr-4 font-mono">
                        {String(configuredParams[param.name] ?? param.default)}
                      </td>
                      <td className="py-2 text-muted-foreground">{param.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Description */}
        {strategy?.description && (
          <div className="bg-card border rounded-lg p-6">
            <h2 className="font-semibold mb-3">Strategy Description</h2>
            <p className="text-muted-foreground whitespace-pre-wrap">
              {strategy.description}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
