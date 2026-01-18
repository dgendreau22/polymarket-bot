"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Loader2, Save, DollarSign, BarChart3, Percent } from "lucide-react";

interface SavePresetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
  strategySlug: string;
  params: Record<string, number>;
  metrics: {
    totalPnl: number;
    sharpeRatio: number;
    winRate: number;
  };
  sourceOptimizationId?: string;
}

export function SavePresetModal({
  isOpen,
  onClose,
  onSaved,
  strategySlug,
  params,
  metrics,
  sourceOptimizationId,
}: SavePresetModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/strategies/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          strategySlug,
          description: description || undefined,
          params,
          sourceOptimizationId,
          finalSharpe: metrics.sharpeRatio,
          finalPnl: metrics.totalPnl,
          finalWinRate: metrics.winRate,
        }),
      });

      const data = await res.json();

      if (data.success) {
        onSaved?.();
        onClose();
        // Reset form
        setName("");
        setDescription("");
      } else {
        setError(data.error || "Failed to save preset");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save preset");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border rounded-lg p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Save className="w-5 h-5 text-green-500" />
            <h2 className="text-lg font-semibold">Save Preset</h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Metrics Preview */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <DollarSign className="w-4 h-4 mx-auto mb-1 text-green-500" />
            <p className={`font-bold ${metrics.totalPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
              ${metrics.totalPnl.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">PnL</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <BarChart3 className="w-4 h-4 mx-auto mb-1 text-blue-500" />
            <p className="font-bold">{metrics.sharpeRatio.toFixed(3)}</p>
            <p className="text-xs text-muted-foreground">Sharpe</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <Percent className="w-4 h-4 mx-auto mb-1 text-purple-500" />
            <p className="font-bold">{metrics.winRate.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">Win Rate</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Preset Name <span className="text-red-500">*</span>
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., High Sharpe Config v1"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Description <span className="text-muted-foreground">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notes about this configuration..."
              className="w-full border rounded-md px-3 py-2 bg-background text-sm min-h-[80px] resize-none"
            />
          </div>

          {/* Parameters Preview */}
          <div>
            <label className="block text-sm font-medium mb-2">Parameters</label>
            <div className="bg-muted/30 rounded-lg p-3 max-h-32 overflow-y-auto">
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(params)
                  .filter(([key]) => !["E_override", "EV_min", "m", "T_flat"].includes(key))
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([key, value]) => (
                    <span
                      key={key}
                      className="bg-muted px-2 py-0.5 rounded text-xs font-mono"
                    >
                      {key}={typeof value === "number" ? (value < 1 ? value.toFixed(4) : value < 10 ? value.toFixed(2) : value.toFixed(0)) : value}
                    </span>
                  ))}
              </div>
            </div>
          </div>

          {/* Error */}
          {error && <p className="text-sm text-red-500">{error}</p>}

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save Preset
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
