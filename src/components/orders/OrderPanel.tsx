"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Loader2, AlertTriangle, Minus, Plus, ChevronDown } from "lucide-react";
import type { Position, BotState } from "@/lib/bots/types";

interface OrderPanelProps {
  botId: string;
  botState: BotState;
  assetId?: string;
  noAssetId?: string;
  positions: Position[];
  bestBid: string | null;
  bestAsk: string | null;
  noBestBid: string | null;
  noBestAsk: string | null;
  formatPrice: (price: string | number) => string;
  onOrderSubmitted?: () => void;
}

type OrderSide = "BUY" | "SELL";
type OrderOutcome = "YES" | "NO";
type OrderType = "market" | "limit";

export function OrderPanel({
  botId,
  botState,
  assetId,
  noAssetId,
  positions,
  bestBid,
  bestAsk,
  noBestBid,
  noBestAsk,
  formatPrice,
  onOrderSubmitted,
}: OrderPanelProps) {
  const [side, setSide] = useState<OrderSide>("BUY");
  const [outcome, setOutcome] = useState<OrderOutcome>("YES");
  const [orderType, setOrderType] = useState<OrderType>("limit");
  const [price, setPrice] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Get position for selected outcome
  const currentPosition = useMemo(() => {
    const targetAssetId = outcome === "YES" ? assetId : noAssetId;
    return positions.find((p) => p.assetId === targetAssetId) || null;
  }, [positions, outcome, assetId, noAssetId]);

  const positionSize = currentPosition ? parseFloat(currentPosition.size) : 0;
  const avgEntryPrice = currentPosition ? parseFloat(currentPosition.avgEntryPrice) : 0;

  // Get best prices for selected outcome
  const currentBestBid = outcome === "YES" ? bestBid : noBestBid;
  const currentBestAsk = outcome === "YES" ? bestAsk : noBestAsk;

  // Auto-fill price only when side or outcome changes (not on every price tick)
  useEffect(() => {
    if (orderType === "limit") {
      const defaultPrice = side === "BUY" ? currentBestAsk : currentBestBid;
      if (defaultPrice) {
        setPrice(defaultPrice);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, outcome, orderType]); // Intentionally exclude price deps to avoid updates on every tick

  // Calculate estimated values
  const priceNum = parseFloat(price) || 0;
  const quantityNum = parseFloat(quantity) || 0;
  const estimatedCost = priceNum * quantityNum;
  const potentialProfit = side === "BUY"
    ? quantityNum * (1 - priceNum) // Profit if outcome wins
    : (priceNum - avgEntryPrice) * quantityNum; // Profit from selling

  // Validation
  const canSell = side === "SELL" && quantityNum <= positionSize;
  const hasValidPrice = priceNum > 0 && priceNum < 1;
  const hasValidQuantity = quantityNum > 0;
  const hasAssetId = outcome === "YES" ? !!assetId : !!noAssetId;

  const isValid = useMemo(() => {
    if (!hasAssetId) return false;
    if (!hasValidQuantity) return false;
    if (orderType === "limit" && !hasValidPrice) return false;
    if (side === "SELL" && !canSell) return false;
    return true;
  }, [hasAssetId, hasValidQuantity, hasValidPrice, orderType, side, canSell]);

  // Adjust price
  const adjustPrice = useCallback((delta: number) => {
    const current = parseFloat(price) || 0;
    const newPrice = Math.max(0.01, Math.min(0.99, current + delta));
    setPrice(newPrice.toFixed(2));
  }, [price]);

  // Adjust quantity
  const adjustQuantity = useCallback((delta: number) => {
    const current = parseFloat(quantity) || 0;
    const newQty = Math.max(0, current + delta);
    setQuantity(newQty.toString());
  }, [quantity]);

  // Set max quantity for SELL
  const setMaxQuantity = useCallback(() => {
    if (positionSize > 0) {
      setQuantity(Math.floor(positionSize).toString());
    }
  }, [positionSize]);

  // Submit order
  const handleSubmit = async () => {
    if (!isValid) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/bots/${botId}/manual-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: side,
          outcome,
          orderType,
          price: orderType === "limit" ? price : undefined,
          quantity,
        }),
      });

      const data = await response.json();

      if (data.success) {
        const filledMsg = data.data.filled ? " (filled)" : " (pending)";
        setSuccess(`Order created${filledMsg}`);
        setQuantity("");
        onOrderSubmitted?.();

        // Clear success message after 3 seconds
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(data.error || "Failed to create order");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create order");
    } finally {
      setLoading(false);
    }
  };

  // Check if NO outcome is available
  const hasNoAsset = !!noAssetId;

  return (
    <div className="bg-card border rounded-lg p-4 flex flex-col h-full">
      <h2 className="font-semibold mb-3">Manual Order</h2>

      {/* Warning for running bot */}
      {botState === "running" && (
        <div className="flex items-center gap-2 text-xs text-yellow-500 bg-yellow-500/10 rounded px-2 py-1.5 mb-3">
          <AlertTriangle className="w-3 h-3" />
          <span>Bot is running - orders may conflict with strategy</span>
        </div>
      )}

      {/* Buy/Sell Toggle + Order Type */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex rounded-md overflow-hidden border">
          <button
            onClick={() => setSide("BUY")}
            className={cn(
              "px-4 py-1.5 text-sm font-medium transition-colors",
              side === "BUY"
                ? "bg-green-500 text-white"
                : "bg-background hover:bg-muted"
            )}
          >
            Buy
          </button>
          <button
            onClick={() => setSide("SELL")}
            className={cn(
              "px-4 py-1.5 text-sm font-medium transition-colors",
              side === "SELL"
                ? "bg-red-500 text-white"
                : "bg-background hover:bg-muted"
            )}
          >
            Sell
          </button>
        </div>

        {/* Order Type Dropdown */}
        <div className="relative">
          <select
            value={orderType}
            onChange={(e) => setOrderType(e.target.value as OrderType)}
            className="appearance-none bg-background border rounded-md px-3 py-1.5 pr-8 text-sm cursor-pointer"
          >
            <option value="limit">Limit</option>
            <option value="market">Market</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        </div>
      </div>

      {/* Outcome Selection */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          onClick={() => setOutcome("YES")}
          disabled={!assetId}
          className={cn(
            "flex flex-col items-center justify-center py-2 rounded-md border transition-colors",
            outcome === "YES"
              ? "bg-green-500/20 border-green-500 text-green-500"
              : "bg-background hover:bg-muted border-muted",
            !assetId && "opacity-50 cursor-not-allowed"
          )}
        >
          <span className="font-medium">YES</span>
          <span className="text-xs opacity-75">
            {bestAsk ? `${(parseFloat(bestAsk) * 100).toFixed(0)}c` : "—"}
          </span>
        </button>
        <button
          onClick={() => setOutcome("NO")}
          disabled={!hasNoAsset}
          className={cn(
            "flex flex-col items-center justify-center py-2 rounded-md border transition-colors",
            outcome === "NO"
              ? "bg-red-500/20 border-red-500 text-red-500"
              : "bg-background hover:bg-muted border-muted",
            !hasNoAsset && "opacity-50 cursor-not-allowed"
          )}
        >
          <span className="font-medium">NO</span>
          <span className="text-xs opacity-75">
            {noBestAsk ? `${(parseFloat(noBestAsk) * 100).toFixed(0)}c` : "—"}
          </span>
        </button>
      </div>

      {/* Limit Price (only for limit orders) */}
      {orderType === "limit" && (
        <div className="mb-4">
          <label className="block text-xs text-muted-foreground mb-1">
            Limit Price
          </label>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => adjustPrice(-0.01)}
              disabled={loading}
            >
              <Minus className="w-3 h-3" />
            </Button>
            <Input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              step="0.01"
              min="0.01"
              max="0.99"
              className="text-center font-mono"
              disabled={loading}
            />
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => adjustPrice(0.01)}
              disabled={loading}
            >
              <Plus className="w-3 h-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Shares/Quantity */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-muted-foreground">Shares</label>
          {side === "SELL" && positionSize > 0 && (
            <button
              onClick={setMaxQuantity}
              className="text-xs text-primary hover:underline"
              disabled={loading}
            >
              Max: {Math.floor(positionSize)}
            </button>
          )}
        </div>
        <Input
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="0"
          min="1"
          className="text-center font-mono mb-2"
          disabled={loading}
        />
        <div className="flex gap-1">
          {[-100, -10, 10, 100].map((delta) => (
            <Button
              key={delta}
              variant="outline"
              size="sm"
              onClick={() => adjustQuantity(delta)}
              disabled={loading}
              className="flex-1 text-xs"
            >
              {delta > 0 ? `+${delta}` : delta}
            </Button>
          ))}
        </div>
      </div>

      {/* Order Summary */}
      <div className="space-y-1 mb-4 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Est. Cost</span>
          <span className="font-mono">${estimatedCost.toFixed(2)}</span>
        </div>
        {side === "BUY" && quantityNum > 0 && priceNum > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Potential Win</span>
            <span className="font-mono text-green-500">
              +${potentialProfit.toFixed(2)}
            </span>
          </div>
        )}
        {side === "SELL" && quantityNum > 0 && avgEntryPrice > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">P&L</span>
            <span className={cn(
              "font-mono",
              potentialProfit >= 0 ? "text-green-500" : "text-red-500"
            )}>
              {potentialProfit >= 0 ? "+" : ""}${potentialProfit.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {/* Error/Success Messages */}
      {error && (
        <p className="text-xs text-red-500 mb-2">{error}</p>
      )}
      {success && (
        <p className="text-xs text-green-500 mb-2">{success}</p>
      )}

      {/* Validation Messages */}
      {!hasAssetId && (
        <p className="text-xs text-muted-foreground mb-2">
          No {outcome} asset configured for this bot
        </p>
      )}
      {side === "SELL" && quantityNum > positionSize && positionSize >= 0 && (
        <p className="text-xs text-red-500 mb-2">
          Cannot sell {quantityNum} - only {positionSize.toFixed(0)} owned
        </p>
      )}

      {/* Submit Button */}
      <Button
        onClick={handleSubmit}
        disabled={!isValid || loading}
        className={cn(
          "w-full mt-auto",
          side === "BUY"
            ? "bg-green-500 hover:bg-green-600"
            : "bg-red-500 hover:bg-red-600"
        )}
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Submitting...
          </>
        ) : (
          `${side} ${outcome}`
        )}
      </Button>
    </div>
  );
}
