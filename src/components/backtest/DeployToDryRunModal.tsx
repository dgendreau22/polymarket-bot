"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Loader2, Rocket, Search, CheckCircle } from "lucide-react";

interface Market {
  id: string;
  question: string;
  outcomePrices?: string[];
  volume?: string;
  active: boolean;
}

interface DeployToDryRunModalProps {
  isOpen: boolean;
  onClose: () => void;
  strategySlug: string;
  params: Record<string, number>;
}

export function DeployToDryRunModal({
  isOpen,
  onClose,
  strategySlug,
  params,
}: DeployToDryRunModalProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Market[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [searching, setSearching] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced search
  const searchMarkets = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const res = await fetch(`/api/markets/search?q=${encodeURIComponent(query)}&limit=10`);
      const data = await res.json();
      if (data.success) {
        setSearchResults(data.data.filter((m: Market) => m.active));
      }
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setSearching(false);
    }
  }, []);

  // Debounce effect
  useEffect(() => {
    const timer = setTimeout(() => {
      searchMarkets(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchMarkets]);

  const handleDeploy = async () => {
    if (!selectedMarket) return;

    setDeploying(true);
    setError(null);

    try {
      const res = await fetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategySlug,
          marketId: selectedMarket.id,
          marketName: selectedMarket.question,
          mode: "dry_run",
          strategyConfig: params,
        }),
      });

      const data = await res.json();

      if (data.success) {
        const createdBotId = data.data?.config?.id;
        onClose();
        router.push(`/bots/${createdBotId}`);
      } else {
        setError(data.error || "Failed to create bot");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create bot");
    } finally {
      setDeploying(false);
    }
  };

  const formatPrice = (priceStr: string): string => {
    const price = parseFloat(priceStr);
    return isNaN(price) ? "N/A" : `${(price * 100).toFixed(0)}%`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border rounded-lg p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Rocket className="w-5 h-5 text-blue-500" />
            <h2 className="text-lg font-semibold">Deploy to Dry Run</h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Strategy Info */}
        <div className="bg-muted/30 rounded-lg p-3 mb-4">
          <p className="text-sm">
            <span className="text-muted-foreground">Strategy:</span>{" "}
            <span className="font-medium">{strategySlug}</span>
          </p>
          <p className="text-sm mt-1">
            <span className="text-muted-foreground">Mode:</span>{" "}
            <span className="font-medium text-yellow-500">Dry Run</span>
          </p>
        </div>

        {/* Search Input */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search for a market..."
            className="pl-10"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Search Results */}
        <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[300px] border rounded-lg">
          {searchResults.length === 0 && searchQuery.trim() && !searching ? (
            <div className="p-4 text-center text-muted-foreground">
              No markets found
            </div>
          ) : searchResults.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              Search for a market to deploy
            </div>
          ) : (
            <div className="divide-y">
              {searchResults.map((market) => (
                <button
                  key={market.id}
                  onClick={() => setSelectedMarket(market)}
                  className={`w-full p-3 text-left hover:bg-muted/50 transition-colors flex items-start gap-3 ${
                    selectedMarket?.id === market.id ? "bg-muted/50" : ""
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium line-clamp-2">
                      {market.question}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {market.outcomePrices && market.outcomePrices[0] && (
                        <span className="text-xs text-muted-foreground">
                          YES: {formatPrice(market.outcomePrices[0])}
                        </span>
                      )}
                      {market.volume && (
                        <span className="text-xs text-muted-foreground">
                          Vol: ${parseFloat(market.volume).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                  {selectedMarket?.id === market.id && (
                    <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected Market Preview */}
        {selectedMarket && (
          <div className="mt-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
            <p className="text-sm font-medium text-green-700 dark:text-green-300">
              Selected: {selectedMarket.question}
            </p>
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              {selectedMarket.id}
            </p>
          </div>
        )}

        {/* Error */}
        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleDeploy}
            disabled={deploying || !selectedMarket}
          >
            {deploying ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Deploying...
              </>
            ) : (
              <>
                <Rocket className="w-4 h-4 mr-2" />
                Deploy Bot
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
