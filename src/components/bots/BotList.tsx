"use client";

import { BotCard } from "./BotCard";
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
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {bots.map((bot) => (
        <BotCard key={bot.config.id} bot={bot} onStateChange={onStateChange} />
      ))}
    </div>
  );
}
