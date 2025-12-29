"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BotList, BotCreateModal } from "@/components/bots";
import { TradesTable } from "@/components/trades";
import {
  ArrowLeft,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Activity,
  Plus,
} from "lucide-react";
import type { StrategyDefinition, BotInstance, Trade, StrategyStats } from "@/lib/bots/types";

interface StrategyData {
  strategy: StrategyDefinition;
  stats: StrategyStats & { totalBots: number; activeBots: number };
  bots: {
    active: BotInstance[];
    stopped: BotInstance[];
  };
  trades: Trade[];
}

export default function StrategyDetailPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [data, setData] = useState<StrategyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchStrategy = useCallback(async () => {
    try {
      const res = await fetch(`/api/strategies/${slug}?tradesLimit=50`);
      const result = await res.json();

      if (result.success) {
        setData(result.data);
        setError(null);
      } else {
        setError(result.error || "Failed to fetch strategy");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch strategy");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchStrategy();
    const interval = setInterval(fetchStrategy, 5000);
    return () => clearInterval(interval);
  }, [fetchStrategy]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="max-w-4xl mx-auto">
          <Link href="/dashboard" className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6">
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
          <div className="bg-destructive/10 border border-destructive rounded-lg p-6">
            <p className="text-destructive">{error || "Strategy not found"}</p>
          </div>
        </div>
      </div>
    );
  }

  const { strategy, stats, bots, trades } = data;
  const totalPnl = parseFloat(stats.totalPnl);

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
                <h1 className="text-xl font-bold">{strategy.name}</h1>
                <p className="text-sm text-muted-foreground">
                  v{strategy.version} {strategy.author && `by ${strategy.author}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={fetchStrategy}>
                <RefreshCw className="w-4 h-4" />
              </Button>
              <Button onClick={() => setShowCreateModal(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create Bot
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-8">
        {/* Active Bots */}
        {bots.active.length > 0 && (
          <div className="bg-card border rounded-lg p-6 mb-6">
            <h2 className="font-semibold mb-4">Active Bots</h2>
            <BotList bots={bots.active} onStateChange={fetchStrategy} />
          </div>
        )}

        {/* Stopped Bots */}
        {bots.stopped.length > 0 && (
          <div className="bg-card border rounded-lg p-6 mb-6">
            <h2 className="font-semibold mb-4">Stopped Bots</h2>
            <BotList bots={bots.stopped} onStateChange={fetchStrategy} />
          </div>
        )}

        {/* Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-card border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Win Rate</span>
            </div>
            <p className="text-2xl font-bold">{stats.winRate.toFixed(1)}%</p>
          </div>

          <div className="bg-card border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              {totalPnl >= 0 ? (
                <TrendingUp className="w-4 h-4 text-green-500" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-500" />
              )}
              <span className="text-xs text-muted-foreground">Total PnL</span>
            </div>
            <p className={`text-2xl font-bold ${totalPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
              ${totalPnl.toFixed(2)}
            </p>
          </div>

          <div className="bg-card border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Trades</span>
            </div>
            <p className="text-2xl font-bold">{stats.totalTrades}</p>
          </div>

          <div className="bg-card border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-muted-foreground">Active Bots</span>
            </div>
            <p className="text-2xl font-bold text-green-500">{stats.activeBots}</p>
          </div>

          <div className="bg-card border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-muted-foreground">Total Bots</span>
            </div>
            <p className="text-2xl font-bold">{stats.totalBots}</p>
          </div>
        </div>

        {/* Description */}
        <div className="bg-card border rounded-lg p-6 mb-6">
          <h2 className="font-semibold mb-3">Description</h2>
          <p className="text-muted-foreground whitespace-pre-wrap">
            {strategy.description}
          </p>
        </div>

        {/* Historical Trades */}
        <div className="bg-card border rounded-lg p-6">
          <h2 className="font-semibold mb-4">Recent Trades</h2>
          <div className="max-h-[400px] overflow-auto">
            <TradesTable trades={trades} showBotName />
          </div>
        </div>
      </div>

      {/* Create Bot Modal */}
      <BotCreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={fetchStrategy}
        defaultStrategySlug={slug}
      />
    </div>
  );
}
