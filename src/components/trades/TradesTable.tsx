"use client";

import { format } from "date-fns";
import type { Trade } from "@/lib/bots/types";
import { TrendingUp, TrendingDown } from "lucide-react";

interface TradesTableProps {
  trades: Trade[];
  showBotName?: boolean;
}

export function TradesTable({ trades, showBotName = false }: TradesTableProps) {
  if (trades.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No trades found
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-card z-10">
        <tr className="border-b text-left text-muted-foreground">
          <th className="pb-2 pr-4 pt-1 bg-card">Time</th>
          {showBotName && <th className="pb-2 pr-4 pt-1 bg-card">Bot</th>}
          <th className="pb-2 pr-4 pt-1 bg-card">Side</th>
          <th className="pb-2 pr-4 pt-1 bg-card">Outcome</th>
          <th className="pb-2 pr-4 pt-1 text-right bg-card">Price</th>
          <th className="pb-2 pr-4 pt-1 text-right bg-card">Qty</th>
          <th className="pb-2 pr-4 pt-1 text-right bg-card">Value</th>
          <th className="pb-2 pt-1 text-right bg-card">PnL</th>
        </tr>
      </thead>
      <tbody>
          {trades.map((trade) => {
            const pnl = parseFloat(trade.pnl);
            return (
              <tr key={trade.id} className="border-b last:border-0">
                <td className="py-2 pr-4 text-muted-foreground">
                  {format(new Date(trade.executedAt), "MMM d, HH:mm:ss")}
                </td>
                {showBotName && (
                  <td className="py-2 pr-4 truncate max-w-[150px]">
                    {trade.botName || trade.botId.slice(0, 8) + '...'}
                  </td>
                )}
                <td className="py-2 pr-4">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      trade.side === "BUY"
                        ? "bg-green-500/20 text-green-500"
                        : "bg-red-500/20 text-red-500"
                    }`}
                  >
                    {trade.side}
                  </span>
                </td>
                <td className="py-2 pr-4">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      trade.outcome === "YES"
                        ? "bg-blue-500/20 text-blue-500"
                        : "bg-purple-500/20 text-purple-500"
                    }`}
                  >
                    {trade.outcome}
                  </span>
                </td>
                <td className="py-2 pr-4 text-right font-mono">
                  ${parseFloat(trade.price).toFixed(4)}
                </td>
                <td className="py-2 pr-4 text-right font-mono">
                  {trade.quantity}
                </td>
                <td className="py-2 pr-4 text-right font-mono">
                  ${parseFloat(trade.totalValue).toFixed(4)}
                </td>
                <td className="py-2 text-right">
                  {trade.side === "SELL" ? (
                    <div className="flex items-center justify-end gap-1">
                      {pnl >= 0 ? (
                        <TrendingUp className="w-3 h-3 text-green-500" />
                      ) : (
                        <TrendingDown className="w-3 h-3 text-red-500" />
                      )}
                      <span
                        className={`font-mono ${
                          pnl >= 0 ? "text-green-500" : "text-red-500"
                        }`}
                      >
                        ${pnl.toFixed(4)}
                      </span>
                    </div>
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
