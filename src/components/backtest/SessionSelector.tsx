"use client";

import { useState, useEffect, useCallback } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { RefreshCw, Database, Clock, BarChart3 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface RecordingSession {
  id: string;
  marketId: string;
  marketName: string;
  eventSlug: string;
  startTime: string;
  endTime: string;
  tickCount: number;
  snapshotCount: number;
  createdAt: string;
  endedAt: string | null;
  stats: {
    priceRange: { yes: [number, number]; no: [number, number] };
    avgVolume: { yes: number; no: number };
    volatility: { yes: number; no: number };
  } | null;
}

interface SessionSelectorProps {
  selectedSessions: string[];
  onSelectionChange: (sessionIds: string[]) => void;
}

export function SessionSelector({
  selectedSessions,
  onSelectionChange,
}: SessionSelectorProps) {
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/backtest/sessions");
      const data = await res.json();
      if (data.sessions) {
        setSessions(data.sessions);
      } else {
        setError(data.error || "Failed to fetch sessions");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const toggleSession = (sessionId: string) => {
    if (selectedSessions.includes(sessionId)) {
      onSelectionChange(selectedSessions.filter((id) => id !== sessionId));
    } else {
      onSelectionChange([...selectedSessions, sessionId]);
    }
  };

  const selectAll = () => {
    onSelectionChange(sessions.map((s) => s.id));
  };

  const selectNone = () => {
    onSelectionChange([]);
  };

  const getDuration = (start: string, end: string) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const durationMs = endDate.getTime() - startDate.getTime();
    const minutes = Math.floor(durationMs / (1000 * 60));
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  };

  if (loading) {
    return (
      <div className="bg-card border rounded-lg p-6">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Loading sessions...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-card border rounded-lg p-6">
        <div className="text-center text-destructive">{error}</div>
        <div className="text-center mt-2">
          <Button variant="outline" size="sm" onClick={fetchSessions}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border rounded-lg">
      <div className="p-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-blue-500" />
          <div>
            <h3 className="font-semibold">Recording Sessions</h3>
            <p className="text-xs text-muted-foreground">
              {selectedSessions.length} of {sessions.length} selected
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={selectAll}>
            Select All
          </Button>
          <Button variant="ghost" size="sm" onClick={selectNone}>
            Clear
          </Button>
          <Button variant="outline" size="sm" onClick={fetchSessions}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="p-6 text-center text-muted-foreground">
          No recording sessions found. Record some market data first.
        </div>
      ) : (
        <div className="divide-y max-h-80 overflow-y-auto">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`p-4 hover:bg-muted/50 transition-colors cursor-pointer ${
                selectedSessions.includes(session.id) ? "bg-muted/30" : ""
              }`}
              onClick={() => toggleSession(session.id)}
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={selectedSessions.includes(session.id)}
                  onCheckedChange={() => toggleSession(session.id)}
                  onClick={(e) => e.stopPropagation()}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">
                    {session.marketName}
                  </p>
                  <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {getDuration(session.startTime, session.endTime)}
                    </span>
                    <span className="flex items-center gap-1">
                      <BarChart3 className="w-3 h-3" />
                      {session.tickCount.toLocaleString()} ticks
                    </span>
                    <span>
                      {formatDistanceToNow(new Date(session.createdAt), {
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                  {session.stats && (
                    <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                      <span>
                        YES: {(session.stats.priceRange.yes[0] * 100).toFixed(1)}% -{" "}
                        {(session.stats.priceRange.yes[1] * 100).toFixed(1)}%
                      </span>
                      <span>
                        Vol: {(session.stats.volatility.yes * 100).toFixed(2)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
