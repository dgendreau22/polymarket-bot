"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Play,
  Square,
  Bot,
  AlertCircle,
  Calendar,
  Zap,
  RefreshCw,
  ArrowLeft,
  Trash2,
  Info,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { BotList } from "@/components/bots/BotList";
import type { BotInstance, StrategyDefinition } from "@/lib/bots/types";
import type {
  OrchestratorState,
  OrchestratorStatus,
  OrchestratorEvent,
} from "@/lib/bots/Orchestrator";
import type { StrategyPreset } from "@/lib/persistence/StrategyPresetsRepository";

// Pattern to match Bitcoin 15-minute markets
const BTC_15M_PATTERN = /Bitcoin Up or Down/i;

export default function OrchestratorPage() {
  // State
  const [status, setStatus] = useState<OrchestratorStatus | null>(null);
  const [bots, setBots] = useState<BotInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<string>("");
  const [nextCountdown, setNextCountdown] = useState<string>("");
  const [deleteAllLoading, setDeleteAllLoading] = useState(false);

  // Configuration form state
  const [strategies, setStrategies] = useState<StrategyDefinition[]>([]);
  const [strategy, setStrategy] = useState("arbitrage");
  const [mode, setMode] = useState<"live" | "dry_run">("dry_run");
  const [leadTimeMinutes, setLeadTimeMinutes] = useState(5);
  const [strategyConfig, setStrategyConfig] = useState<Record<string, unknown>>({});
  const [recordData, setRecordData] = useState(true);

  // Preset state
  const [presets, setPresets] = useState<StrategyPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");

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
          if (data.data.config.strategyConfig) {
            setStrategyConfig(data.data.config.strategyConfig);
          }
          if (data.data.config.recordData !== undefined) {
            setRecordData(data.data.config.recordData);
          }
        }
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch status");
    }
  }, []);

  // Fetch bots and filter to Bitcoin 15m markets
  const fetchBots = useCallback(async () => {
    try {
      const res = await fetch("/api/bots");
      const data = await res.json();
      if (data.success) {
        // Filter to only Bitcoin 15m market bots
        const btc15mBots = data.data.filter((bot: BotInstance) =>
          BTC_15M_PATTERN.test(bot.config.marketName || "")
        );
        setBots(btc15mBots);
      }
    } catch (err) {
      console.error("Failed to fetch bots:", err);
    }
  }, []);

  // Fetch available strategies
  const fetchStrategies = useCallback(async () => {
    try {
      const res = await fetch("/api/strategies");
      const data = await res.json();
      if (data.success) {
        setStrategies(data.data);
      }
    } catch (err) {
      console.error("Failed to fetch strategies:", err);
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
          strategyConfig,
          recordData,
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

  // Delete all stopped bots
  const handleDeleteAll = async () => {
    const stoppedBots = bots.filter((b) => b.state === "stopped");
    if (stoppedBots.length === 0) {
      alert("No stopped bots to delete");
      return;
    }

    if (!confirm(`Are you sure you want to delete all ${stoppedBots.length} stopped bots? This will also delete all associated trades.`)) {
      return;
    }

    setDeleteAllLoading(true);
    setError(null);

    let deleted = 0;
    let failed = 0;

    for (const bot of stoppedBots) {
      try {
        const res = await fetch(`/api/bots/${bot.config.id}`, { method: "DELETE" });
        const data = await res.json();
        if (data.success) {
          deleted++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    setDeleteAllLoading(false);
    fetchBots();

    if (failed > 0) {
      setError(`Deleted ${deleted} bots, ${failed} failed`);
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

    eventSource.addEventListener("bots", () => {
      // Refetch bots when orchestrator notifies of changes
      fetchBots();
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
  }, [fetchBots]);

  // Initial data fetch
  useEffect(() => {
    setLoading(true);
    Promise.all([fetchStatus(), fetchBots(), fetchStrategies()]).finally(() => setLoading(false));
  }, [fetchStatus, fetchBots, fetchStrategies]);

  // Get the currently selected strategy
  const selectedStrategy = strategies.find((s) => s.slug === strategy);

  // Initialize strategyConfig with defaults when strategy changes
  useEffect(() => {
    if (selectedStrategy?.parameters) {
      const defaults: Record<string, unknown> = {};
      selectedStrategy.parameters.forEach((param) => {
        defaults[param.name] = param.default;
      });
      setStrategyConfig(defaults);
    }
  }, [selectedStrategy]);

  // Update a single parameter value
  const updateParam = (name: string, value: unknown) => {
    setStrategyConfig((prev) => ({ ...prev, [name]: value }));
  };

  // Fetch presets when strategy changes
  useEffect(() => {
    const fetchPresets = async () => {
      if (!strategy) {
        setPresets([]);
        return;
      }
      try {
        const res = await fetch(`/api/strategies/presets?strategy=${strategy}`);
        const data = await res.json();
        if (data.success) {
          setPresets(data.data);
        }
      } catch (err) {
        console.error("Failed to fetch presets:", err);
      }
    };
    fetchPresets();
    // Reset preset selection when strategy changes
    setSelectedPresetId("");
  }, [strategy]);

  // Handle preset selection
  const handlePresetChange = (presetId: string) => {
    setSelectedPresetId(presetId);
    if (!presetId) {
      // Reset to strategy defaults
      if (selectedStrategy?.parameters) {
        const defaults: Record<string, unknown> = {};
        selectedStrategy.parameters.forEach((param) => {
          defaults[param.name] = param.default;
        });
        setStrategyConfig(defaults);
      }
      return;
    }
    // Apply ALL preset params (including those not exposed in UI)
    const preset = presets.find((p) => p.id === presetId);
    if (preset) {
      // Preset params contain all optimized parameters, apply them all
      setStrategyConfig({ ...preset.params });
    }
  };

  // Get the selected preset for display
  const selectedPreset = presets.find((p) => p.id === selectedPresetId);

  // Countdown timer for scheduled state
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

  // Countdown timer for next market (shown even when active)
  useEffect(() => {
    if (!status?.nextMarketStartTime) {
      setNextCountdown("");
      return;
    }

    const updateNextCountdown = () => {
      const target = new Date(status.nextMarketStartTime!).getTime();
      const now = Date.now();
      const diff = target - now;

      if (diff <= 0) {
        setNextCountdown("Starting...");
        return;
      }

      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setNextCountdown(`${mins}:${secs.toString().padStart(2, "0")}`);
    };

    updateNextCountdown();
    const interval = setInterval(updateNextCountdown, 1000);
    return () => clearInterval(interval);
  }, [status?.nextMarketStartTime]);

  // Poll for bot updates while any bot is running
  useEffect(() => {
    const hasRunningBots = bots.some((b) => b.state === "running");
    if (!hasRunningBots) return;

    const interval = setInterval(fetchBots, 5000);
    return () => clearInterval(interval);
  }, [bots, fetchBots]);

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
                {strategies.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.name}
                  </option>
                ))}
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

            {/* Data Recording Toggle */}
            <div className="col-span-1 md:col-span-3 mt-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={recordData}
                  onChange={(e) => setRecordData(e.target.checked)}
                  disabled={isRunning}
                  className="w-4 h-4 rounded border-muted-foreground"
                />
                <span className="text-sm">Record market data for analysis</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">
                      Records tick data and order book snapshots during market sessions.
                      Data collection starts at market open time, not when bots start.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </label>
            </div>
          </div>

          {/* Load Preset Selector - only show if presets exist */}
          {presets.length > 0 && (
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium">Load Optimized Preset</h3>
                {selectedPreset && (
                  <span className="text-xs text-green-500">
                    {Object.keys(selectedPreset.params).length} optimized parameters loaded
                  </span>
                )}
              </div>
              <select
                value={selectedPresetId}
                onChange={(e) => handlePresetChange(e.target.value)}
                className="w-full p-2 border rounded bg-background text-foreground"
                disabled={isRunning}
              >
                <option value="">Default parameters</option>
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                    {preset.finalSharpe !== undefined && preset.finalSharpe !== null && (
                      ` (SR: ${preset.finalSharpe.toFixed(2)})`
                    )}
                  </option>
                ))}
              </select>
              {selectedPreset && (
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {selectedPreset.finalSharpe !== undefined && selectedPreset.finalSharpe !== null && (
                    <span>Sharpe: <span className="font-medium text-foreground">{selectedPreset.finalSharpe.toFixed(3)}</span></span>
                  )}
                  {selectedPreset.finalPnl !== undefined && selectedPreset.finalPnl !== null && (
                    <span>PnL: <span className={`font-medium ${selectedPreset.finalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>${selectedPreset.finalPnl.toFixed(2)}</span></span>
                  )}
                  {selectedPreset.finalWinRate !== undefined && selectedPreset.finalWinRate !== null && (
                    <span>Win Rate: <span className="font-medium text-foreground">{(selectedPreset.finalWinRate * 100).toFixed(1)}%</span></span>
                  )}
                  {selectedPreset.description && (
                    <span className="w-full text-muted-foreground">{selectedPreset.description}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Strategy Parameters */}
          {selectedStrategy?.parameters && selectedStrategy.parameters.length > 0 && (
            <div className="mt-4 pt-4 border-t">
              <h3 className="text-sm font-medium mb-3">Strategy Parameters</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {selectedStrategy.parameters.map((param) => (
                  <div key={param.name}>
                    <label className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                      <span>{param.name}</span>
                      {param.min !== undefined && param.max !== undefined && (
                        <span className="text-xs">
                          ({param.min} - {param.max})
                        </span>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help flex-shrink-0" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs">{param.description}</p>
                        </TooltipContent>
                      </Tooltip>
                    </label>
                    {param.type === "boolean" ? (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(strategyConfig[param.name])}
                          onChange={(e) => updateParam(param.name, e.target.checked)}
                          disabled={isRunning}
                        />
                        <span className="text-sm text-muted-foreground">
                          Enabled
                        </span>
                      </label>
                    ) : (
                      <input
                        type={param.type === "number" ? "number" : "text"}
                        value={String(strategyConfig[param.name] ?? param.default)}
                        onChange={(e) => {
                          if (param.type === "number") {
                            const val = parseFloat(e.target.value);
                            updateParam(param.name, isNaN(val) ? 0 : val);
                          } else {
                            updateParam(param.name, e.target.value);
                          }
                        }}
                        min={param.min}
                        max={param.max}
                        step={param.type === "number" ? 0.001 : undefined}
                        className="w-full p-2 border rounded bg-background text-foreground"
                        disabled={isRunning}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

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
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div>
                  <h2 className="font-semibold flex items-center gap-2">
                    <Bot className="w-5 h-5 text-purple-500" />
                    Bitcoin 15m Bots
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {bots.filter((b) => b.state === "running").length} running,{" "}
                    {bots.filter((b) => b.state === "paused").length} paused,{" "}
                    {bots.filter((b) => b.state === "stopped").length} stopped
                  </p>
                </div>
                {/* Delete All button */}
                {bots.filter((b) => b.state === "stopped").length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDeleteAll}
                    disabled={deleteAllLoading}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    {deleteAllLoading ? (
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4 mr-2" />
                    )}
                    Delete All
                  </Button>
                )}
              </div>
              {/* Upcoming scheduled market - always show when available */}
              {status?.nextMarket && nextCountdown && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Next market in</p>
                  <p className="text-2xl font-mono font-bold text-primary">
                    {nextCountdown}
                  </p>
                  <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                    {status.nextMarket.marketName.replace("Bitcoin Up or Down - ", "")}
                  </p>
                </div>
              )}
            </div>
          </div>
          <div className="p-6">
            <BotList
              bots={bots}
              onStateChange={fetchBots}
              emptyMessage="No Bitcoin 15m bots yet. Start the orchestrator to create bots automatically."
            />
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

