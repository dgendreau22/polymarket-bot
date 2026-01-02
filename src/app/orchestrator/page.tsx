"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Play,
  Square,
  Clock,
  Bot,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Calendar,
  Timer,
  Zap,
  RefreshCw,
  ArrowLeft,
} from "lucide-react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import type {
  OrchestratorState,
  OrchestratorStatus,
  OrchestratorBotInfo,
  ScheduledMarket,
  OrchestratorEvent,
} from "@/lib/bots/Orchestrator";

export default function OrchestratorPage() {
  // State
  const [status, setStatus] = useState<OrchestratorStatus | null>(null);
  const [bots, setBots] = useState<OrchestratorBotInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<string>("");

  // Configuration form state
  const [strategy, setStrategy] = useState("arbitrage");
  const [mode, setMode] = useState<"live" | "dry_run">("dry_run");
  const [leadTimeMinutes, setLeadTimeMinutes] = useState(5);

  // Fetch initial status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/orchestrator");
      const data = await res.json();
      if (data.success) {
        setStatus(data.data);
        // Sync form with current config if orchestrator is running
        if (data.data.config.enabled) {
          setStrategy(data.data.config.strategy);
          setMode(data.data.config.mode);
          setLeadTimeMinutes(data.data.config.leadTimeMinutes);
        }
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch status");
    }
  }, []);

  // Fetch bot history
  const fetchBots = useCallback(async () => {
    try {
      const res = await fetch("/api/orchestrator/bots");
      const data = await res.json();
      if (data.success) {
        setBots(data.data);
      }
    } catch (err) {
      console.error("Failed to fetch bots:", err);
    }
  }, []);

  // Start orchestrator
  const handleStart = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/orchestrator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy,
          mode,
          leadTimeMinutes,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus(data.data);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start");
    } finally {
      setActionLoading(false);
    }
  };

  // Stop orchestrator
  const handleStop = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/orchestrator", { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setStatus(data.data);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop");
    } finally {
      setActionLoading(false);
    }
  };

  // SSE connection for real-time updates
  useEffect(() => {
    const eventSource = new EventSource("/api/orchestrator/events");

    eventSource.addEventListener("status", (e) => {
      try {
        const data = JSON.parse(e.data) as OrchestratorStatus;
        setStatus(data);
      } catch (err) {
        console.error("Failed to parse status:", err);
      }
    });

    eventSource.addEventListener("bots", (e) => {
      try {
        const data = JSON.parse(e.data) as OrchestratorBotInfo[];
        setBots(data);
      } catch (err) {
        console.error("Failed to parse bots:", err);
      }
    });

    eventSource.addEventListener("event", (e) => {
      try {
        const event = JSON.parse(e.data) as OrchestratorEvent;
        console.log("[Orchestrator] Event:", event.type);
      } catch (err) {
        console.error("Failed to parse event:", err);
      }
    });

    eventSource.onerror = () => {
      console.error("[Orchestrator] SSE connection error");
    };

    return () => eventSource.close();
  }, []);

  // Initial data fetch
  useEffect(() => {
    setLoading(true);
    Promise.all([fetchStatus(), fetchBots()]).finally(() => setLoading(false));
  }, [fetchStatus, fetchBots]);

  // Countdown timer
  useEffect(() => {
    if (!status?.scheduledStartTime) {
      setCountdown("");
      return;
    }

    const updateCountdown = () => {
      const target = new Date(status.scheduledStartTime!).getTime();
      const now = Date.now();
      const diff = target - now;

      if (diff <= 0) {
        setCountdown("Starting...");
        return;
      }

      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setCountdown(`${mins}:${secs.toString().padStart(2, "0")}`);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [status?.scheduledStartTime]);

  const isRunning = status?.config.enabled ?? false;
  const state = status?.state ?? "idle";

  return (
    <div className="min-h-screen bg-background">
      {/* Header Bar */}
      <div className="bg-card border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <ArrowLeft className="w-4 h-4" />
                Dashboard
              </Link>
              <div>
                <h1 className="text-xl font-bold">BTC 15-min Orchestrator</h1>
                <p className="text-sm text-muted-foreground">
                  Automated trading for Bitcoin prediction markets
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <OrchestratorStatusBadge state={state} />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-8 space-y-6">
        {/* Error Display */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <p className="text-red-500">{error}</p>
          </div>
        )}

        {/* Configuration Panel */}
        <div className="bg-card border rounded-lg p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-500" />
            Configuration
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Strategy Selector */}
            <div>
              <label className="text-sm text-muted-foreground block mb-1">
                Strategy
              </label>
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
                className="w-full p-2 border rounded bg-background text-foreground"
                disabled={isRunning}
              >
                <option value="arbitrage">Arbitrage</option>
                <option value="market-maker">Market Maker</option>
                <option value="test-oscillator">Test Oscillator</option>
              </select>
            </div>

            {/* Mode Selector */}
            <div>
              <label className="text-sm text-muted-foreground block mb-1">
                Mode
              </label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as "live" | "dry_run")}
                className="w-full p-2 border rounded bg-background text-foreground"
                disabled={isRunning}
              >
                <option value="dry_run">Dry Run</option>
                <option value="live">Live Trading</option>
              </select>
            </div>

            {/* Lead Time */}
            <div>
              <label className="text-sm text-muted-foreground block mb-1">
                Start Before (min)
              </label>
              <input
                type="number"
                value={leadTimeMinutes}
                onChange={(e) =>
                  setLeadTimeMinutes(
                    Math.max(1, Math.min(15, parseInt(e.target.value) || 5))
                  )
                }
                className="w-full p-2 border rounded bg-background text-foreground"
                disabled={isRunning}
                min={1}
                max={15}
              />
            </div>
          </div>

          {/* Start/Stop Button */}
          <div className="mt-6 flex justify-end">
            {!isRunning ? (
              <Button
                onClick={handleStart}
                disabled={actionLoading || loading}
                className="bg-green-600 hover:bg-green-700"
              >
                {actionLoading ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                Start Orchestrator
              </Button>
            ) : (
              <Button
                onClick={handleStop}
                disabled={actionLoading}
                variant="destructive"
              >
                {actionLoading ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Square className="w-4 h-4 mr-2" />
                )}
                Stop Orchestrator
              </Button>
            )}
          </div>
        </div>

        {/* Current Market / Schedule Panel */}
        {status?.currentMarket && (
          <div className="bg-card border rounded-lg p-6">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-500" />
              {state === "scheduled" ? "Scheduled Market" : "Active Market"}
            </h2>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-lg font-medium">
                  {status.currentMarket.marketName}
                </p>
                <p className="text-sm text-muted-foreground">
                  Market ID: {status.currentMarket.marketId}
                </p>
                <p className="text-sm text-muted-foreground">
                  Starts:{" "}
                  {new Date(status.currentMarket.startTime).toLocaleString()}
                </p>
              </div>
              {state === "scheduled" && countdown && (
                <div className="text-center ml-8">
                  <p className="text-xs text-muted-foreground">Bot starts in</p>
                  <p className="text-4xl font-mono font-bold text-primary">
                    {countdown}
                  </p>
                </div>
              )}
              {state === "active" && status.currentBotId && (
                <div className="text-center ml-8">
                  <p className="text-xs text-muted-foreground">Active Bot</p>
                  <Link
                    href={`/bots/${status.currentBotId}`}
                    className="text-primary hover:underline font-mono text-sm"
                  >
                    View Bot
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Searching State */}
        {state === "searching" && !status?.currentMarket && (
          <div className="bg-card border rounded-lg p-6">
            <div className="flex items-center gap-3">
              <RefreshCw className="w-5 h-5 text-yellow-500 animate-spin" />
              <div>
                <p className="font-medium">Searching for next market...</p>
                <p className="text-sm text-muted-foreground">
                  Looking for upcoming Bitcoin 15-minute prediction markets
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Error State */}
        {state === "error" && status?.lastError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <div>
                <p className="font-medium text-red-500">Error</p>
                <p className="text-sm text-red-400">{status.lastError}</p>
              </div>
            </div>
          </div>
        )}

        {/* Bot List */}
        <div className="bg-card border rounded-lg">
          <div className="p-6 border-b">
            <h2 className="font-semibold flex items-center gap-2">
              <Bot className="w-5 h-5 text-purple-500" />
              Managed Bots
            </h2>
            <p className="text-sm text-muted-foreground">
              {bots.filter((b) => b.state === "running").length} running,{" "}
              {bots.filter((b) => b.state === "stopped").length} completed
            </p>
          </div>
          <div className="p-6">
            <OrchestratorBotList bots={bots} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Status Badge Component
function OrchestratorStatusBadge({ state }: { state: OrchestratorState }) {
  const config: Record<OrchestratorState, { color: string; text: string }> = {
    idle: { color: "bg-muted", text: "Idle" },
    searching: { color: "bg-yellow-500", text: "Searching" },
    scheduled: { color: "bg-blue-500", text: "Scheduled" },
    active: { color: "bg-green-500", text: "Active" },
    error: { color: "bg-red-500", text: "Error" },
  };

  const { color, text } = config[state];

  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-2 h-2 rounded-full ${color} ${
          state === "searching" ? "animate-pulse" : ""
        }`}
      />
      <span className="text-sm">{text}</span>
    </div>
  );
}

// Bot List Component
function OrchestratorBotList({ bots }: { bots: OrchestratorBotInfo[] }) {
  if (bots.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        <Bot className="w-12 h-12 mx-auto mb-3 opacity-50" />
        <p>No bots yet</p>
        <p className="text-sm">
          Start the orchestrator to create bots automatically
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="pb-3 pr-4">Time Window</th>
            <th className="pb-3 pr-4">State</th>
            <th className="pb-3 pr-4 text-right">Position</th>
            <th className="pb-3 text-right">PnL</th>
            <th className="pb-3 pl-4">Actions</th>
          </tr>
        </thead>
        <tbody>
          {bots.map((bot) => (
            <tr key={bot.botId} className="border-b last:border-0">
              <td className="py-3 pr-4">
                <span className="font-mono">{bot.marketTimeWindow}</span>
                <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                  {bot.marketName}
                </p>
              </td>
              <td className="py-3 pr-4">
                <span
                  className={`px-2 py-1 rounded text-xs ${
                    bot.state === "running"
                      ? "bg-green-500/20 text-green-500"
                      : bot.state === "paused"
                      ? "bg-yellow-500/20 text-yellow-500"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {bot.state.toUpperCase()}
                </span>
              </td>
              <td className="py-3 pr-4 text-right font-mono">
                {bot.positionSize.toFixed(2)}
              </td>
              <td
                className={`py-3 text-right font-mono ${
                  bot.pnl >= 0 ? "text-green-500" : "text-red-500"
                }`}
              >
                <span className="flex items-center justify-end gap-1">
                  {bot.pnl >= 0 ? (
                    <TrendingUp className="w-3 h-3" />
                  ) : (
                    <TrendingDown className="w-3 h-3" />
                  )}
                  ${Math.abs(bot.pnl).toFixed(2)}
                </span>
              </td>
              <td className="py-3 pl-4">
                <Link
                  href={`/bots/${bot.botId}`}
                  className="text-primary hover:underline text-xs"
                >
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
