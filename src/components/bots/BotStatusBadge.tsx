"use client";

import type { BotState, BotMode } from "@/lib/bots/types";

interface BotStatusBadgeProps {
  state: BotState;
  mode: BotMode;
}

export function BotStatusBadge({ state, mode }: BotStatusBadgeProps) {
  const stateColors: Record<BotState, string> = {
    running: "bg-green-500",
    paused: "bg-yellow-500",
    stopped: "bg-gray-400",
  };

  const modeColors: Record<BotMode, string> = {
    live: "bg-red-500",
    dry_run: "bg-blue-500",
  };

  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-white ${stateColors[state]}`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            state === "running" ? "animate-pulse bg-white" : "bg-white/60"
          }`}
        />
        {state}
      </span>
      <span
        className={`px-2 py-0.5 rounded text-xs font-medium text-white ${modeColors[mode]}`}
      >
        {mode === "dry_run" ? "DRY" : "LIVE"}
      </span>
    </div>
  );
}
