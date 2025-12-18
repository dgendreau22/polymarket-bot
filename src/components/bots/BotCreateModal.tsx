"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Loader2 } from "lucide-react";
import type { StrategyDefinition } from "@/lib/bots/types";

interface BotCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => void;
  defaultMarketId?: string;
  defaultMarketName?: string;
  defaultAssetId?: string;
  defaultStrategySlug?: string;
}

export function BotCreateModal({
  isOpen,
  onClose,
  onCreated,
  defaultMarketId = "",
  defaultMarketName = "",
  defaultAssetId = "",
  defaultStrategySlug = "",
}: BotCreateModalProps) {
  const router = useRouter();
  const [strategies, setStrategies] = useState<StrategyDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [strategySlug, setStrategySlug] = useState(defaultStrategySlug);
  const [marketId, setMarketId] = useState(defaultMarketId);
  const [marketName, setMarketName] = useState(defaultMarketName);
  const [assetId, setAssetId] = useState(defaultAssetId);
  const [mode, setMode] = useState<"live" | "dry_run">("dry_run");
  const [interval, setInterval] = useState(5000);

  // Update state when defaults change or modal opens
  useEffect(() => {
    if (isOpen) {
      setMarketId(defaultMarketId);
      setMarketName(defaultMarketName);
      setAssetId(defaultAssetId);
      if (defaultStrategySlug) {
        setStrategySlug(defaultStrategySlug);
      }
      fetchStrategies();
    }
  }, [isOpen, defaultMarketId, defaultMarketName, defaultAssetId, defaultStrategySlug]);

  const fetchStrategies = async () => {
    try {
      const res = await fetch("/api/strategies");
      const data = await res.json();
      if (data.success) {
        setStrategies(data.data);
        // Use defaultStrategySlug if provided, otherwise use first strategy
        if (data.data.length > 0 && !strategySlug) {
          setStrategySlug(defaultStrategySlug || data.data[0].slug);
        }
      }
    } catch (err) {
      console.error("Failed to fetch strategies:", err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          strategySlug,
          marketId,
          marketName: marketName || undefined,
          assetId: assetId || undefined,
          mode,
          strategyConfig: {
            interval,
          },
        }),
      });

      const data = await res.json();

      if (data.success) {
        onCreated?.();
        onClose();
        // Reset form
        setName("");
        setMarketId(defaultMarketId);
        setMarketName(defaultMarketName);
        setAssetId(defaultAssetId);
        setStrategySlug(defaultStrategySlug);
        // Navigate to the strategy page
        router.push(`/strategies/${strategySlug}`);
      } else {
        setError(data.error || "Failed to create bot");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create bot");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border rounded-lg p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Create New Bot</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1">Bot Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Test Bot"
              required
            />
          </div>

          {/* Strategy */}
          <div>
            <label className="block text-sm font-medium mb-1">Strategy</label>
            <select
              value={strategySlug}
              onChange={(e) => setStrategySlug(e.target.value)}
              className="w-full border rounded-md px-3 py-2 bg-background"
              required
            >
              {strategies.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Market ID */}
          <div>
            <label className="block text-sm font-medium mb-1">Market ID</label>
            <Input
              value={marketId}
              onChange={(e) => setMarketId(e.target.value)}
              placeholder="0x..."
              required
            />
          </div>

          {/* Asset ID (Optional) */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Asset ID (Token ID)
              <span className="text-muted-foreground ml-1">(optional)</span>
            </label>
            <Input
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              placeholder="0x..."
            />
          </div>

          {/* Mode */}
          <div>
            <label className="block text-sm font-medium mb-1">Mode</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="mode"
                  value="dry_run"
                  checked={mode === "dry_run"}
                  onChange={() => setMode("dry_run")}
                />
                <span>Dry Run</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="mode"
                  value="live"
                  checked={mode === "live"}
                  onChange={() => setMode("live")}
                />
                <span>Live</span>
              </label>
            </div>
            {mode === "live" && (
              <p className="text-xs text-yellow-500 mt-1">
                Warning: Live mode will execute real trades
              </p>
            )}
          </div>

          {/* Interval */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Execution Interval (ms)
            </label>
            <Input
              type="number"
              value={interval}
              onChange={(e) => setInterval(parseInt(e.target.value))}
              min={1000}
              max={60000}
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Creating...
                </>
              ) : (
                "Create Bot"
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
