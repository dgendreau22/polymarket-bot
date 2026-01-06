"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BotStatusBadge } from "./BotStatusBadge";
import { BotControls } from "./BotControls";
import { TrendingUp, TrendingDown, Trash2 } from "lucide-react";
import type { BotInstance } from "@/lib/bots/types";
import { calculateRealizedPnl, calculateAvgPrice } from "@/lib/bots/pnl";

interface BotListRowProps {
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

export function BotListRow({ bot, onStateChange }: BotListRowProps) {
  const [deleting, setDeleting] = useState(false);
  const unrealizedPnl = parseFloat(bot.metrics.unrealizedPnl);
  const strategyName = formatStrategyName(bot.config.strategySlug);

  // Get position data from positions array
  const positions = bot.positions || [];
  const yesPosition = positions.find(p => p.outcome === 'YES');
  const noPosition = positions.find(p => p.outcome === 'NO');
  const yesSize = yesPosition ? parseFloat(yesPosition.size) : 0;
  const noSize = noPosition ? parseFloat(noPosition.size) : 0;
  const totalSize = bot.totalPositionSize ?? (yesSize + noSize);

  // Calculate average price using shared utility
  const avgPrice = calculateAvgPrice(positions);

  // Calculate realized PnL using shared utility for consistency
  const realizedPnl = calculateRealizedPnl(positions);

  // Total PnL = realized + unrealized
  const pnl = realizedPnl + unrealizedPnl;

  const isArbitrage = bot.config.strategySlug === 'arbitrage' || (yesSize > 0 && noSize > 0);

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

  // Format position display
  const formatPosition = () => {
    if (totalSize === 0) return "—";

    if (isArbitrage) {
      return `${totalSize.toFixed(0)} (Y:${yesSize.toFixed(0)} N:${noSize.toFixed(0)})`;
    }

    // Single leg
    const outcome = yesSize > 0 ? 'Y' : 'N';
    return `${totalSize.toFixed(0)} ${outcome}`;
  };

  return (
    <div className="grid grid-cols-[1fr_100px_120px_60px_80px_80px_80px_70px_110px] gap-2 px-3 py-2 items-center hover:bg-muted/50 rounded transition-colors text-sm">
      {/* Market */}
      <Link
        href={`/bots/${bot.config.id}`}
        className="truncate hover:text-primary"
        title={bot.config.marketName || bot.config.marketId}
      >
        {bot.config.marketName || bot.config.marketId.slice(0, 30) + "..."}
      </Link>

      {/* Strategy + Status */}
      <div className="flex items-center gap-1">
        <BotStatusBadge state={bot.state} mode={bot.config.mode} />
      </div>

      {/* Position */}
      <div className="text-right font-mono text-xs">
        {formatPosition()}
      </div>

      {/* Avg Price */}
      <div className="text-right font-mono text-xs text-muted-foreground">
        {totalSize > 0 ? avgPrice.toFixed(2) : "—"}
      </div>

      {/* Total PnL */}
      <div className={`text-right font-mono flex items-center justify-end gap-1 ${pnl >= 0 ? "text-green-500" : "text-red-500"}`}>
        {pnl !== 0 && (
          pnl >= 0 ? (
            <TrendingUp className="w-3 h-3" />
          ) : (
            <TrendingDown className="w-3 h-3" />
          )
        )}
        ${pnl.toFixed(2)}
      </div>

      {/* Realized PnL */}
      <div className={`text-right font-mono text-xs ${realizedPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
        ${realizedPnl.toFixed(2)}
      </div>

      {/* Unrealized PnL */}
      <div className={`text-right font-mono text-xs ${unrealizedPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
        ${unrealizedPnl.toFixed(2)}
      </div>

      {/* Trades */}
      <div className="text-right text-muted-foreground">
        {bot.metrics.totalTrades}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1 justify-end">
        <BotControls
          botId={bot.config.id}
          state={bot.state}
          onStateChange={onStateChange}
          compact
        />
        {bot.state === "stopped" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
            className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
