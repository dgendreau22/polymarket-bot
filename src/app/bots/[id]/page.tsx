"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
import type { BotInstance, Trade, StrategyDefinition, LimitOrder, Position } from "@/lib/bots/types";
import type { LastTrade, OrderBook, OrderBookEntry } from "@/lib/polymarket/types";
import { calculateRealizedPnl, calculateUnrealizedPnl, calculateAvgPrice } from "@/lib/bots/pnl";
import { cn } from "@/lib/utils";
import { CircleDot, XCircle, ChevronUp, ChevronDown } from "lucide-react";

// Sort configuration for pending orders
type OrderSortColumn = 'price' | 'side' | 'outcome' | 'quantity' | 'filled' | 'status' | 'latest';
type SortDirection = 'asc' | 'desc';

// Format strategy slug to display name (e.g., "test-oscillator" -> "Test Oscillator")
function formatStrategyName(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Aggregated order type for grouping orders at the same price
interface AggregatedOrder {
  price: string;
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO';
  totalQuantity: number;
  totalFilled: number;
  orderCount: number;
  latestCreatedAt: Date;
  hasPartialFill: boolean;
}

// Aggregate orders by price+side+outcome and sort by latest first
function aggregateOrders(orders: LimitOrder[]): AggregatedOrder[] {
  const grouped = new Map<string, AggregatedOrder>();

  for (const order of orders) {
    const key = `${order.price}-${order.side}-${order.outcome}`;
    const existing = grouped.get(key);
    const createdAt = new Date(order.createdAt);

    if (existing) {
      existing.totalQuantity += parseFloat(order.quantity);
      existing.totalFilled += parseFloat(order.filledQuantity);
      existing.orderCount += 1;
      if (createdAt > existing.latestCreatedAt) {
        existing.latestCreatedAt = createdAt;
      }
      if (order.status === 'partially_filled') {
        existing.hasPartialFill = true;
      }
    } else {
      grouped.set(key, {
        price: order.price,
        side: order.side,
        outcome: order.outcome,
        totalQuantity: parseFloat(order.quantity),
        totalFilled: parseFloat(order.filledQuantity),
        orderCount: 1,
        latestCreatedAt: createdAt,
        hasPartialFill: order.status === 'partially_filled',
      });
    }
  }

  // Sort by latest first
  return Array.from(grouped.values()).sort(
    (a, b) => b.latestCreatedAt.getTime() - a.latestCreatedAt.getTime()
  );
}

export default function BotDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [bot, setBot] = useState<BotInstance | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [strategy, setStrategy] = useState<StrategyDefinition | null>(null);
  const [activeOrders, setActiveOrders] = useState<LimitOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingOrders, setCancellingOrders] = useState(false);

  // Market data state (YES side)
  const [bestBid, setBestBid] = useState<string | null>(null);
  const [bestAsk, setBestAsk] = useState<string | null>(null);
  const [lastTrade, setLastTrade] = useState<LastTrade | null>(null);
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [tickSize, setTickSize] = useState<string>("0.0001"); // Default 4 decimals

  // Market data state (NO side - for arbitrage)
  const [noBestBid, setNoBestBid] = useState<string | null>(null);
  const [noBestAsk, setNoBestAsk] = useState<string | null>(null);
  const [noLastTrade, setNoLastTrade] = useState<LastTrade | null>(null);
  const [noOrderBook, setNoOrderBook] = useState<OrderBook | null>(null);

  // Pending orders sort state
  const [orderSortColumn, setOrderSortColumn] = useState<OrderSortColumn>('price');
  const [orderSortDirection, setOrderSortDirection] = useState<SortDirection>('desc');

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

  // Infer tick size from price string (strips trailing zeros to get actual precision)
  const inferTickSize = useCallback((price: string): string => {
    const trimmed = parseFloat(price).toString();
    const parts = trimmed.split('.');
    if (parts.length < 2) return '1';
    const decimals = parts[1].length;
    return (1 / Math.pow(10, decimals)).toString();
  }, []);

  // Handle column header click for sorting
  const handleOrderSort = useCallback((column: OrderSortColumn) => {
    if (orderSortColumn === column) {
      setOrderSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setOrderSortColumn(column);
      setOrderSortDirection(column === 'price' ? 'desc' : 'asc');
    }
  }, [orderSortColumn]);

  // Sort aggregated orders
  const sortOrders = useCallback((orders: AggregatedOrder[]): AggregatedOrder[] => {
    return [...orders].sort((a, b) => {
      let comparison = 0;
      switch (orderSortColumn) {
        case 'price':
          comparison = parseFloat(a.price) - parseFloat(b.price);
          break;
        case 'side':
          comparison = a.side.localeCompare(b.side);
          break;
        case 'outcome':
          comparison = a.outcome.localeCompare(b.outcome);
          break;
        case 'quantity':
          comparison = a.totalQuantity - b.totalQuantity;
          break;
        case 'filled':
          comparison = a.totalFilled - b.totalFilled;
          break;
        case 'status':
          comparison = (a.hasPartialFill ? 1 : 0) - (b.hasPartialFill ? 1 : 0);
          break;
        case 'latest':
          comparison = a.latestCreatedAt.getTime() - b.latestCreatedAt.getTime();
          break;
      }
      return orderSortDirection === 'asc' ? comparison : -comparison;
    });
  }, [orderSortColumn, orderSortDirection]);

  // SSE connection state
  const [sseConnected, setSseConnected] = useState(false);

  // Fetch strategy info (only needs to be done once)
  const fetchStrategy = useCallback(async (strategySlug: string) => {
    try {
      const strategyRes = await fetch(`/api/strategies/${strategySlug}`);
      const strategyData = await strategyRes.json();
      if (strategyData.success) {
        setStrategy(strategyData.data.strategy);
      }
    } catch (err) {
      console.error("Failed to fetch strategy:", err);
    }
  }, []);

  // Initial data fetch (fallback and strategy load)
  const fetchData = useCallback(async () => {
    try {
      const botRes = await fetch(`/api/bots/${id}`);
      const botData = await botRes.json();

      if (botData.success) {
        setBot(botData.data);
        setError(null);
        fetchStrategy(botData.data.config.strategySlug);
      } else {
        setError(botData.error || "Failed to fetch bot");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch bot");
    } finally {
      setLoading(false);
    }
  }, [id, fetchStrategy]);

  const cancelAllOrders = async () => {
    setCancellingOrders(true);
    try {
      const res = await fetch(`/api/bots/${id}/orders`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setActiveOrders([]);
      }
    } catch (err) {
      console.error("Failed to cancel orders:", err);
    } finally {
      setCancellingOrders(false);
    }
  };

  // Track if strategy has been fetched to avoid re-fetching
  const strategyFetchedRef = useRef(false);

  // SSE connection for real-time updates (no polling!)
  useEffect(() => {
    // Connect to SSE endpoint
    const eventSource = new EventSource(`/api/bots/${id}/events`);

    eventSource.onopen = () => {
      console.log("[SSE] Connected to bot events");
      setSseConnected(true);
    };

    eventSource.onerror = (err) => {
      console.error("[SSE] Connection error:", err);
      setSseConnected(false);
      // On error, fall back to fetching data directly
      fetchData();
    };

    // Handle bot state updates
    eventSource.addEventListener("bot", (e) => {
      try {
        const botData = JSON.parse(e.data);
        setBot(botData);
        setLoading(false);
        setError(null);

        // Fetch strategy once
        if (!strategyFetchedRef.current && botData.config?.strategySlug) {
          strategyFetchedRef.current = true;
          fetchStrategy(botData.config.strategySlug);
        }
      } catch (err) {
        console.error("[SSE] Failed to parse bot data:", err);
      }
    });

    // Handle positions updates
    eventSource.addEventListener("positions", (e) => {
      try {
        const positionsData = JSON.parse(e.data);
        setPositions(positionsData);
      } catch (err) {
        console.error("[SSE] Failed to parse positions data:", err);
      }
    });

    // Handle trades updates
    eventSource.addEventListener("trades", (e) => {
      try {
        const tradesData = JSON.parse(e.data);
        setTrades(tradesData);
      } catch (err) {
        console.error("[SSE] Failed to parse trades data:", err);
      }
    });

    // Handle orders updates
    eventSource.addEventListener("orders", (e) => {
      try {
        const ordersData = JSON.parse(e.data);
        setActiveOrders(ordersData);
      } catch (err) {
        console.error("[SSE] Failed to parse orders data:", err);
      }
    });

    // Handle bot events (for logging/debugging)
    eventSource.addEventListener("event", (e) => {
      try {
        const event = JSON.parse(e.data);
        console.log("[SSE] Bot event:", event.type);
      } catch (err) {
        console.error("[SSE] Failed to parse event:", err);
      }
    });

    // Cleanup on unmount
    return () => {
      console.log("[SSE] Closing connection");
      eventSource.close();
    };
  }, [id, fetchData, fetchStrategy]); // Removed 'strategy' from deps to prevent reconnection

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

        // Infer tick size from order book prices
        const samplePrice = bids[0]?.price || asks[0]?.price;
        if (samplePrice) {
          const inferred = inferTickSize(samplePrice);
          setTickSize((current) => {
            if (current === "0.0001" || parseFloat(inferred) > parseFloat(current)) {
              return inferred;
            }
            return current;
          });
        }
      }
    } catch (error) {
      console.error("Failed to fetch order book:", error);
    }
  }, [inferTickSize]);

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

  // Fetch NO side order book (for arbitrage)
  const fetchNoOrderBook = useCallback(async (assetId: string) => {
    try {
      const response = await fetch(`/api/orderbook?token_id=${encodeURIComponent(assetId)}`);
      const data = await response.json();
      if (data.success && data.data) {
        const bids = data.data.bids || [];
        const asks = data.data.asks || [];

        setNoOrderBook({
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
          setNoBestBid(sortedBids[0].price);
        }
        if (asks.length > 0) {
          const sortedAsks = [...asks].sort(
            (a: { price: string }, b: { price: string }) =>
              parseFloat(a.price) - parseFloat(b.price)
          );
          setNoBestAsk(sortedAsks[0].price);
        }
      }
    } catch (error) {
      console.error("Failed to fetch NO order book:", error);
    }
  }, []);

  // Fetch NO side last trade price (for arbitrage)
  const fetchNoLastTradePrice = useCallback(async (assetId: string) => {
    try {
      const response = await fetch(`/api/orderbook?token_id=${encodeURIComponent(assetId)}`);
      const data = await response.json();
      if (data.success && data.data) {
        const bids = data.data.bids || [];
        const asks = data.data.asks || [];

        if (bids.length > 0 && asks.length > 0) {
          const sortedBids = [...bids].sort(
            (a: { price: string }, b: { price: string }) =>
              parseFloat(b.price) - parseFloat(a.price)
          );
          const sortedAsks = [...asks].sort(
            (a: { price: string }, b: { price: string }) =>
              parseFloat(a.price) - parseFloat(b.price)
          );
          const bestBidPrice = parseFloat(sortedBids[0].price);
          const bestAskPrice = parseFloat(sortedAsks[0].price);
          const midPrice = ((bestBidPrice + bestAskPrice) / 2).toFixed(4);

          setNoLastTrade((prev) => {
            const hasWebSocketDetails = prev && prev.asset_id !== "" && prev.size !== "0";
            if (hasWebSocketDetails) {
              return prev;
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
      console.error("Failed to fetch NO last trade price:", error);
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

      // Infer tick size from order book prices
      const samplePrice = bids[0]?.price || asks[0]?.price;
      if (samplePrice) {
        const inferred = inferTickSize(samplePrice);
        setTickSize((current) => {
          if (current === "0.0001" || parseFloat(inferred) > parseFloat(current)) {
            return inferred;
          }
          return current;
        });
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
  }, [bot?.config.assetId, fetchOrderBook, fetchLastTradePrice, inferTickSize]);

  // NO side data subscription (for arbitrage bots)
  useEffect(() => {
    const noAssetId = bot?.config.noAssetId;
    if (!noAssetId || bot?.config.strategySlug !== 'arbitrage') return;

    // Fetch initial NO data
    fetchNoOrderBook(noAssetId);
    fetchNoLastTradePrice(noAssetId);

    const ws = getWebSocket();

    // Subscribe to NO asset order book updates
    const noOrderBookCallback = (book: OrderBook) => {
      setNoOrderBook(book);
      const bids = book.bids || [];
      const asks = book.asks || [];

      if (bids.length > 0) {
        const sortedBids = [...bids].sort(
          (a, b) => parseFloat(b.price) - parseFloat(a.price)
        );
        setNoBestBid(sortedBids[0].price);
      }
      if (asks.length > 0) {
        const sortedAsks = [...asks].sort(
          (a, b) => parseFloat(a.price) - parseFloat(b.price)
        );
        setNoBestAsk(sortedAsks[0].price);
      }
    };

    const noTradeCallback = (trade: LastTrade) => {
      setNoLastTrade(trade);
    };

    ws.connect()
      .then(() => {
        ws.subscribeOrderBook([noAssetId], noOrderBookCallback);
        ws.subscribeTrades([noAssetId], noTradeCallback);
      })
      .catch((error) => {
        console.error("WebSocket connection failed for NO asset:", error);
      });

    // Poll NO order book every 3 seconds as backup
    const pollInterval = setInterval(() => {
      fetchNoOrderBook(noAssetId);
      fetchNoLastTradePrice(noAssetId);
    }, 3000);

    return () => {
      clearInterval(pollInterval);
      ws.removeOrderBookCallback(noAssetId, noOrderBookCallback);
      ws.removeTradeCallback(noAssetId, noTradeCallback);
    };
  }, [bot?.config.noAssetId, bot?.config.strategySlug, fetchNoOrderBook, fetchNoLastTradePrice]);

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
  const isArbitrage = bot.config.strategySlug === 'arbitrage';

  // For arbitrage bots, calculate total position from positions array (DB source)
  // For non-arbitrage, use bot.position (in-memory)
  const positionSize = isArbitrage
    ? positions.reduce((sum, p) => sum + parseFloat(p.size), 0)
    : parseFloat(bot.position.size);
  // Calculate avg price using shared utility for consistency
  const avgPrice = calculateAvgPrice(positions);

  // Win rate based on trades with outcomes (winning + losing), not all trades
  const tradesWithOutcome = bot.metrics.winningTrades + bot.metrics.losingTrades;
  const winRate = tradesWithOutcome > 0
    ? (bot.metrics.winningTrades / tradesWithOutcome) * 100
    : 0;

  // Current price from last trade (for unrealized PnL calculation)
  const currentPrice = lastTrade?.price ? parseFloat(lastTrade.price) : 0;

  // Calculate PnL using shared utilities for consistency
  const yesCurrentPrice = lastTrade?.price ? parseFloat(lastTrade.price) : 0;
  const noCurrentPrice = noLastTrade?.price ? parseFloat(noLastTrade.price) : 0;

  const realizedPnl = calculateRealizedPnl(positions);
  const unrealizedPnl = calculateUnrealizedPnl(positions, yesCurrentPrice, noCurrentPrice);

  // Total PnL = realized + unrealized (used in header)
  const pnl = realizedPnl + unrealizedPnl;
  const totalPositionPnl = pnl;

  // Position value at current price
  const positionValue = positionSize * currentPrice;

  // Unrealized PnL percentage
  const unrealizedPnlPercent = positionSize > 0 && avgPrice > 0
    ? ((currentPrice - avgPrice) / avgPrice) * 100
    : 0;

  // Get bot's configured parameters
  const configuredParams = bot.config.strategyConfig || {};

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 py-4">
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

      <div className="max-w-[1600px] mx-auto px-4 py-6">
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
                @ ${formatPrice(avgPrice)}
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
              ${pnl.toFixed(2)}
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

        {/* Current Position */}
        <div className="bg-card border rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold">Current Position</h2>
              {bot.config.strategySlug === 'arbitrage' && positions.length > 0 && (() => {
                const yesPos = positions.find(p => p.outcome === 'YES');
                const noPos = positions.find(p => p.outcome === 'NO');
                const yesSize = yesPos ? parseFloat(yesPos.size) : 0;
                const noSize = noPos ? parseFloat(noPos.size) : 0;
                const matchedPairs = Math.min(yesSize, noSize);
                const status = matchedPairs > 0 && yesSize === noSize ? 'complete' : (yesSize > 0 || noSize > 0) ? 'building' : 'closed';
                return (
                  <span
                    className={cn(
                      "px-2 py-1 rounded text-xs font-medium",
                      status === 'complete'
                        ? "bg-green-500/20 text-green-500"
                        : status === 'building'
                        ? "bg-yellow-500/20 text-yellow-500"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {status.toUpperCase()}
                  </span>
                );
              })()}
            </div>
            {positionSize > 0 && (
              <button
                onClick={async () => {
                  if (!confirm(`Close position by selling ${positionSize.toFixed(2)} shares at market price?`)) return;
                  try {
                    const res = await fetch(`/api/bots/${id}/close-position`, { method: 'POST' });
                    const data = await res.json();
                    if (data.success) {
                      fetchData();
                    } else {
                      alert(data.error || 'Failed to close position');
                    }
                  } catch (err) {
                    alert('Failed to close position');
                  }
                }}
                className="px-3 py-1.5 text-sm bg-red-500/20 text-red-500 hover:bg-red-500/30 rounded-md font-medium transition-colors"
              >
                Close Position
              </button>
            )}
          </div>
          {bot.config.strategySlug === 'arbitrage' && positions.length > 0 ? (
            /* Arbitrage: Show YES and NO positions in table format */
            (() => {
              const yesPosition = positions.find(p => p.outcome === 'YES');
              const noPosition = positions.find(p => p.outcome === 'NO');
              const upSize = yesPosition ? parseFloat(yesPosition.size) : 0;
              const downSize = noPosition ? parseFloat(noPosition.size) : 0;
              const upAvg = yesPosition ? parseFloat(yesPosition.avgEntryPrice) : 0;
              const downAvg = noPosition ? parseFloat(noPosition.avgEntryPrice) : 0;
              const yesRealizedPnl = yesPosition ? parseFloat(yesPosition.realizedPnl) : 0;
              const noRealizedPnl = noPosition ? parseFloat(noPosition.realizedPnl) : 0;
              const upCurrentPrice = lastTrade?.price ? parseFloat(lastTrade.price) : 0;
              const downCurrentPrice = noLastTrade?.price ? parseFloat(noLastTrade.price) : 0;
              const upUnrealizedPnl = upSize > 0 && upCurrentPrice > 0 ? (upCurrentPrice - upAvg) * upSize : 0;
              const downUnrealizedPnl = downSize > 0 && downCurrentPrice > 0 ? (downCurrentPrice - downAvg) * downSize : 0;
              const totalUnrealized = upUnrealizedPnl + downUnrealizedPnl;
              const arbRealizedPnl = yesRealizedPnl + noRealizedPnl;
              const totalPnl = totalUnrealized + arbRealizedPnl;

              // Arbitrage metrics - computed from positions
              const matchedPairs = Math.min(upSize, downSize);
              const combinedCost = (upSize * upAvg) + (downSize * downAvg);
              const combinedEntry = upAvg + downAvg;
              const expectedProfit = matchedPairs > 0 ? matchedPairs * (1 - combinedEntry) : 0;
              const roi = combinedEntry > 0 ? ((1 - combinedEntry) / combinedEntry) * 100 : 0;

              // Unhedged risk - potential loss from unmatched shares
              const unhedgedShares = Math.abs(upSize - downSize);
              const unhedgedLeg = upSize > downSize ? 'YES' : 'NO';
              const unhedgedAvgPrice = upSize > downSize ? upAvg : downAvg;
              const unhedgedRisk = unhedgedShares * unhedgedAvgPrice;

              return upSize > 0 || downSize > 0 ? (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm table-fixed">
                      <thead>
                        <tr className="text-muted-foreground border-b text-left">
                          <th className="py-2 pr-3 font-medium w-[70px]">Side</th>
                          <th className="py-2 pr-3 font-medium text-right w-[80px]">Size</th>
                          <th className="py-2 pr-3 font-medium text-right w-[90px]">Avg Entry</th>
                          <th className="py-2 pr-3 font-medium text-right w-[80px]">Current</th>
                          <th className="py-2 pr-3 font-medium text-right w-[100px]">Unrealized</th>
                          <th className="py-2 pr-3 font-medium text-right w-[90px]">Realized</th>
                          <th className="py-2 font-medium text-right w-[90px]">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* YES Row */}
                        <tr className="border-b border-muted">
                          <td className="py-2.5 pr-3">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-6 h-6 inline-flex items-center justify-center rounded bg-green-500/20 text-green-500 text-xs font-bold">Y</span>
                              <span className="font-medium">YES</span>
                            </span>
                          </td>
                          <td className="py-2.5 pr-3 text-right font-mono">{upSize.toFixed(2)}</td>
                          <td className="py-2.5 pr-3 text-right font-mono">{upAvg > 0 ? formatPrice(upAvg) : "—"}</td>
                          <td className="py-2.5 pr-3 text-right font-mono">{upCurrentPrice > 0 ? formatPrice(upCurrentPrice) : "—"}</td>
                          <td className={cn("py-2.5 pr-3 text-right font-mono", upUnrealizedPnl >= 0 ? "text-green-500" : "text-red-500")}>
                            {upSize > 0 && upCurrentPrice > 0 ? `${upUnrealizedPnl >= 0 ? "+" : ""}$${upUnrealizedPnl.toFixed(2)}` : "—"}
                          </td>
                          <td className="py-2.5 pr-3 text-right font-mono text-muted-foreground">—</td>
                          <td className="py-2.5 text-right font-mono text-muted-foreground">—</td>
                        </tr>
                        {/* NO Row */}
                        <tr className="border-b border-muted">
                          <td className="py-2.5 pr-3">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-6 h-6 inline-flex items-center justify-center rounded bg-red-500/20 text-red-500 text-xs font-bold">N</span>
                              <span className="font-medium">NO</span>
                            </span>
                          </td>
                          <td className="py-2.5 pr-3 text-right font-mono">{downSize.toFixed(2)}</td>
                          <td className="py-2.5 pr-3 text-right font-mono">{downAvg > 0 ? formatPrice(downAvg) : "—"}</td>
                          <td className="py-2.5 pr-3 text-right font-mono">{downCurrentPrice > 0 ? formatPrice(downCurrentPrice) : "—"}</td>
                          <td className={cn("py-2.5 pr-3 text-right font-mono", downUnrealizedPnl >= 0 ? "text-green-500" : "text-red-500")}>
                            {downSize > 0 && downCurrentPrice > 0 ? `${downUnrealizedPnl >= 0 ? "+" : ""}$${downUnrealizedPnl.toFixed(2)}` : "—"}
                          </td>
                          <td className="py-2.5 pr-3 text-right font-mono text-muted-foreground">—</td>
                          <td className="py-2.5 text-right font-mono text-muted-foreground">—</td>
                        </tr>
                        {/* Total Row */}
                        <tr className="bg-muted/30 font-medium">
                          <td className="py-2.5 pr-3">Total</td>
                          <td className="py-2.5 pr-3 text-right font-mono">{(upSize + downSize).toFixed(2)}</td>
                          <td className="py-2.5 pr-3 text-right font-mono">
                            {(upAvg > 0 || downAvg > 0) ? formatPrice(combinedEntry) : "—"}
                          </td>
                          <td className="py-2.5 pr-3 text-right font-mono text-muted-foreground">—</td>
                          <td className={cn("py-2.5 pr-3 text-right font-mono", totalUnrealized >= 0 ? "text-green-500" : "text-red-500")}>
                            {upCurrentPrice > 0 || downCurrentPrice > 0 ? `${totalUnrealized >= 0 ? "+" : ""}$${totalUnrealized.toFixed(2)}` : "—"}
                          </td>
                          <td className={cn("py-2.5 pr-3 text-right font-mono", arbRealizedPnl >= 0 ? "text-green-500" : "text-red-500")}>
                            {arbRealizedPnl !== 0 ? `${arbRealizedPnl >= 0 ? "+" : ""}$${arbRealizedPnl.toFixed(2)}` : "$0.00"}
                          </td>
                          <td className={cn("py-2.5 text-right font-mono", totalPnl >= 0 ? "text-green-500" : "text-red-500")}>
                            {`${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Arbitrage Metrics */}
                  <div className="border-t pt-4 grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Combined Cost</p>
                      <p className="font-mono font-medium text-lg">
                        ${combinedCost.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Matched Pairs</p>
                      <p className="font-mono font-medium text-lg">{matchedPairs.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Expected Payout</p>
                      <p className="font-mono font-medium text-lg text-green-500">${matchedPairs.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Expected Profit</p>
                      <p className={cn("font-mono font-medium text-lg", expectedProfit >= 0 ? "text-green-500" : "text-red-500")}>
                        {expectedProfit >= 0 ? "+" : ""}${expectedProfit.toFixed(2)}
                        <span className="text-xs ml-1">({roi >= 0 ? "+" : ""}{roi.toFixed(1)}%)</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Unhedged Risk</p>
                      {unhedgedShares > 0 ? (
                        <p className="font-mono font-medium text-lg text-yellow-500">
                          -${unhedgedRisk.toFixed(2)}
                          <span className="text-xs ml-1">({unhedgedShares.toFixed(0)} {unhedgedLeg})</span>
                        </p>
                      ) : (
                        <p className="font-mono font-medium text-lg text-green-500">$0.00</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">No active position</p>
              );
            })()
          ) : positionSize > 0 ? (
            /* Non-arbitrage: Single position row */
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-fixed">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="py-2 pr-3 font-medium w-[70px]">Side</th>
                    <th className="py-2 pr-3 font-medium text-right w-[80px]">Size</th>
                    <th className="py-2 pr-3 font-medium text-right w-[90px]">Avg Entry</th>
                    <th className="py-2 pr-3 font-medium text-right w-[80px]">Current</th>
                    <th className="py-2 pr-3 font-medium text-right w-[100px]">Unrealized</th>
                    <th className="py-2 pr-3 font-medium text-right w-[90px]">Realized</th>
                    <th className="py-2 font-medium text-right w-[90px]">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-2.5 pr-3">
                      <span className="font-semibold text-green-500">YES</span>
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono">{positionSize.toFixed(2)}</td>
                    <td className="py-2.5 pr-3 text-right font-mono">{formatPrice(avgPrice)}</td>
                    <td className="py-2.5 pr-3 text-right font-mono">{currentPrice > 0 ? formatPrice(currentPrice) : "—"}</td>
                    <td className={cn("py-2.5 pr-3 text-right font-mono", unrealizedPnl >= 0 ? "text-green-500" : "text-red-500")}>
                      {currentPrice > 0 ? `${unrealizedPnl >= 0 ? "+" : ""}$${unrealizedPnl.toFixed(2)}` : "—"}
                    </td>
                    <td className={cn("py-2.5 pr-3 text-right font-mono", realizedPnl >= 0 ? "text-green-500" : "text-red-500")}>
                      {realizedPnl !== 0 ? `${realizedPnl >= 0 ? "+" : ""}$${realizedPnl.toFixed(2)}` : "$0.00"}
                    </td>
                    <td className={cn("py-2.5 text-right font-mono", totalPositionPnl >= 0 ? "text-green-500" : "text-red-500")}>
                      {`${totalPositionPnl >= 0 ? "+" : ""}$${totalPositionPnl.toFixed(2)}`}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted-foreground">No active position</p>
          )}
        </div>

        {/* Market Data, Pending Orders & Recent Trades - Side by Side */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6 lg:h-[700px]">
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
            ) : bot.config.strategySlug === 'arbitrage' ? (
              /* Arbitrage Layout: YES/NO side by side with order book below */
              <div className="flex-1 overflow-auto">
                <div className="grid grid-cols-2 gap-4 mb-4">
                  {/* YES Side */}
                  <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-6 h-6 inline-flex items-center justify-center rounded bg-green-500/20 text-green-500 text-xs font-bold">
                        Y
                      </span>
                      <span className="text-sm font-medium">YES</span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">Ask</span>
                        <span className="font-mono text-red-600 font-medium">
                          {bestAsk ? formatPrice(bestAsk) : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">Bid</span>
                        <span className="font-mono text-green-600 font-medium">
                          {bestBid ? formatPrice(bestBid) : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center border-t pt-2">
                        <span className="text-xs text-muted-foreground">Last</span>
                        <span className="font-mono font-medium">
                          {lastTrade ? formatPrice(lastTrade.price) : "—"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* NO Side */}
                  <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-6 h-6 inline-flex items-center justify-center rounded bg-red-500/20 text-red-500 text-xs font-bold">
                        N
                      </span>
                      <span className="text-sm font-medium">NO</span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">Ask</span>
                        <span className="font-mono text-red-600 font-medium">
                          {noBestAsk ? formatPrice(noBestAsk) : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">Bid</span>
                        <span className="font-mono text-green-600 font-medium">
                          {noBestBid ? formatPrice(noBestBid) : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center border-t pt-2">
                        <span className="text-xs text-muted-foreground">Last</span>
                        <span className="font-mono font-medium">
                          {noLastTrade ? formatPrice(noLastTrade.price) : "—"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Combined Metrics - under the bid/ask cards */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Combined Cost</p>
                    <p className="text-lg font-semibold font-mono">
                      {lastTrade && noLastTrade
                        ? `$${(parseFloat(lastTrade.price) + parseFloat(noLastTrade.price)).toFixed(4)}`
                        : "—"}
                    </p>
                    {lastTrade && noLastTrade && (
                      <p className={cn(
                        "text-xs",
                        parseFloat(lastTrade.price) + parseFloat(noLastTrade.price) < 1
                          ? "text-green-500"
                          : "text-red-500"
                      )}>
                        {parseFloat(lastTrade.price) + parseFloat(noLastTrade.price) < 1
                          ? `${((1 - parseFloat(lastTrade.price) - parseFloat(noLastTrade.price)) * 100).toFixed(2)}% profit`
                          : `${((parseFloat(lastTrade.price) + parseFloat(noLastTrade.price) - 1) * 100).toFixed(2)}% loss`}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Total Spread</p>
                    <p className="text-lg font-semibold font-mono">
                      {bestBid && bestAsk && noBestBid && noBestAsk
                        ? `${(((parseFloat(bestAsk) - parseFloat(bestBid)) + (parseFloat(noBestAsk) - parseFloat(noBestBid))) * 100).toFixed(2)}%`
                        : "—"}
                    </p>
                  </div>
                </div>

                {/* Order Book Table */}
                {orderBook && (
                  <div className="border-t pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-muted-foreground">
                        UP Order Book (Top 10)
                      </h3>
                      <span className="text-xs text-green-500 inline-flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                        Live
                      </span>
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

                      const buyOrderPrices = new Set(
                        activeOrders
                          .filter((o) => o.side === "BUY" && o.outcome === "YES")
                          .map((o) => parseFloat(o.price))
                      );
                      const sellOrderPrices = new Set(
                        activeOrders
                          .filter((o) => o.side === "SELL" && o.outcome === "YES")
                          .map((o) => parseFloat(o.price))
                      );

                      return (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-muted-foreground border-b">
                              <th className="text-left py-1 px-1">Bid Size</th>
                              <th className="text-left py-1 px-1">Bid</th>
                              <th className="text-right py-1 px-1">Ask</th>
                              <th className="text-right py-1 px-1">Ask Size</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Array.from({ length: 10 }).map((_, i) => {
                              const bid = topBids[i];
                              const ask = topAsks[i];
                              const hasBuyOrder = bid && buyOrderPrices.has(parseFloat(bid.price));
                              const hasSellOrder = ask && sellOrderPrices.has(parseFloat(ask.price));
                              return (
                                <tr key={i} className="border-b border-muted last:border-0">
                                  <td className={cn("py-1 px-1 text-green-600", hasBuyOrder && "bg-blue-500/10")}>
                                    {bid?.size ? parseFloat(bid.size).toLocaleString() : "—"}
                                  </td>
                                  <td className={cn("py-1 px-1 text-green-600 font-medium", hasBuyOrder && "bg-blue-500/10")}>
                                    {bid?.price ? formatPrice(bid.price) : "—"}
                                  </td>
                                  <td className={cn("py-1 px-1 text-right text-red-600 font-medium", hasSellOrder && "bg-blue-500/10")}>
                                    {ask?.price ? formatPrice(ask.price) : "—"}
                                  </td>
                                  <td className={cn("py-1 px-1 text-right text-red-600", hasSellOrder && "bg-blue-500/10")}>
                                    {ask?.size ? parseFloat(ask.size).toLocaleString() : "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      );
                    })()}
                  </div>
                )}
              </div>
            ) : (
              /* Standard Layout: Single asset */
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

                      // Get active order prices for highlighting (normalize to numbers for comparison)
                      const buyOrderPrices = new Set(
                        activeOrders
                          .filter((o) => o.side === "BUY")
                          .map((o) => parseFloat(o.price))
                      );
                      const sellOrderPrices = new Set(
                        activeOrders
                          .filter((o) => o.side === "SELL")
                          .map((o) => parseFloat(o.price))
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
                                const hasBuyOrder = bid && buyOrderPrices.has(parseFloat(bid.price));
                                const hasSellOrder = ask && sellOrderPrices.has(parseFloat(ask.price));
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
                                      {bid?.price ? formatPrice(bid.price) : "—"}
                                    </td>
                                    <td className={cn(
                                      "py-1.5 px-2 text-right text-red-600 font-medium",
                                      hasSellOrder && "bg-blue-500/10"
                                    )}>
                                      {ask?.price ? formatPrice(ask.price) : "—"}
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
              <table className="w-full text-sm table-fixed">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="text-muted-foreground border-b">
                    <th
                      className="text-left py-2 px-1 cursor-pointer hover:text-foreground select-none w-[65px] bg-card"
                      onClick={() => handleOrderSort('side')}
                    >
                      <span className="inline-flex items-center gap-0.5">
                        Side
                        {orderSortColumn === 'side' && (orderSortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                      </span>
                    </th>
                    <th
                      className="text-left py-2 px-1 cursor-pointer hover:text-foreground select-none w-[28px] bg-card"
                      onClick={() => handleOrderSort('outcome')}
                    >
                      <span className="inline-flex items-center gap-0.5">
                        {orderSortColumn === 'outcome' && (orderSortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                      </span>
                    </th>
                    <th
                      className="text-right py-2 px-1 cursor-pointer hover:text-foreground select-none bg-card"
                      onClick={() => handleOrderSort('price')}
                    >
                      <span className="inline-flex items-center gap-0.5 justify-end">
                        Price
                        {orderSortColumn === 'price' && (orderSortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                      </span>
                    </th>
                    <th
                      className="text-right py-2 px-1 cursor-pointer hover:text-foreground select-none w-[70px] bg-card"
                      onClick={() => handleOrderSort('quantity')}
                    >
                      <span className="inline-flex items-center gap-0.5 justify-end">
                        Remaining
                        {orderSortColumn === 'quantity' && (orderSortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                      </span>
                    </th>
                    <th
                      className="text-left py-2 px-1 cursor-pointer hover:text-foreground select-none w-[50px] bg-card"
                      onClick={() => handleOrderSort('status')}
                    >
                      <span className="inline-flex items-center gap-0.5">
                        {orderSortColumn === 'status' && (orderSortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                      </span>
                    </th>
                    <th
                      className="text-left py-2 px-1 cursor-pointer hover:text-foreground select-none w-[60px] bg-card"
                      onClick={() => handleOrderSort('latest')}
                    >
                      <span className="inline-flex items-center gap-0.5">
                        Time
                        {orderSortColumn === 'latest' && (orderSortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortOrders(aggregateOrders(activeOrders)).map((order) => {
                    return (
                      <tr key={`${order.price}-${order.side}-${order.outcome}`} className="border-b border-muted last:border-0">
                        <td className="py-1.5 px-1">
                          <span
                            className={cn(
                              "px-1.5 py-0.5 rounded text-xs font-medium",
                              order.side === "BUY" ? "bg-green-500/20 text-green-500" : "bg-red-500/20 text-red-500"
                            )}
                          >
                            {order.side}
                            {order.orderCount > 1 && (
                              <span className="ml-1 opacity-70">({order.orderCount})</span>
                            )}
                          </span>
                        </td>
                        <td className="py-1.5 px-1">
                          <span
                            className={cn(
                              "w-5 h-5 inline-flex items-center justify-center rounded text-xs font-medium",
                              order.outcome === "YES" ? "bg-green-500/20 text-green-500" : "bg-red-500/20 text-red-500"
                            )}
                          >
                            {order.outcome === "YES" ? "Y" : "N"}
                          </span>
                        </td>
                        <td className="py-1.5 px-1 text-right font-mono">
                          {formatPrice(order.price)}
                        </td>
                        <td className="py-1.5 px-1 text-right font-mono text-xs">
                          <span className={order.totalFilled > 0 ? "text-yellow-500" : ""}>
                            {(order.totalQuantity - order.totalFilled).toFixed(0)}
                          </span>
                          <span className="text-muted-foreground">/{order.totalQuantity.toFixed(0)}</span>
                        </td>
                        <td className="py-1.5 px-1">
                          <span
                            className={cn(
                              "w-2 h-2 inline-block rounded-full",
                              !order.hasPartialFill && "bg-blue-500",
                              order.hasPartialFill && "bg-yellow-500"
                            )}
                            title={order.hasPartialFill ? "Partial fill" : "Open"}
                          />
                        </td>
                        <td className="py-1.5 px-1 text-muted-foreground text-xs">
                          {order.latestCreatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          </div>

          {/* Recent Trades */}
          <div className="bg-card border rounded-lg p-6 flex flex-col h-full overflow-hidden">
            <h2 className="font-semibold mb-4 flex-shrink-0">Recent Trades</h2>
            <div className="flex-1 overflow-auto">
              <TradesTable trades={trades} formatPrice={formatPrice} />
            </div>
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
