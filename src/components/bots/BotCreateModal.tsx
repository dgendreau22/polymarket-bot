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
  defaultStrategySlug?: string;
}

export function BotCreateModal({
  isOpen,
  onClose,
  onCreated,
  defaultMarketId = "",
  defaultMarketName = "",
  defaultStrategySlug = "",
}: BotCreateModalProps) {
  const router = useRouter();
  const [strategies, setStrategies] = useState<StrategyDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [strategySlug, setStrategySlug] = useState(defaultStrategySlug);
  const [marketId, setMarketId] = useState(defaultMarketId);
  const [marketName, setMarketName] = useState(defaultMarketName);
  const [mode, setMode] = useState<"live" | "dry_run">("dry_run");
  const [strategyConfig, setStrategyConfig] = useState<Record<string, unknown>>({});

  // Update state when defaults change or modal opens
  useEffect(() => {
    if (isOpen) {
      setMarketId(defaultMarketId);
      setMarketName(defaultMarketName);
      if (defaultStrategySlug) {
        setStrategySlug(defaultStrategySlug);
      }
      fetchStrategies();
    }
  }, [isOpen, defaultMarketId, defaultMarketName, defaultStrategySlug]);

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

  // Get the currently selected strategy
  const selectedStrategy = strategies.find((s) => s.slug === strategySlug);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategySlug,
          marketId,
          marketName: marketName || undefined,
          mode,
          strategyConfig,
        }),
      });

      const data = await res.json();

      if (data.success) {
        const createdBotId = data.data?.config?.id;
        onCreated?.();
        onClose();
        // Reset form
        setMarketId(defaultMarketId);
        setMarketName(defaultMarketName);
        setStrategySlug(defaultStrategySlug);
        setStrategyConfig({});
        // Navigate to the bot's page
        router.push(`/bots/${createdBotId}`);
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
      <div className="bg-card border rounded-lg p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
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

          {/* Strategy Parameters */}
          {selectedStrategy?.parameters && selectedStrategy.parameters.length > 0 && (
            <div className="border-t pt-4">
              <h3 className="text-sm font-medium mb-3">Strategy Parameters</h3>
              <div className="space-y-3">
                {selectedStrategy.parameters.map((param) => (
                  <div key={param.name}>
                    <label className="block text-sm font-medium mb-1">
                      {param.name}
                      {!param.required && (
                        <span className="text-muted-foreground ml-1">(optional)</span>
                      )}
                    </label>
                    {param.type === "boolean" ? (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(strategyConfig[param.name])}
                          onChange={(e) => updateParam(param.name, e.target.checked)}
                        />
                        <span className="text-sm text-muted-foreground">
                          {param.description}
                        </span>
                      </label>
                    ) : (
                      <>
                        <Input
                          type={param.type === "number" ? "number" : "text"}
                          value={String(strategyConfig[param.name] ?? param.default)}
                          onChange={(e) =>
                            updateParam(
                              param.name,
                              param.type === "number"
                                ? parseFloat(e.target.value) || 0
                                : e.target.value
                            )
                          }
                          min={param.min}
                          max={param.max}
                          step={param.type === "number" ? "any" : undefined}
                          required={param.required}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          {param.description}
                          {param.min !== undefined && param.max !== undefined && (
                            <span className="ml-1">
                              (Range: {param.min} - {param.max})
                            </span>
                          )}
                        </p>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

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
