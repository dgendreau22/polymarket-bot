"use client";

import { BotListRow } from "./BotListRow";
import type { BotInstance } from "@/lib/bots/types";

interface BotListProps {
  bots: BotInstance[];
  onStateChange?: () => void;
  emptyMessage?: string;
}

export function BotList({
  bots,
  onStateChange,
  emptyMessage = "No bots found",
}: BotListProps) {
  if (bots.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div>
      {/* Header row */}
      <div className="grid grid-cols-[1fr_100px_120px_60px_80px_80px_80px_70px_110px] gap-2 px-3 py-2 text-xs text-muted-foreground border-b">
        <span>Market</span>
        <span>Status</span>
        <span className="text-right">Position</span>
        <span className="text-right">Avg</span>
        <span className="text-right">PnL</span>
        <span className="text-right">Realized</span>
        <span className="text-right">Unrealized</span>
        <span className="text-right">Trades</span>
        <span className="text-right">Actions</span>
      </div>
      {/* Bot rows - sorted by creation date, newest first */}
      <div className="divide-y divide-border/50">
        {[...bots]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .map((bot) => (
            <BotListRow key={bot.config.id} bot={bot} onStateChange={onStateChange} />
          ))}
      </div>
    </div>
  );
}
