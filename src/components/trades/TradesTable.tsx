"use client";

import { format } from "date-fns";
import type { Trade } from "@/lib/bots/types";
import { TrendingUp, TrendingDown } from "lucide-react";

interface TradesTableProps {
  trades: Trade[];
  showBotName?: boolean;
  formatPrice?: (price: string | number) => string;
}

interface AggregatedTrade extends Omit<Trade, 'id'> {
  id: string;
  count: number;
}

// Safely parse date from various formats (Date object, ISO string, or timestamp)
function safeParseDate(value: Date | string | number | undefined | null): Date {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

// Aggregate trades that happen at the same time (same second), price, side, and outcome
function aggregateTrades(trades: Trade[]): AggregatedTrade[] {
  const aggregated: AggregatedTrade[] = [];
  const seen = new Map<string, number>(); // key -> index in aggregated array

  for (const trade of trades) {
    // Create key from time (truncated to second), side, outcome, price
    const tradeDate = safeParseDate(trade.executedAt);
    const timeKey = format(tradeDate, "yyyy-MM-dd HH:mm:ss");
    const key = `${timeKey}-${trade.side}-${trade.outcome}-${trade.price}`;

    const existingIndex = seen.get(key);
    if (existingIndex !== undefined) {
      // Aggregate with existing trade
      const existing = aggregated[existingIndex];
      const newQty = parseFloat(existing.quantity) + parseFloat(trade.quantity);
      const newValue = parseFloat(existing.totalValue) + parseFloat(trade.totalValue);
      const newPnl = parseFloat(existing.pnl) + parseFloat(trade.pnl);

      existing.quantity = newQty.toFixed(2);
      existing.totalValue = newValue.toFixed(2);
      existing.pnl = newPnl.toFixed(6);
      existing.count++;
    } else {
      // Add new aggregated trade
      seen.set(key, aggregated.length);
      aggregated.push({
        ...trade,
        count: 1,
      });
    }
  }

  return aggregated;
}

export function TradesTable({ trades, showBotName = false, formatPrice }: TradesTableProps) {
  // Default to 4 decimals if no formatPrice provided
  const fmtPrice = formatPrice || ((p: string | number) => parseFloat(String(p)).toFixed(4));

  if (trades.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No trades found
      </div>
    );
  }

  // Aggregate trades with same time, price, side, outcome
  const aggregatedTrades = aggregateTrades(trades);

  return (
    <table className="w-full text-sm table-fixed">
      <thead className="sticky top-0 bg-card z-10">
        <tr className="border-b text-left text-muted-foreground">
          <th className="pb-2 pr-2 pt-1 bg-card w-[90px]">Time</th>
          {showBotName && <th className="pb-2 pr-2 pt-1 bg-card">Bot</th>}
          <th className="pb-2 pr-2 pt-1 bg-card w-[65px]">Side</th>
          <th className="pb-2 pr-2 pt-1 bg-card w-[28px]"></th>
          <th className="pb-2 pr-2 pt-1 text-right bg-card">Price</th>
          <th className="pb-2 pr-2 pt-1 text-right bg-card w-[50px]">Qty</th>
          <th className="pb-2 pr-2 pt-1 text-right bg-card">Value</th>
          <th className="pb-2 pt-1 text-right bg-card w-[60px]">PnL</th>
        </tr>
      </thead>
      <tbody>
          {aggregatedTrades.map((trade) => {
            const pnl = parseFloat(trade.pnl);
            return (
              <tr key={trade.id} className="border-b last:border-0">
                <td className="py-1.5 pr-2 text-muted-foreground text-xs truncate">
                  {format(safeParseDate(trade.executedAt), "HH:mm:ss")}
                </td>
                {showBotName && (
                  <td className="py-1.5 pr-2 truncate max-w-[100px]">
                    {trade.botName || trade.botId.slice(0, 8) + '...'}
                  </td>
                )}
                <td className="py-1.5 pr-2">
                  <span
                    className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                      trade.side === "BUY"
                        ? "bg-green-500/20 text-green-500"
                        : "bg-red-500/20 text-red-500"
                    }`}
                  >
                    {trade.side}
                    {trade.count > 1 && (
                      <span className="ml-1 opacity-70">({trade.count})</span>
                    )}
                  </span>
                </td>
                <td className="py-1.5 pr-2">
                  <span
                    className={`w-5 h-5 inline-flex items-center justify-center rounded text-xs font-medium ${
                      trade.outcome === "YES"
                        ? "bg-green-500/20 text-green-500"
                        : "bg-red-500/20 text-red-500"
                    }`}
                  >
                    {trade.outcome === "YES" ? "Y" : "N"}
                  </span>
                </td>
                <td className="py-1.5 pr-2 text-right font-mono">
                  {fmtPrice(trade.price)}
                </td>
                <td className="py-1.5 pr-2 text-right font-mono">
                  {parseFloat(trade.quantity).toFixed(1)}
                </td>
                <td className="py-1.5 pr-2 text-right font-mono">
                  {fmtPrice(trade.totalValue)}
                </td>
                <td className="py-1.5 text-right">
                  {trade.side === "SELL" ? (
                    <span
                      className={`font-mono text-xs ${
                        pnl >= 0 ? "text-green-500" : "text-red-500"
                      }`}
                    >
                      {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
  );
}
