"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, Square, Pause, RotateCcw, Loader2 } from "lucide-react";
import type { BotState } from "@/lib/bots/types";

interface BotControlsProps {
  botId: string;
  state: BotState;
  onStateChange?: () => void;
  compact?: boolean;
}

export function BotControls({
  botId,
  state,
  onStateChange,
  compact = false,
}: BotControlsProps) {
  const [loading, setLoading] = useState<string | null>(null);

  const handleAction = async (action: "start" | "stop" | "pause" | "resume") => {
    setLoading(action);
    try {
      const response = await fetch(`/api/bots/${botId}/${action}`, {
        method: "POST",
      });
      const data = await response.json();

      if (!data.success) {
        console.error(`Failed to ${action} bot:`, data.error);
      }

      onStateChange?.();
    } catch (error) {
      console.error(`Error ${action}ing bot:`, error);
    } finally {
      setLoading(null);
    }
  };

  const buttonSize = compact ? "sm" : "default";
  const iconSize = compact ? "w-3 h-3" : "w-4 h-4";

  if (state === "stopped") {
    return (
      <Button
        size={buttonSize}
        onClick={() => handleAction("start")}
        disabled={loading !== null}
        className="bg-green-600 hover:bg-green-700"
      >
        {loading === "start" ? (
          <Loader2 className={`${iconSize} animate-spin`} />
        ) : (
          <Play className={iconSize} />
        )}
        {!compact && <span className="ml-1">Start</span>}
      </Button>
    );
  }

  if (state === "paused") {
    return (
      <div className="flex gap-2">
        <Button
          size={buttonSize}
          onClick={() => handleAction("resume")}
          disabled={loading !== null}
          className="bg-green-600 hover:bg-green-700"
        >
          {loading === "resume" ? (
            <Loader2 className={`${iconSize} animate-spin`} />
          ) : (
            <RotateCcw className={iconSize} />
          )}
          {!compact && <span className="ml-1">Resume</span>}
        </Button>
        <Button
          size={buttonSize}
          variant="destructive"
          onClick={() => handleAction("stop")}
          disabled={loading !== null}
        >
          {loading === "stop" ? (
            <Loader2 className={`${iconSize} animate-spin`} />
          ) : (
            <Square className={iconSize} />
          )}
          {!compact && <span className="ml-1">Stop</span>}
        </Button>
      </div>
    );
  }

  // Running state
  return (
    <div className="flex gap-2">
      <Button
        size={buttonSize}
        variant="outline"
        onClick={() => handleAction("pause")}
        disabled={loading !== null}
      >
        {loading === "pause" ? (
          <Loader2 className={`${iconSize} animate-spin`} />
        ) : (
          <Pause className={iconSize} />
        )}
        {!compact && <span className="ml-1">Pause</span>}
      </Button>
      <Button
        size={buttonSize}
        variant="destructive"
        onClick={() => handleAction("stop")}
        disabled={loading !== null}
      >
        {loading === "stop" ? (
          <Loader2 className={`${iconSize} animate-spin`} />
        ) : (
          <Square className={iconSize} />
        )}
        {!compact && <span className="ml-1">Stop</span>}
      </Button>
    </div>
  );
}
