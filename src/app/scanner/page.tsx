"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, AlertCircle, Search, ArrowLeft, ExternalLink, CalendarIcon, Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScanResult {
  marketId: string;
  question: string;
  strike: number;
  settlementDate: string;
  yesBid: number;
  yesAsk: number;
  noBid: number;
  noAsk: number;
  yesBidSize: number;
  yesAskSize: number;
  noBidSize: number;
  noAskSize: number;
  yesLastTrade: number | null;
  noLastTrade: number | null;
  yesSpread: number;
  noSpread: number;
  theoreticalYes: number;
  theoreticalNo: number;
  interpolatedIV: number;
  confidence: "high" | "medium" | "low";
  yesEdge: number | null;
  noEdge: number | null;
  bestEdge: number | null;
  hasOpportunity: boolean;
  yesHasLiquidity: boolean;
  noHasLiquidity: boolean;
}

interface ScanResponse {
  success: boolean;
  data?: {
    settlementDate: string;
    strikeRange: number | null;
    scannedAt: string;
    marketCount: number;
    opportunityCount: number;
    results: ScanResult[];
  };
  error?: string;
}

const STRIKE_RANGE_OPTIONS = [
  { label: "10%", value: 10 },
  { label: "15%", value: 15 },
  { label: "20%", value: 20, default: true },
  { label: "30%", value: 30 },
  { label: "All", value: 0 },
];

export default function ScannerPage() {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  });
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [scanData, setScanData] = useState<ScanResponse["data"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [isAutoRefresh, setIsAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(60);
  const [countdown, setCountdown] = useState(0);
  const [strikeRange, setStrikeRange] = useState(20); // Default 20%

  const intervalOptions = [
    { label: "30s", value: 30 },
    { label: "60s", value: 60 },
    { label: "2m", value: 120 },
    { label: "5m", value: 300 },
  ];

  // Format date as YYYY-MM-DD for API
  const formatDateForApi = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const handleScan = useCallback(async () => {
    if (!selectedDate) {
      setError("Please select a settlement date");
      return;
    }

    setLoading(true);
    setError(null);
    setHasScanned(true);

    try {
      const dateStr = formatDateForApi(selectedDate);
      const url = `/api/scanner/smile-arb-iv?settlementDate=${encodeURIComponent(dateStr)}${strikeRange > 0 ? `&strikeRange=${strikeRange}` : ''}`;
      const response = await fetch(url);
      const data: ScanResponse = await response.json();

      if (data.success && data.data) {
        setScanData(data.data);
      } else {
        setError(data.error || "Failed to scan markets");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to scan markets");
    } finally {
      setLoading(false);
    }
  }, [selectedDate, strikeRange]);

  // Auto-refresh effect
  useEffect(() => {
    if (!isAutoRefresh || loading) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          handleScan();
          return refreshInterval;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isAutoRefresh, loading, refreshInterval, handleScan]);

  // Reset countdown when starting auto-refresh or changing interval
  const handleToggleAutoRefresh = () => {
    if (!isAutoRefresh) {
      setCountdown(refreshInterval);
    }
    setIsAutoRefresh(!isAutoRefresh);
  };

  // Reset countdown on manual scan while auto-refresh is active
  const handleManualScan = () => {
    if (isAutoRefresh) {
      setCountdown(refreshInterval);
    }
    handleScan();
  };

  const formatStrike = (strike: number) => {
    return `$${strike.toLocaleString()}`;
  };

  const formatPrice = (price: number) => {
    return price.toFixed(4);
  };

  const formatSize = (size: number) => {
    return size.toLocaleString();
  };

  const formatIV = (iv: number) => {
    return `${(iv * 100).toFixed(1)}%`;
  };

  const formatEdge = (edge: number | null) => {
    if (edge === null) return "N/A";
    return `${edge >= 0 ? "+" : ""}${edge.toFixed(2)}%`;
  };

  const getConfidenceBadge = (confidence: "high" | "medium" | "low") => {
    const colors: Record<string, string> = {
      high: "bg-green-500/20 text-green-500",
      medium: "bg-yellow-500/20 text-yellow-500",
      low: "bg-red-500/20 text-red-500",
    };

    return (
      <span className={cn("px-2 py-0.5 rounded text-xs font-medium", colors[confidence])}>
        {confidence.toUpperCase()}
      </span>
    );
  };

  const opportunityCount = scanData?.results.filter(r => r.hasOpportunity).length || 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Sticky Header */}
      <div className="bg-card border-b sticky top-0 z-10">
        <div className="max-w-[1800px] mx-auto px-8 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-2xl font-bold">Smile Arbitrage Scanner</h1>
                <p className="text-sm text-muted-foreground">
                  Scan BTC markets for implied volatility arbitrage opportunities
                </p>
              </div>
            </div>
          </div>

          {/* Date Picker, Strike Range, and Scan Button */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">
                Settlement:</label>
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-[200px] justify-start text-left font-normal",
                      !selectedDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {selectedDate ? format(selectedDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => {
                      setSelectedDate(date);
                      setCalendarOpen(false);
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Strike Range Selector */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">
                Strike Range:
              </label>
              <div className="flex rounded-md overflow-hidden border">
                {STRIKE_RANGE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setStrikeRange(option.value)}
                    disabled={loading}
                    className={cn(
                      "px-3 py-1.5 text-sm font-medium transition-colors",
                      strikeRange === option.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-background hover:bg-muted",
                      loading && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <Button onClick={handleManualScan} disabled={loading || !selectedDate}>
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  Scan Markets
                </>
              )}
            </Button>

            {/* Auto-refresh controls */}
            <div className="flex items-center gap-2 ml-4 pl-4 border-l">
              {/* Interval selector */}
              <div className="flex rounded-md overflow-hidden border">
                {intervalOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      setRefreshInterval(option.value);
                      if (isAutoRefresh) {
                        setCountdown(option.value);
                      }
                    }}
                    disabled={isAutoRefresh}
                    className={cn(
                      "px-3 py-1.5 text-sm font-medium transition-colors",
                      refreshInterval === option.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-background hover:bg-muted",
                      isAutoRefresh && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {/* Toggle button */}
              <Button
                onClick={handleToggleAutoRefresh}
                variant={isAutoRefresh ? "destructive" : "secondary"}
                disabled={!selectedDate}
                className="min-w-[100px]"
              >
                {isAutoRefresh ? (
                  <>
                    <Pause className="w-4 h-4" />
                    Stop
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Auto
                  </>
                )}
              </Button>

              {/* Countdown display */}
              {isAutoRefresh && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="font-mono tabular-nums">
                    Next: {countdown}s
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1800px] mx-auto px-8 py-6">
        {/* Error Banner */}
        {error && (
          <div className="bg-destructive/10 border border-destructive rounded-lg p-4 mb-6 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-destructive" />
            <span className="text-destructive">{error}</span>
          </div>
        )}

        {/* Metadata Cards */}
        {scanData && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-card border rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-1">Markets Scanned</p>
              <p className="text-2xl font-bold">{scanData.marketCount}</p>
            </div>
            <div className="bg-card border rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-1">Opportunities Found</p>
              <p className={cn(
                "text-2xl font-bold",
                opportunityCount > 0 ? "text-green-500" : "text-muted-foreground"
              )}>
                {opportunityCount}
              </p>
              {opportunityCount > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Edge {">"}2%
                </p>
              )}
            </div>
            <div className="bg-card border rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-1">Strike Filter</p>
              <p className="text-lg font-mono">
                {scanData.strikeRange ? `±${scanData.strikeRange}%` : "All strikes"}
              </p>
              {scanData.strikeRange && (
                <p className="text-xs text-muted-foreground mt-1">
                  Near ATM only
                </p>
              )}
            </div>
            <div className="bg-card border rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-1">Last Scan</p>
              <p className="text-lg font-mono">
                {new Date(scanData.scannedAt).toLocaleString()}
              </p>
            </div>
          </div>
        )}

        {/* Results Table */}
        {!hasScanned ? (
          <div className="bg-card border rounded-lg p-12 text-center">
            <Search className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg text-muted-foreground">
              Select a date and click <strong>Scan Markets</strong> to begin
            </p>
          </div>
        ) : loading ? (
          <div className="bg-card border rounded-lg p-12 text-center">
            <RefreshCw className="w-12 h-12 text-muted-foreground mx-auto mb-4 animate-spin" />
            <p className="text-lg text-muted-foreground">Scanning markets...</p>
          </div>
        ) : scanData && scanData.results.length === 0 ? (
          <div className="bg-card border rounded-lg p-12 text-center">
            <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg text-muted-foreground">
              No markets found for {selectedDate ? format(selectedDate, "PPP") : "selected date"}
            </p>
          </div>
        ) : scanData && scanData.results.length > 0 ? (
          <div className="bg-card border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Strike</TableHead>
                    <TableHead className="text-right">YES (Poly)</TableHead>
                    <TableHead className="text-right">YES (Deribit)</TableHead>
                    <TableHead className="text-right">YES Edge</TableHead>
                    <TableHead className="text-right">NO (Poly)</TableHead>
                    <TableHead className="text-right">NO (Deribit)</TableHead>
                    <TableHead className="text-right">NO Edge</TableHead>
                    <TableHead className="text-right">IV</TableHead>
                    <TableHead className="text-center">Confidence</TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scanData.results.map((result) => {
                    const isOpportunity = result.hasOpportunity;
                    return (
                      <TableRow
                        key={result.marketId}
                        className={cn(
                          isOpportunity && "bg-green-50 dark:bg-green-950/30"
                        )}
                      >
                        <TableCell className="font-medium">
                          {formatStrike(result.strike)}
                        </TableCell>
                        {/* YES (Polymarket) */}
                        <TableCell className="text-right">
                          <div className="font-mono">
                            <div className="font-medium">
                              {formatPrice((result.yesBid + result.yesAsk) / 2)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              <span className="text-green-600">{formatPrice(result.yesBid)}</span>
                              {" / "}
                              <span className="text-red-600">{formatPrice(result.yesAsk)}</span>
                            </div>
                          </div>
                        </TableCell>
                        {/* YES (Deribit) */}
                        <TableCell className="text-right font-mono">
                          {formatPrice(result.theoreticalYes)}
                        </TableCell>
                        {/* YES Edge */}
                        <TableCell className={cn(
                          "text-right font-mono font-medium",
                          result.yesEdge === null && "text-muted-foreground",
                          result.yesEdge !== null && result.yesEdge > 2 && "text-green-600",
                          result.yesEdge !== null && result.yesEdge < -2 && "text-red-600"
                        )}>
                          {formatEdge(result.yesEdge)}
                        </TableCell>
                        {/* NO (Polymarket) */}
                        <TableCell className="text-right">
                          <div className="font-mono">
                            <div className="font-medium">
                              {formatPrice((result.noBid + result.noAsk) / 2)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              <span className="text-green-600">{formatPrice(result.noBid)}</span>
                              {" / "}
                              <span className="text-red-600">{formatPrice(result.noAsk)}</span>
                            </div>
                          </div>
                        </TableCell>
                        {/* NO (Deribit) */}
                        <TableCell className="text-right font-mono">
                          {formatPrice(result.theoreticalNo)}
                        </TableCell>
                        {/* NO Edge */}
                        <TableCell className={cn(
                          "text-right font-mono font-medium",
                          result.noEdge === null && "text-muted-foreground",
                          result.noEdge !== null && result.noEdge > 2 && "text-green-600",
                          result.noEdge !== null && result.noEdge < -2 && "text-red-600"
                        )}>
                          {formatEdge(result.noEdge)}
                        </TableCell>
                        {/* IV */}
                        <TableCell className="text-right font-mono">
                          {formatIV(result.interpolatedIV)}
                        </TableCell>
                        <TableCell className="text-center">
                          {getConfidenceBadge(result.confidence)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Link
                            href={`/market/${result.marketId}`}
                            className="text-primary hover:underline inline-flex items-center gap-1"
                          >
                            View
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
