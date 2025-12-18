"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BotCreateModal } from "@/components/bots";
import {
  ArrowLeft,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Calendar,
  ExternalLink,
  Plus,
} from "lucide-react";
import { getWebSocket } from "@/lib/polymarket/websocket";
import type { Market, OrderBook, OrderBookEntry } from "@/lib/polymarket/types";
import { cn } from "@/lib/utils";

interface MarketDetailClientProps {
  initialMarket: Market;
}

// Helper to parse JSON string arrays from API
function parseJsonArray<T>(value: T[] | string | undefined): T[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// Helper to get outcome price from potentially stringified array
function getOutcomePrice(
  outcomePrices: string[] | string | undefined,
  index: number
): string {
  const prices = parseJsonArray(outcomePrices);
  return prices?.[index] || "0";
}

// Order book polling interval in milliseconds
const ORDER_BOOK_POLL_INTERVAL = 3000;

export function MarketDetailClient({ initialMarket }: MarketDetailClientProps) {
  const [market, setMarket] = useState<Market>(initialMarket);
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const [yesPrice, setYesPrice] = useState<string>(
    getOutcomePrice(initialMarket.outcomePrices, 0)
  );
  const [noPrice, setNoPrice] = useState<string>(
    getOutcomePrice(initialMarket.outcomePrices, 1)
  );
  const [liveBestBid, setLiveBestBid] = useState<string | null>(null);
  const [liveBestAsk, setLiveBestAsk] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastOrderBookUpdate, setLastOrderBookUpdate] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Refresh market data
  const refreshMarket = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch(`/api/markets/${initialMarket.id}`);
      const data = await response.json();
      if (data.success) {
        setMarket(data.data);
        setYesPrice(getOutcomePrice(data.data.outcomePrices, 0));
        setNoPrice(getOutcomePrice(data.data.outcomePrices, 1));
      }
    } catch (error) {
      console.error("Failed to refresh market:", error);
    } finally {
      setIsRefreshing(false);
    }
  }, [initialMarket.id]);

  // Fetch order book from CLOB API
  const fetchOrderBook = useCallback(async (tokenId: string) => {
    try {
      const response = await fetch(`/api/orderbook?token_id=${encodeURIComponent(tokenId)}`);
      const data = await response.json();
      if (data.success && data.data) {
        // CLOB API returns { bids: [...], asks: [...] }
        setOrderBook({
          market: initialMarket.id,
          asset_id: tokenId,
          bids: data.data.bids || [],
          asks: data.data.asks || [],
          timestamp: new Date().toISOString(),
        });
        setLastOrderBookUpdate(Date.now());

        // Update live best bid/ask from the order book
        if (data.data.bids?.length > 0) {
          const sortedBids = [...data.data.bids].sort(
            (a: { price: string }, b: { price: string }) =>
              parseFloat(b.price) - parseFloat(a.price)
          );
          setLiveBestBid(sortedBids[0].price);
        }
        if (data.data.asks?.length > 0) {
          const sortedAsks = [...data.data.asks].sort(
            (a: { price: string }, b: { price: string }) =>
              parseFloat(a.price) - parseFloat(b.price)
          );
          setLiveBestAsk(sortedAsks[0].price);
        }
      }
    } catch (error) {
      console.error("Failed to fetch order book:", error);
    }
  }, [initialMarket.id]);

  // WebSocket subscription
  useEffect(() => {
    const ws = getWebSocket();
    const assetIds = parseJsonArray(market.clobTokenIds) || [];

    if (assetIds.length === 0) {
      return;
    }

    ws.connect()
      .then(() => {
        setIsConnected(true);

        // Subscribe to order book updates
        ws.subscribeOrderBook(assetIds, (book) => {
          setOrderBook(book);
        });

        // Subscribe to price updates (includes best bid/ask)
        ws.subscribePrice(assetIds, (assetId, price, bestBid, bestAsk) => {
          const index = assetIds.indexOf(assetId);
          if (index === 0) {
            setYesPrice(price);
            // Update live best bid/ask from YES token
            if (bestBid) setLiveBestBid(bestBid);
            if (bestAsk) setLiveBestAsk(bestAsk);
          } else if (index === 1) {
            setNoPrice(price);
          }
        });
      })
      .catch((error) => {
        console.error("WebSocket connection failed:", error);
        setIsConnected(false);
      });

    return () => {
      ws.unsubscribe(assetIds);
    };
  }, [market.clobTokenIds]);

  // Poll order book periodically for real-time depth updates
  useEffect(() => {
    const assetIds = parseJsonArray(market.clobTokenIds) || [];
    const yesTokenId = assetIds[0];

    if (!yesTokenId) {
      return;
    }

    // Fetch immediately on mount
    fetchOrderBook(yesTokenId);

    // Set up polling interval
    const pollInterval = setInterval(() => {
      fetchOrderBook(yesTokenId);
    }, ORDER_BOOK_POLL_INTERVAL);

    return () => {
      clearInterval(pollInterval);
    };
  }, [market.clobTokenIds, fetchOrderBook]);

  // Format helpers
  const formatPrice = (price: string | number) => {
    const num = typeof price === "string" ? parseFloat(price) : price;
    return (num * 100).toFixed(1);
  };

  const formatPriceChange = (change: number | undefined) => {
    if (change === undefined || change === null || isNaN(change)) return "N/A";
    const pct = (change * 100).toFixed(2);
    return change >= 0 ? `+${pct}%` : `${pct}%`;
  };

  const formatVolume = (volume: string | number | undefined) => {
    if (!volume) return "$0";
    const num = typeof volume === "string" ? parseFloat(volume) : volume;
    if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
    return `$${num.toLocaleString()}`;
  };

  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return "N/A";
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "N/A";
    }
  };

  const truncateId = (id: string, length = 12) => {
    if (!id) return "N/A";
    if (id.length <= length) return id;
    return `${id.slice(0, length)}...`;
  };

  // Get top 10 bids (highest first) and asks (lowest first)
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

  // Calculate best bid/ask - prefer live data, then order book, then market data
  const bestBid = liveBestBid || topBids[0]?.price || market.bestBid?.toString() || "0";
  const bestAsk = liveBestAsk || topAsks[0]?.price || market.bestAsk?.toString() || "0";
  const spread = market.spread
    ? (market.spread * 100).toFixed(2)
    : (
        (parseFloat(bestAsk) - parseFloat(bestBid)) *
        100
      ).toFixed(2);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link href="/dashboard">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>

            <div className="flex items-center gap-3">
              {/* Connection Status */}
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

              <Button
                variant="outline"
                size="sm"
                onClick={refreshMarket}
                disabled={isRefreshing}
              >
                <RefreshCw
                  className={cn("w-4 h-4", isRefreshing && "animate-spin")}
                />
              </Button>

              <Button onClick={() => setShowCreateModal(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create Bot
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Market Title Section */}
        <div className="bg-card border rounded-lg p-6">
          <div className="flex gap-4">
            {market.image && (
              <img
                src={market.image}
                alt=""
                className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
              />
            )}
            <div className="flex-1">
              <div className="flex items-start justify-between gap-4">
                <h1 className="text-xl font-semibold">{market.question}</h1>
                <span
                  className={cn(
                    "px-2 py-1 text-xs rounded-full flex-shrink-0",
                    market.active
                      ? "bg-green-500/10 text-green-600"
                      : market.closed
                        ? "bg-red-500/10 text-red-600"
                        : "bg-yellow-500/10 text-yellow-600"
                  )}
                >
                  {market.active ? "Active" : market.closed ? "Closed" : "Inactive"}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
                {market.category && (
                  <span className="bg-muted px-2 py-0.5 rounded">
                    {market.category}
                  </span>
                )}
                {market.endDate && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    Ends: {formatDate(market.endDate)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Live Prices */}
        <div className="bg-card border rounded-lg p-6">
          <h2 className="text-sm font-medium text-muted-foreground mb-4">
            Live Prices
          </h2>
          <div className="grid grid-cols-2 gap-6">
            {/* YES Price */}
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 text-center">
              <p className="text-sm text-muted-foreground mb-1">YES</p>
              <p className="text-3xl font-bold text-green-600">
                {formatPrice(yesPrice)}%
              </p>
              <p
                className={cn(
                  "text-sm mt-1",
                  (market.oneDayPriceChange || 0) >= 0
                    ? "text-green-600"
                    : "text-red-600"
                )}
              >
                {market.oneDayPriceChange !== undefined && (
                  <>
                    {market.oneDayPriceChange >= 0 ? (
                      <TrendingUp className="w-3 h-3 inline mr-1" />
                    ) : (
                      <TrendingDown className="w-3 h-3 inline mr-1" />
                    )}
                    {formatPriceChange(market.oneDayPriceChange)} (24h)
                  </>
                )}
              </p>
            </div>

            {/* NO Price */}
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-center">
              <p className="text-sm text-muted-foreground mb-1">NO</p>
              <p className="text-3xl font-bold text-red-600">
                {formatPrice(noPrice)}%
              </p>
              <p className="text-sm mt-1 text-muted-foreground">
                {market.oneDayPriceChange !== undefined && (
                  <>
                    {market.oneDayPriceChange <= 0 ? (
                      <TrendingUp className="w-3 h-3 inline mr-1" />
                    ) : (
                      <TrendingDown className="w-3 h-3 inline mr-1" />
                    )}
                    {formatPriceChange(
                      market.oneDayPriceChange ? -market.oneDayPriceChange : 0
                    )}{" "}
                    (24h)
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Best Bid/Ask/Spread */}
          <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t">
            <div>
              <p className="text-xs text-muted-foreground">Best Bid</p>
              <p className="font-semibold text-green-600">{bestBid}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Best Ask</p>
              <p className="font-semibold text-red-600">{bestAsk}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Spread</p>
              <p className="font-semibold">{spread}%</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Last Trade</p>
              <p className="font-semibold">
                {market.lastTradePrice?.toFixed(3) || "N/A"}
              </p>
            </div>
          </div>
        </div>

        {/* Price Changes */}
        <div className="bg-card border rounded-lg p-6">
          <h2 className="text-sm font-medium text-muted-foreground mb-4">
            Price Changes
          </h2>
          <div className="flex gap-4 flex-wrap">
            {[
              { label: "1hr", value: market.oneHourPriceChange },
              { label: "1d", value: market.oneDayPriceChange },
              { label: "1wk", value: market.oneWeekPriceChange },
              { label: "1mo", value: market.oneMonthPriceChange },
              { label: "1yr", value: market.oneYearPriceChange },
            ].map(({ label, value }) => (
              <div key={label} className="bg-muted rounded-md px-4 py-2">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p
                  className={cn(
                    "font-medium",
                    value === undefined || value === null
                      ? "text-muted-foreground"
                      : value >= 0
                        ? "text-green-600"
                        : "text-red-600"
                  )}
                >
                  {formatPriceChange(value)}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Volume & Liquidity */}
        <div className="bg-card border rounded-lg p-6">
          <h2 className="text-sm font-medium text-muted-foreground mb-4">
            Volume & Liquidity
          </h2>
          <div className="grid grid-cols-2 gap-6 mb-4">
            <div>
              <p className="text-xs text-muted-foreground">Total Volume</p>
              <p className="text-2xl font-bold">{formatVolume(market.volume)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Liquidity</p>
              <p className="text-2xl font-bold">
                {formatVolume(market.liquidity)}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-4 pt-4 border-t">
            <div>
              <p className="text-xs text-muted-foreground">24hr</p>
              <p className="font-medium">{formatVolume(market.volume24hr)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">1 Week</p>
              <p className="font-medium">{formatVolume(market.volume1wk)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">1 Month</p>
              <p className="font-medium">{formatVolume(market.volume1mo)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">1 Year</p>
              <p className="font-medium">{formatVolume(market.volume1yr)}</p>
            </div>
          </div>
        </div>

        {/* Order Book */}
        <div className="bg-card border rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-muted-foreground">
              Order Book (Top 10)
              {orderBook && (
                <span className="ml-2 text-xs text-green-500 inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  Live
                </span>
              )}
            </h2>
            {lastOrderBookUpdate && (
              <span className="text-xs text-muted-foreground">
                Updated: {new Date(lastOrderBookUpdate).toLocaleTimeString()}
              </span>
            )}
          </div>
          {topBids.length === 0 && topAsks.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {isConnected
                ? "Loading order book..."
                : "Connecting to live feed..."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left py-2 px-2">Bid Size</th>
                    <th className="text-left py-2 px-2">Bid Price</th>
                    <th className="text-right py-2 px-2">Ask Price</th>
                    <th className="text-right py-2 px-2">Ask Size</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 10 }).map((_, i) => {
                    const bid: OrderBookEntry | undefined = topBids[i];
                    const ask: OrderBookEntry | undefined = topAsks[i];
                    return (
                      <tr key={i} className="border-b border-muted">
                        <td className="py-2 px-2 text-green-600">
                          {bid?.size
                            ? parseFloat(bid.size).toLocaleString()
                            : "-"}
                        </td>
                        <td className="py-2 px-2 text-green-600 font-medium">
                          {bid?.price || "-"}
                        </td>
                        <td className="py-2 px-2 text-right text-red-600 font-medium">
                          {ask?.price || "-"}
                        </td>
                        <td className="py-2 px-2 text-right text-red-600">
                          {ask?.size
                            ? parseFloat(ask.size).toLocaleString()
                            : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Market Details */}
        <div className="bg-card border rounded-lg p-6">
          <h2 className="text-sm font-medium text-muted-foreground mb-4">
            Market Details
          </h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Market ID</p>
              <p className="font-mono">{truncateId(market.id, 20)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Condition ID</p>
              <p className="font-mono">{truncateId(market.conditionId, 20)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Slug</p>
              <p className="font-mono">{market.slug || "N/A"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Creator</p>
              <p className="font-mono">{truncateId(market.creator, 16)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Created</p>
              <p>{formatDate(market.createdAt)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Last Updated</p>
              <p>{formatDate(market.updatedAt)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Market Type</p>
              <p>{market.marketType || "Standard"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Outcomes</p>
              <p>{parseJsonArray(market.outcomes)?.join(" / ") || "YES / NO"}</p>
            </div>
          </div>

          {/* Polymarket Link */}
          {market.slug && (
            <div className="mt-4 pt-4 border-t">
              <a
                href={`https://polymarket.com/market/${market.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-blue-500 hover:underline"
              >
                View on Polymarket
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>

        {/* Description */}
        {market.description && (
          <div className="bg-card border rounded-lg p-6">
            <h2 className="text-sm font-medium text-muted-foreground mb-4">
              Description
            </h2>
            <p className="text-sm whitespace-pre-wrap">{market.description}</p>
          </div>
        )}
      </div>

      {/* Create Bot Modal */}
      <BotCreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        defaultMarketId={market.id}
        defaultMarketName={market.question}
        defaultAssetId={parseJsonArray(market.clobTokenIds)?.[0] || ""}
      />
    </div>
  );
}
