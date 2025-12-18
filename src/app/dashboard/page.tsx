"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BotList, BotCreateModal } from "@/components/bots";
import { RefreshCw, AlertCircle, Wallet, DollarSign, Search, ChevronLeft, ChevronRight, Bot, Plus, TrendingUp, Briefcase } from "lucide-react";
import type { BotInstance } from "@/lib/bots/types";

interface BotStatus {
  configured: boolean;
  config: {
    funderAddress: string;
    chainId: number;
    clobHost: string;
    gammaHost: string;
  };
  marketMaker: {
    activeMarkets: number;
  };
  arbitrage: {
    monitoredMarkets: number;
    opportunities: Array<{
      markets: string[];
      spread: number;
      expectedProfit: number;
    }>;
  };
  portfolio?: {
    totalValue: number;
    cashBalance: number;
    positionsValue: number;
  };
}

interface Market {
  id: string;
  question: string;
  outcomePrices?: string[];
  volume?: string;
  active: boolean;
}

interface SearchPagination {
  hasMore: boolean;
  page: number;
}

interface AccountPosition {
  asset: string;
  conditionId: string;
  size: string;
  avgPrice: string;
  currentPrice?: string;
  pnl?: string;
  outcome: string;
  marketQuestion?: string;
}

export default function DashboardPage() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [bots, setBots] = useState<BotInstance[]>([]);
  const [positions, setPositions] = useState<AccountPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState<SearchPagination>({ hasMore: false, page: 1 });
  const [hasSearched, setHasSearched] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const statusRes = await fetch("/api/bot/status");
      const statusData = await statusRes.json();

      if (statusData.success) {
        setStatus(statusData.data);
      } else {
        setError(statusData.error || "Failed to fetch status");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch status");
    }
  }, []);

  const fetchBots = useCallback(async () => {
    try {
      const botsRes = await fetch("/api/bots");
      const botsData = await botsRes.json();

      if (botsData.success) {
        setBots(botsData.data);
      }
    } catch (err) {
      console.error("Failed to fetch bots:", err);
    }
  }, []);

  const fetchPositions = useCallback(async () => {
    try {
      const posRes = await fetch("/api/positions");
      const posData = await posRes.json();

      if (posData.success && posData.data?.positions) {
        setPositions(posData.data.positions);
      }
    } catch (err) {
      console.error("Failed to fetch positions:", err);
    }
  }, []);

  const searchMarkets = useCallback(async (query: string, page: number) => {
    if (!query.trim()) {
      setMarkets([]);
      setPagination({ hasMore: false, page: 1 });
      setHasSearched(false);
      return;
    }

    setSearchLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/markets/search?q=${encodeURIComponent(query)}&page=${page}&limit=20`);
      const data = await res.json();

      if (data.success) {
        setMarkets(data.data || []);
        setPagination(data.pagination || { hasMore: false, page });
        setHasSearched(true);
      } else {
        setError(data.error || "Failed to search markets");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to search markets");
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPage(1);
    searchMarkets(searchQuery, 1);
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    searchMarkets(searchQuery, newPage);
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchStatus(), fetchBots(), fetchPositions()]).finally(() => setLoading(false));

    // Refresh status every 30 seconds, bots every 5 seconds, positions every 30 seconds
    const statusInterval = setInterval(fetchStatus, 30000);
    const botsInterval = setInterval(fetchBots, 5000);
    const positionsInterval = setInterval(fetchPositions, 30000);
    return () => {
      clearInterval(statusInterval);
      clearInterval(botsInterval);
      clearInterval(positionsInterval);
    };
  }, [fetchStatus, fetchBots, fetchPositions]);

  const portfolioValue = status?.portfolio?.totalValue ?? 0;
  const cashBalance = status?.portfolio?.cashBalance ?? 0;
  const positionsValue = status?.portfolio?.positionsValue ?? 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Top Status Bar */}
      <div className="bg-card border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-8">
              {/* Portfolio Value */}
              <div className="flex items-center gap-2">
                <Wallet className="w-5 h-5 text-blue-500" />
                <div>
                  <p className="text-xs text-muted-foreground">Portfolio</p>
                  <p className="text-xl font-bold">${portfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
              </div>

              {/* Cash Balance */}
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-500" />
                <div>
                  <p className="text-xs text-muted-foreground">Cash</p>
                  <p className="text-xl font-bold">${cashBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
              </div>

              {/* Positions Value */}
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-purple-500" />
                <div>
                  <p className="text-xs text-muted-foreground">Positions</p>
                  <p className="text-xl font-bold">${positionsValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* Connection Status */}
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${status?.configured ? "bg-green-500" : "bg-yellow-500"}`} />
                <span className="text-sm text-muted-foreground">
                  {status?.configured ? "Connected" : "Not configured"}
                </span>
              </div>

              <Button onClick={() => fetchStatus()} disabled={loading} variant="outline" size="sm">
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-card border-b">
        <div className="max-w-6xl mx-auto px-8 py-4">
          <form onSubmit={handleSearch} className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search Polymarket markets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button type="submit" disabled={searchLoading}>
              {searchLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                "Search"
              )}
            </Button>
          </form>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-8">

        {/* Error Banner */}
        {error && (
          <div className="bg-destructive/10 border border-destructive rounded-lg p-4 mb-6 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-destructive" />
            <span className="text-destructive">{error}</span>
          </div>
        )}

        {/* Running Bots Section */}
        <div className="bg-card border rounded-lg mb-8">
          <div className="p-6 border-b flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bot className="w-5 h-5 text-blue-500" />
              <div>
                <h2 className="font-semibold">Trading Bots</h2>
                <p className="text-sm text-muted-foreground">
                  {bots.filter(b => b.state === "running").length} running,{" "}
                  {bots.filter(b => b.state === "paused").length} paused,{" "}
                  {bots.filter(b => b.state === "stopped").length} stopped
                </p>
              </div>
            </div>
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Bot
            </Button>
          </div>
          <div className="p-6">
            <BotList
              bots={bots}
              onStateChange={fetchBots}
              emptyMessage="No bots created yet. Click 'Create Bot' to get started."
            />
          </div>
        </div>

        {/* Active Positions Section */}
        <div className="bg-card border rounded-lg mb-8">
          <div className="p-6 border-b flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Briefcase className="w-5 h-5 text-purple-500" />
              <div>
                <h2 className="font-semibold">Active Positions</h2>
                <p className="text-sm text-muted-foreground">
                  {positions.length} position{positions.length !== 1 ? "s" : ""} on Polymarket
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={fetchPositions}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
          <div className="p-6">
            {positions.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">
                {status?.configured
                  ? "No active positions found"
                  : "Connect your Polymarket account to view positions"}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-4">Asset</th>
                      <th className="pb-2 pr-4">Outcome</th>
                      <th className="pb-2 pr-4 text-right">Size</th>
                      <th className="pb-2 pr-4 text-right">Avg Price</th>
                      <th className="pb-2 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((pos, idx) => {
                      const size = parseFloat(pos.size);
                      const avgPrice = parseFloat(pos.avgPrice);
                      const value = size * avgPrice;
                      return (
                        <tr key={idx} className="border-b last:border-0">
                          <td className="py-2 pr-4 truncate max-w-[200px]">
                            {pos.marketQuestion || pos.asset.slice(0, 16) + '...'}
                          </td>
                          <td className="py-2 pr-4">
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-medium ${
                                pos.outcome === "YES"
                                  ? "bg-green-500/20 text-green-500"
                                  : "bg-red-500/20 text-red-500"
                              }`}
                            >
                              {pos.outcome}
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-right font-mono">
                            {size.toFixed(2)}
                          </td>
                          <td className="py-2 pr-4 text-right font-mono">
                            ${avgPrice.toFixed(4)}
                          </td>
                          <td className="py-2 text-right font-mono">
                            ${value.toFixed(2)}
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

        {/* Bot Create Modal */}
        <BotCreateModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onCreated={fetchBots}
        />

        {/* Markets List */}
        <div className="bg-card border rounded-lg">
          <div className="p-6 border-b">
            <h2 className="font-semibold">
              {hasSearched ? "Search Results" : "Markets"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {hasSearched
                ? `Found ${markets.length} market${markets.length !== 1 ? "s" : ""} for "${searchQuery}"`
                : "Search for markets using the search bar above"}
            </p>
          </div>
          <div className="divide-y">
            {searchLoading && (
              <div className="p-6 text-center text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                Searching...
              </div>
            )}
            {!searchLoading && markets.length === 0 && (
              <div className="p-6 text-center text-muted-foreground">
                {hasSearched
                  ? "No markets found. Try a different search term."
                  : "Enter a search term to find markets"}
              </div>
            )}
            {!searchLoading && markets.map((market) => (
              <Link
                key={market.id}
                href={`/market/${market.id}`}
                className="block p-4 hover:bg-muted/50 transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 mr-4">
                    <p className="font-medium line-clamp-2">
                      {market.question}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      ID: {market.id.slice(0, 16)}...
                    </p>
                  </div>
                  <div className="text-right">
                    {market.outcomePrices && market.outcomePrices.length >= 2 && (
                      <div className="flex gap-4 text-sm">
                        <span className="text-green-600">
                          YES: {(parseFloat(market.outcomePrices[0]) * 100).toFixed(1)}%
                        </span>
                        <span className="text-red-600">
                          NO: {(parseFloat(market.outcomePrices[1]) * 100).toFixed(1)}%
                        </span>
                      </div>
                    )}
                    {market.volume && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Vol: ${parseFloat(market.volume).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/* Pagination Controls */}
          {hasSearched && markets.length > 0 && (
            <div className="p-4 border-t flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage <= 1 || searchLoading}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {currentPage}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={!pagination.hasMore || searchLoading}
              >
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-muted-foreground">
          <p>
            Built with{" "}
            <a
              href="https://github.com/HuakunShen/polymarket-kit"
              className="underline hover:text-foreground"
              target="_blank"
              rel="noopener noreferrer"
            >
              polymarket-kit
            </a>{" "}
            &{" "}
            <a
              href="https://github.com/Polymarket/clob-client"
              className="underline hover:text-foreground"
              target="_blank"
              rel="noopener noreferrer"
            >
              @polymarket/clob-client
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
