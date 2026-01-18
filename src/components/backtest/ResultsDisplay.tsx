"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Percent,
  BarChart3,
  Award,
  ChevronDown,
  ChevronRight,
  Download,
} from "lucide-react";
import type {
  BacktestResult,
  BacktestTrade,
  SessionBreakdown,
  OptimizationResult,
} from "@/lib/backtest/types";

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  subValue?: string;
  positive?: boolean;
}

function MetricCard({ icon, label, value, subValue, positive }: MetricCardProps) {
  return (
    <div className="bg-card border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <p
        className={`text-2xl font-bold ${
          positive === true
            ? "text-green-500"
            : positive === false
            ? "text-red-500"
            : ""
        }`}
      >
        {value}
      </p>
      {subValue && <p className="text-xs text-muted-foreground mt-1">{subValue}</p>}
    </div>
  );
}

interface SingleResultDisplayProps {
  result: BacktestResult;
}

function SingleResultDisplay({ result }: SingleResultDisplayProps) {
  const [showTrades, setShowTrades] = useState(false);
  const [showSessions, setShowSessions] = useState(false);

  const exportCsv = () => {
    const headers = [
      "Timestamp",
      "Side",
      "Outcome",
      "Price",
      "Quantity",
      "Value",
      "PnL",
      "Reason",
    ];
    const rows = result.trades.map((t) => [
      t.timestamp,
      t.side,
      t.outcome,
      t.price.toFixed(4),
      t.quantity.toString(),
      t.value.toFixed(2),
      t.pnl.toFixed(2),
      t.reason,
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backtest-${result.runId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          icon={<DollarSign className="w-4 h-4 text-green-500" />}
          label="Total PnL"
          value={`$${result.totalPnl.toFixed(2)}`}
          subValue={`${result.totalReturn >= 0 ? "+" : ""}${result.totalReturn.toFixed(2)}% return`}
          positive={result.totalPnl >= 0}
        />
        <MetricCard
          icon={<BarChart3 className="w-4 h-4 text-blue-500" />}
          label="Sharpe Ratio"
          value={result.sharpeRatio.toFixed(3)}
          subValue="Risk-adjusted return"
        />
        <MetricCard
          icon={<TrendingDown className="w-4 h-4 text-red-500" />}
          label="Max Drawdown"
          value={`${result.maxDrawdown.toFixed(2)}%`}
          positive={false}
        />
        <MetricCard
          icon={<Percent className="w-4 h-4 text-purple-500" />}
          label="Win Rate"
          value={`${result.winRate.toFixed(1)}%`}
          subValue={`${result.tradeCount} trades`}
        />
      </div>

      {/* Additional Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border rounded-lg p-3 text-center">
          <p className="text-xs text-muted-foreground">Avg Trade</p>
          <p className="font-mono font-medium">
            ${result.avgTradePnl.toFixed(2)}
          </p>
        </div>
        <div className="bg-card border rounded-lg p-3 text-center">
          <p className="text-xs text-muted-foreground">Max Win</p>
          <p className="font-mono font-medium text-green-500">
            ${result.maxWin.toFixed(2)}
          </p>
        </div>
        <div className="bg-card border rounded-lg p-3 text-center">
          <p className="text-xs text-muted-foreground">Max Loss</p>
          <p className="font-mono font-medium text-red-500">
            ${Math.abs(result.maxLoss).toFixed(2)}
          </p>
        </div>
        <div className="bg-card border rounded-lg p-3 text-center">
          <p className="text-xs text-muted-foreground">Profit Factor</p>
          <p className="font-mono font-medium">
            {result.profitFactor === Infinity
              ? "∞"
              : result.profitFactor.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Session Breakdown */}
      <div className="bg-card border rounded-lg">
        <button
          className="w-full p-4 flex items-center justify-between hover:bg-muted/50 transition-colors"
          onClick={() => setShowSessions(!showSessions)}
        >
          <span className="font-medium">Session Breakdown</span>
          {showSessions ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>
        {showSessions && (
          <div className="p-4 pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session</TableHead>
                  <TableHead className="text-right">PnL</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                  <TableHead className="text-right">Win Rate</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.sessionBreakdown.map((session) => (
                  <TableRow key={session.sessionId}>
                    <TableCell className="truncate max-w-[200px]">
                      {session.marketName}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono ${
                        session.pnl >= 0 ? "text-green-500" : "text-red-500"
                      }`}
                    >
                      ${session.pnl.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">{session.tradeCount}</TableCell>
                    <TableCell className="text-right">
                      {session.winRate.toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right">
                      {session.durationMinutes.toFixed(1)}m
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Trades Table */}
      <div className="bg-card border rounded-lg">
        <div className="p-4 flex items-center justify-between border-b">
          <button
            className="flex items-center gap-2 hover:text-foreground"
            onClick={() => setShowTrades(!showTrades)}
          >
            <span className="font-medium">Trade History</span>
            {showTrades ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="w-3 h-3 mr-1" />
            Export CSV
          </Button>
        </div>
        {showTrades && (
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">PnL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.trades.map((trade) => (
                  <TableRow key={trade.id}>
                    <TableCell className="text-xs">
                      {new Date(trade.timestamp).toLocaleTimeString()}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          trade.side === "BUY"
                            ? "bg-green-500/20 text-green-500"
                            : "bg-red-500/20 text-red-500"
                        }`}
                      >
                        {trade.side}
                      </span>
                    </TableCell>
                    <TableCell>{trade.outcome}</TableCell>
                    <TableCell className="text-right font-mono">
                      {trade.price.toFixed(4)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {trade.quantity}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono ${
                        trade.pnl > 0
                          ? "text-green-500"
                          : trade.pnl < 0
                          ? "text-red-500"
                          : ""
                      }`}
                    >
                      {trade.pnl !== 0 ? `$${trade.pnl.toFixed(2)}` : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

interface OptimizationResultsDisplayProps {
  results: OptimizationResult[];
  optimizeMetric: string;
  parameterNames?: string[];
}

function OptimizationResultsDisplay({
  results,
  optimizeMetric,
  parameterNames = [],
}: OptimizationResultsDisplayProps) {
  return (
    <div className="bg-card border rounded-lg">
      <div className="p-4 border-b flex items-center gap-2">
        <Award className="w-5 h-5 text-yellow-500" />
        <span className="font-medium">Top 10 Results</span>
        <span className="text-sm text-muted-foreground">
          (optimized for {optimizeMetric})
        </span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead className="text-right">PnL</TableHead>
              <TableHead className="text-right">Return</TableHead>
              <TableHead className="text-right">Sharpe</TableHead>
              <TableHead className="text-right">Drawdown</TableHead>
              <TableHead className="text-right">Win Rate</TableHead>
              <TableHead className="text-right">Trades</TableHead>
              <TableHead>Changed Parameters</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.slice(0, 10).map((result) => (
              <TableRow
                key={result.rank}
                className={result.rank === 1 ? "bg-yellow-500/10" : ""}
              >
                <TableCell className="font-bold">
                  {result.rank === 1 ? "🥇" : result.rank === 2 ? "🥈" : result.rank === 3 ? "🥉" : result.rank}
                </TableCell>
                <TableCell
                  className={`text-right font-mono ${
                    result.metrics.totalPnl >= 0 ? "text-green-500" : "text-red-500"
                  }`}
                >
                  ${result.metrics.totalPnl.toFixed(2)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {result.metrics.totalReturn.toFixed(2)}%
                </TableCell>
                <TableCell className="text-right font-mono">
                  {result.metrics.sharpeRatio.toFixed(3)}
                </TableCell>
                <TableCell className="text-right font-mono text-red-500">
                  {result.metrics.maxDrawdown.toFixed(2)}%
                </TableCell>
                <TableCell className="text-right font-mono">
                  {result.metrics.winRate.toFixed(1)}%
                </TableCell>
                <TableCell className="text-right">{result.metrics.tradeCount}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[300px]">
                  {parameterNames.length > 0
                    ? parameterNames
                        .map((name) => {
                          const value = result.params[name as keyof typeof result.params];
                          return `${name}=${typeof value === 'number' ? value.toFixed(2) : value}`;
                        })
                        .join(", ")
                    : Object.entries(result.params)
                        .filter(([_, v]) => v !== undefined)
                        .slice(0, 3)
                        .map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(2) : v}`)
                        .join(", ")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

interface ResultsDisplayProps {
  result?: BacktestResult | null;
  optimizationResults?: OptimizationResult[] | null;
  optimizeMetric?: string;
  parameterNames?: string[];
}

export function ResultsDisplay({
  result,
  optimizationResults,
  optimizeMetric = "sharpeRatio",
  parameterNames = [],
}: ResultsDisplayProps) {
  if (!result && !optimizationResults) {
    return (
      <div className="bg-card border rounded-lg p-6 text-center text-muted-foreground">
        Run a backtest to see results
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {optimizationResults && optimizationResults.length > 0 && (
        <OptimizationResultsDisplay
          results={optimizationResults}
          optimizeMetric={optimizeMetric}
          parameterNames={parameterNames}
        />
      )}
      {result && <SingleResultDisplay result={result} />}
    </div>
  );
}
