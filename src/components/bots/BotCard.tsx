"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BotStatusBadge } from "./BotStatusBadge";
import { BotControls } from "./BotControls";
import { TrendingUp, TrendingDown, Trash2 } from "lucide-react";
import type { BotInstance } from "@/lib/bots/types";

interface BotCardProps {
  bot: BotInstance;
  onStateChange?: () => void;
}

// Format strategy slug to display name (e.g., "test-oscillator" -> "Test Oscillator")
function formatStrategyName(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function BotCard({ bot, onStateChange }: BotCardProps) {
  const [deleting, setDeleting] = useState(false);
  const pnl = parseFloat(bot.metrics.totalPnl);
  const positionSize = parseFloat(bot.position.size);
  const avgPrice = parseFloat(bot.position.avgEntryPrice);
  const strategyName = formatStrategyName(bot.config.strategySlug);

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete this ${strategyName} bot? This will also delete all associated trades.`)) {
      return;
    }

    setDeleting(true);
    try {
      const res = await fetch(`/api/bots/${bot.config.id}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (data.success) {
        onStateChange?.();
      } else {
        alert(data.error || "Failed to delete bot");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete bot");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="bg-card border rounded-lg p-4 hover:border-primary/50 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <Link
            href={`/bots/${bot.config.id}`}
            className="font-semibold truncate hover:text-primary"
          >
            {strategyName}
          </Link>
        </div>
        <BotStatusBadge state={bot.state} mode={bot.config.mode} />
      </div>

      {/* Market */}
      <Link
        href={`/market/${bot.config.marketId}`}
        className="block text-xs text-muted-foreground truncate mb-3 hover:text-primary"
      >
        Market: {bot.config.marketName || bot.config.marketId.slice(0, 20) + '...'}
      </Link>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-muted/50 rounded p-2">
          <p className="text-xs text-muted-foreground">Position</p>
          <p className="font-medium">
            {positionSize > 0 ? `${positionSize.toFixed(2)} YES` : "None"}
          </p>
          {positionSize > 0 && (
            <p className="text-xs text-muted-foreground">
              @ ${avgPrice.toFixed(4)}
            </p>
          )}
        </div>
        <div className="bg-muted/50 rounded p-2">
          <p className="text-xs text-muted-foreground">PnL</p>
          <div className="flex items-center gap-1">
            {pnl >= 0 ? (
              <TrendingUp className="w-3 h-3 text-green-500" />
            ) : (
              <TrendingDown className="w-3 h-3 text-red-500" />
            )}
            <span
              className={`font-medium ${
                pnl >= 0 ? "text-green-500" : "text-red-500"
              }`}
            >
              ${pnl.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex justify-between text-xs text-muted-foreground mb-3">
        <span>Trades: {bot.metrics.totalTrades}</span>
        <span>
          Win:{" "}
          {(bot.metrics.winningTrades + bot.metrics.losingTrades) > 0
            ? (
                (bot.metrics.winningTrades / (bot.metrics.winningTrades + bot.metrics.losingTrades)) *
                100
              ).toFixed(0)
            : 0}
          %
        </span>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <BotControls
            botId={bot.config.id}
            state={bot.state}
            onStateChange={onStateChange}
            compact
          />
        </div>
        {bot.state === "stopped" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
