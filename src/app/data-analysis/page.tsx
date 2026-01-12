"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Play,
  Square,
  RefreshCw,
  ArrowLeft,
  Activity,
  Database,
  BarChart3,
  Clock,
  Trash2,
} from "lucide-react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { PriceChart } from "@/components/charts";
import type { RecorderStatus, RecorderEvent } from "@/lib/data";
import type { RecordingSessionRow, MarketTickRow } from "@/lib/persistence/DataRepository";
import { aggregateTicksToCandles, type CandleData } from "@/lib/utils/candles";
import { cn } from "@/lib/utils";

// Available timeframes for chart
const TIMEFRAMES = [
  { value: 15, label: "15s" },
  { value: 30, label: "30s" },
  { value: 60, label: "1m" },
  { value: 300, label: "5m" },
];

export default function DataAnalysisPage() {
  // State
  const [status, setStatus] = useState<RecorderStatus | null>(null);
  const [sessions, setSessions] = useState<RecordingSessionRow[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [ticks, setTicks] = useState<MarketTickRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState(15); // Default 15 seconds

  // Stats for current session
  const [stats, setStats] = useState<{
    tickCount: number;
    snapshotCount: number;
    priceRange: { yes: [number, number]; no: [number, number] };
    combinedCostRange: [number, number];
  } | null>(null);

  // Live tick for chart
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [liveTimestamp, setLiveTimestamp] = useState<string | null>(null);

  // View mode: single session or all sessions
  const [viewAllSessions, setViewAllSessions] = useState(false);
  const [allTicks, setAllTicks] = useState<MarketTickRow[]>([]);

  // Date range filter
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  // Fetch status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/data-recorder");
      const data = await res.json();
      if (data.success) {
        setStatus(data.data);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch status");
    }
  }, []);

  // Fetch sessions
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/data-recorder/sessions?limit=20");
      const data = await res.json();
      if (data.success) {
        setSessions(data.data);
      }
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
    }
  }, []);

  // Fetch ticks for a session
  const fetchTicks = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/data-recorder/sessions/${sessionId}/ticks?outcome=YES`);
      const data = await res.json();
      if (data.success) {
        setTicks(data.data);
      }
    } catch (err) {
      console.error("Failed to fetch ticks:", err);
    }
  }, []);

  // Fetch stats for a session
  const fetchStats = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/data-recorder/sessions/${sessionId}/stats`);
      const data = await res.json();
      if (data.success) {
        setStats(data.data.stats);
      }
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    }
  }, []);

  // Fetch all ticks across all sessions
  const fetchAllTicks = useCallback(async () => {
    try {
      const res = await fetch("/api/data-recorder/ticks?outcome=YES");
      const data = await res.json();
      if (data.success) {
        setAllTicks(data.data);
      }
    } catch (err) {
      console.error("Failed to fetch all ticks:", err);
    }
  }, []);

  // Start recorder
  const handleStart = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/data-recorder", { method: "POST" });
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

  // Stop recorder
  const handleStop = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/data-recorder", { method: "DELETE" });
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

  // Delete a session
  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row selection
    if (!confirm("Delete this session and all its data?")) return;

    try {
      const res = await fetch(`/api/data-recorder/sessions/${sessionId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        // Remove from local state
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        // Clear selection if deleted session was selected
        if (selectedSessionId === sessionId) {
          setSelectedSessionId(null);
          setTicks([]);
          setStats(null);
        }
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete session");
    }
  };

  // SSE connection for real-time updates
  useEffect(() => {
    const eventSource = new EventSource("/api/data-recorder/events");

    eventSource.addEventListener("status", (e) => {
      try {
        const data = JSON.parse(e.data) as RecorderStatus;
        setStatus(data);
        setLoading(false);

        // Auto-select current session if recording
        if (data.currentSession && !selectedSessionId) {
          setSelectedSessionId(data.currentSession.id);
        }
      } catch (err) {
        console.error("Failed to parse status:", err);
      }
    });

    eventSource.addEventListener("tick", (e) => {
      try {
        const tick = JSON.parse(e.data) as { outcome: string; price: string; timestamp: string };
        if (tick.outcome === "YES") {
          setLivePrice(parseFloat(tick.price));
          setLiveTimestamp(tick.timestamp.toString());
        }
      } catch (err) {
        console.error("Failed to parse tick:", err);
      }
    });

    eventSource.addEventListener("event", (e) => {
      try {
        const event = JSON.parse(e.data) as RecorderEvent;
        if (event.type === "SESSION_STARTED" || event.type === "SESSION_ENDED") {
          fetchSessions();
        }
      } catch (err) {
        console.error("Failed to parse event:", err);
      }
    });

    eventSource.onerror = () => {
      console.error("[DataRecorder] SSE connection error");
      setLoading(false);
    };

    return () => eventSource.close();
  }, [fetchSessions, selectedSessionId]);

  // Initial data fetch
  useEffect(() => {
    Promise.all([fetchStatus(), fetchSessions()]).finally(() => setLoading(false));
  }, [fetchStatus, fetchSessions]);

  // Fetch ticks and stats when session changes
  useEffect(() => {
    if (selectedSessionId) {
      fetchTicks(selectedSessionId);
      fetchStats(selectedSessionId);
    }
  }, [selectedSessionId, fetchTicks, fetchStats]);

  // Fetch all ticks when "All Sessions" mode is enabled
  useEffect(() => {
    if (viewAllSessions && allTicks.length === 0) {
      fetchAllTicks();
    }
  }, [viewAllSessions, allTicks.length, fetchAllTicks]);

  // Filter ticks by view mode and date range
  const filteredTicks = useMemo(() => {
    let ticksToUse = viewAllSessions ? allTicks : ticks;

    // Apply date range filter
    if (startDate || endDate) {
      const startTime = startDate ? new Date(startDate).getTime() : 0;
      const endTime = endDate ? new Date(endDate).getTime() : Infinity;

      ticksToUse = ticksToUse.filter((tick) => {
        const tickTime = new Date(tick.timestamp).getTime();
        return tickTime >= startTime && tickTime <= endTime;
      });
    }

    return ticksToUse;
  }, [ticks, allTicks, viewAllSessions, startDate, endDate]);

  // Aggregate filtered ticks into candles
  const candles = useMemo(() => {
    return aggregateTicksToCandles(filteredTicks, timeframe);
  }, [filteredTicks, timeframe]);

  // Count of filtered ticks for display
  const filteredTickCount = filteredTicks.length;

  const isRecording = status?.state === "recording";
  const isDiscovering = status?.state === "discovering";
  const state = status?.state ?? "idle";

  return (
    <div className="min-h-screen bg-background">
      {/* Header Bar */}
      <div className="bg-card border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-8 py-4">
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
                <h1 className="text-xl font-bold">Market Data Recorder</h1>
                <p className="text-sm text-muted-foreground">
                  Record Bitcoin 15-min market data for analysis
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <RecorderStatusBadge state={state} />
              {!isRecording && !isDiscovering ? (
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
                  Start Recording
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
                  Stop Recording
                </Button>
              )}
              <ThemeToggle />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-8 space-y-6">
        {/* Error Display */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
            <p className="text-red-500">{error}</p>
          </div>
        )}

        {/* Current Recording Panel */}
        {status?.currentSession && (
          <div className="bg-card border rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold flex items-center gap-2">
                <Activity className="w-5 h-5 text-green-500" />
                Currently Recording
              </h2>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-sm text-muted-foreground">Live</span>
              </div>
            </div>
            <p className="text-lg font-medium mb-4">{status.currentSession.marketName}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Ticks Recorded</p>
                <p className="text-2xl font-bold">{status.currentSession.tickCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Snapshots</p>
                <p className="text-2xl font-bold">{status.currentSession.snapshotCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Start Time</p>
                <p className="text-lg font-mono">
                  {new Date(status.currentSession.startTime).toLocaleTimeString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">End Time</p>
                <p className="text-lg font-mono">
                  {new Date(status.currentSession.endTime).toLocaleTimeString()}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Discovering State */}
        {isDiscovering && !status?.currentSession && (
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

        {/* Chart Section */}
        <div className="bg-card border rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-500" />
              Price Chart (YES)
              {(viewAllSessions || selectedSessionId) && (
                <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">
                  {filteredTickCount} ticks
                </span>
              )}
            </h2>
            <div className="flex items-center gap-4">
              {/* All Sessions Toggle */}
              <button
                onClick={() => setViewAllSessions(!viewAllSessions)}
                className={cn(
                  "px-3 py-1 rounded text-sm font-medium transition-colors",
                  viewAllSessions
                    ? "bg-blue-500 text-white"
                    : "bg-muted hover:bg-muted/80"
                )}
              >
                All Sessions
              </button>
              {/* Timeframe Selector */}
              <div className="flex items-center gap-2">
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf.value}
                    onClick={() => setTimeframe(tf.value)}
                    className={cn(
                      "px-3 py-1 rounded text-sm font-medium transition-colors",
                      timeframe === tf.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted hover:bg-muted/80"
                    )}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {/* Date Range Filter */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground">From:</label>
              <input
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-muted border border-border rounded px-2 py-1 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground">To:</label>
              <input
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-muted border border-border rounded px-2 py-1 text-sm"
              />
            </div>
            {(startDate || endDate) && (
              <button
                onClick={() => {
                  setStartDate("");
                  setEndDate("");
                }}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <div className="h-[400px]">
            {candles.length > 0 || livePrice ? (
              <PriceChart
                price={livePrice}
                timestamp={liveTimestamp}
                intervalSeconds={timeframe}
                initialCandles={candles.length > 0 ? candles : undefined}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                {viewAllSessions
                  ? "Loading all sessions data..."
                  : selectedSessionId
                    ? "Loading chart data..."
                    : "Select a session or click 'All Sessions' to view chart"}
              </div>
            )}
          </div>
        </div>

        {/* Statistics Panel */}
        {stats && selectedSessionId && (
          <div className="bg-card border rounded-lg p-6">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Database className="w-5 h-5 text-purple-500" />
              Session Statistics
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">YES Price Range</p>
                <p className="text-lg font-mono">
                  ${stats.priceRange.yes[0].toFixed(3)} - ${stats.priceRange.yes[1].toFixed(3)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">NO Price Range</p>
                <p className="text-lg font-mono">
                  ${stats.priceRange.no[0].toFixed(3)} - ${stats.priceRange.no[1].toFixed(3)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Combined Cost Range</p>
                <p className="text-lg font-mono">
                  ${stats.combinedCostRange[0].toFixed(4)} - ${stats.combinedCostRange[1].toFixed(4)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Ticks</p>
                <p className="text-2xl font-bold">{stats.tickCount}</p>
              </div>
            </div>
          </div>
        )}

        {/* Sessions List */}
        <div className="bg-card border rounded-lg p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-orange-500" />
            Recording Sessions ({sessions.length})
          </h2>
          {sessions.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              No recording sessions yet. Start the recorder to begin collecting data.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">Market</th>
                    <th className="pb-2 pr-4">Start Time</th>
                    <th className="pb-2 pr-4">Ticks</th>
                    <th className="pb-2 pr-4">Snapshots</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr
                      key={session.id}
                      className={cn(
                        "border-b last:border-0 cursor-pointer transition-colors",
                        selectedSessionId === session.id
                          ? "bg-primary/10"
                          : "hover:bg-muted/50"
                      )}
                      onClick={() => setSelectedSessionId(session.id)}
                    >
                      <td className="py-2 pr-4">
                        <span className="font-medium">
                          {session.market_name.replace("Bitcoin Up or Down - ", "")}
                        </span>
                      </td>
                      <td className="py-2 pr-4 font-mono text-muted-foreground">
                        {new Date(session.created_at).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4">{session.tick_count}</td>
                      <td className="py-2 pr-4">{session.snapshot_count}</td>
                      <td className="py-2 pr-4">
                        {session.ended_at ? (
                          <span className="text-muted-foreground">Completed</span>
                        ) : (
                          <span className="text-green-500">Recording</span>
                        )}
                      </td>
                      <td className="py-2">
                        <button
                          onClick={(e) => handleDeleteSession(session.id, e)}
                          disabled={!session.ended_at}
                          className={cn(
                            "p-1 rounded hover:bg-red-500/20 transition-colors",
                            session.ended_at
                              ? "text-muted-foreground hover:text-red-500"
                              : "text-muted-foreground/30 cursor-not-allowed"
                          )}
                          title={session.ended_at ? "Delete session" : "Cannot delete active session"}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Status Badge Component
function RecorderStatusBadge({ state }: { state: string }) {
  const config: Record<string, { color: string; text: string }> = {
    idle: { color: "bg-muted", text: "Idle" },
    discovering: { color: "bg-yellow-500", text: "Discovering" },
    recording: { color: "bg-green-500", text: "Recording" },
    error: { color: "bg-red-500", text: "Error" },
  };

  const { color, text } = config[state] || config.idle;

  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          "w-2 h-2 rounded-full",
          color,
          state === "discovering" || state === "recording" ? "animate-pulse" : ""
        )}
      />
      <span className="text-sm">{text}</span>
    </div>
  );
}
