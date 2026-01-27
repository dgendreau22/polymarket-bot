#!/usr/bin/env npx tsx
/**
 * Trade Comparison CLI Script
 *
 * Compares dry-run trades with backtest results to validate strategy consistency.
 *
 * Usage:
 *   npx tsx scripts/compare-trades.ts --date 2026-01-18 --backtest-id <id>
 *   npx tsx scripts/compare-trades.ts --session <session-id> --backtest-id <id>
 *   npx tsx scripts/compare-trades.ts --summary --date 2026-01-18
 */

import {
  compareAllSessionsForDate,
  compareSingleSession,
  getDryRunSummaryForDate,
  getSessionsForDate,
  extractDryRunDataForDate,
  DEFAULT_COMPARISON_CONFIG,
  type SessionComparisonReport,
  type AggregateComparisonReport,
  type AlignedTradePair,
  type DiscrepancySummary,
} from '../src/lib/validation';
import { getAllBacktestRuns } from '../src/lib/persistence/BacktestRepository';

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CliArgs {
  date?: string;
  sessionId?: string;
  backtestId?: string;
  summary: boolean;
  verbose: boolean;
  help: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {
    summary: false,
    verbose: false,
    help: false,
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--summary' || arg === '-s') {
      args.summary = true;
    } else if (arg === '--verbose' || arg === '-v') {
      args.verbose = true;
    } else if (arg === '--date' || arg === '-d') {
      args.date = process.argv[++i];
    } else if (arg === '--session') {
      args.sessionId = process.argv[++i];
    } else if (arg === '--backtest-id' || arg === '-b') {
      args.backtestId = process.argv[++i];
    }
  }

  return args;
}

function printUsage(): void {
  console.log(`
Trade Comparison CLI - Validates dry-run vs backtest consistency

USAGE:
  npx tsx scripts/compare-trades.ts [OPTIONS]

OPTIONS:
  -d, --date <YYYY-MM-DD>    Date to compare (default: today)
  --session <id>             Compare a specific session only
  -b, --backtest-id <id>     Backtest run ID to compare against
  -s, --summary              Show summary of available data only
  -v, --verbose              Show detailed trade-by-trade comparison
  -h, --help                 Show this help message

EXAMPLES:
  # Show available data for January 18th
  npx tsx scripts/compare-trades.ts --summary --date 2026-01-18

  # Compare all sessions on a date with a backtest
  npx tsx scripts/compare-trades.ts --date 2026-01-18 --backtest-id abc123

  # Compare a specific session
  npx tsx scripts/compare-trades.ts --session xyz789 --backtest-id abc123

  # Verbose output with trade details
  npx tsx scripts/compare-trades.ts --date 2026-01-18 -b abc123 --verbose
`);
}

// ============================================================================
// Formatting Helpers
// ============================================================================

function formatPnl(pnl: number): string {
  const sign = pnl >= 0 ? '+' : '';
  return `${sign}$${pnl.toFixed(4)}`;
}

function formatPercent(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function pad(str: string, len: number): string {
  return str.padEnd(len);
}

// ============================================================================
// Report Printing
// ============================================================================

function printSummary(date: string): void {
  console.log('\n' + '='.repeat(70));
  console.log(`DRY-RUN DATA SUMMARY FOR ${date}`);
  console.log('='.repeat(70));

  const summary = getDryRunSummaryForDate(date);

  console.log(`\nRecording Sessions: ${summary.sessionCount}`);
  console.log(`Sessions with Matching Bots: ${summary.sessionsWithBots}`);
  console.log(`Total Dry-Run Trades: ${summary.totalTrades}`);
  console.log(`Unique Markets: ${summary.marketIds.length}`);

  if (summary.sessionCount > 0) {
    console.log('\nSessions:');
    const sessions = getSessionsForDate(date);
    for (const session of sessions) {
      console.log(`  - ${session.market_name}`);
      console.log(`    ID: ${session.id}`);
      console.log(`    Time: ${session.start_time} to ${session.end_time}`);
    }
  }

  // List available backtest runs
  console.log('\nAvailable Backtest Runs:');
  const backtestRuns = getAllBacktestRuns(10);
  if (backtestRuns.length === 0) {
    console.log('  No backtest runs found');
  } else {
    for (const run of backtestRuns) {
      console.log(`  - ${run.id}`);
      console.log(`    Strategy: ${run.strategySlug}`);
      console.log(`    Sessions: ${run.sessionIds.length}`);
      console.log(`    PnL: ${formatPnl(run.totalPnl)} | Trades: ${run.tradeCount}`);
      console.log(`    Created: ${run.createdAt}`);
    }
  }
}

function printTradePair(pair: AlignedTradePair, index: number): void {
  const dryTrade = pair.dryRunTrade;
  const btTrade = pair.backtestTrade;

  const typeTag = pair.matchType === 'EXACT' ? 'EXACT' :
                  pair.matchType === 'CLOSE' ? 'CLOSE' :
                  pair.matchType === 'UNMATCHED_DRY' ? 'DRY_ONLY' : 'BT_ONLY';

  let line = `  #${(index + 1).toString().padStart(2)} ${pad(typeTag, 10)}`;

  if (dryTrade) {
    const time = new Date(dryTrade.executedAt).toISOString().substring(11, 19);
    line += ` | DRY: ${dryTrade.side} ${dryTrade.outcome} @${parseFloat(dryTrade.price).toFixed(4)} (${time})`;
  } else {
    line += ` | DRY: -`;
  }

  if (btTrade) {
    const time = btTrade.timestamp.substring(11, 19);
    line += ` | BT: ${btTrade.side} ${btTrade.outcome} @${btTrade.price.toFixed(4)} (${time})`;
  } else {
    line += ` | BT: -`;
  }

  if (pair.timeDeltaMs !== null) {
    line += ` | Δt: ${formatMs(pair.timeDeltaMs)}`;
  }
  if (pair.priceDeltaPercent !== null) {
    line += ` | Δp: ${pair.priceDeltaPercent.toFixed(2)}%`;
  }

  console.log(line);
}

function printDiscrepancies(discrepancies: DiscrepancySummary[]): void {
  if (discrepancies.length === 0) {
    console.log('  None');
    return;
  }

  for (const d of discrepancies) {
    console.log(`  - ${d.source}: ${d.count} occurrences (avg magnitude: ${d.avgMagnitude.toFixed(2)})`);
    console.log(`    ${d.description}`);
  }
}

function printSessionReport(report: SessionComparisonReport, verbose: boolean): void {
  console.log('\n' + '-'.repeat(70));
  console.log(`SESSION: ${report.marketName}`);
  console.log('-'.repeat(70));
  console.log(`ID: ${report.sessionId}`);
  console.log(`Time: ${report.startTime} to ${report.endTime}`);
  if (report.botId) {
    console.log(`Bot: ${report.botName || report.botId}`);
  }

  console.log('\nTrade Counts:');
  console.log(`  Dry-Run:   ${report.dryRunTradeCount}`);
  console.log(`  Backtest:  ${report.backtestTradeCount}`);
  console.log(`  Matched:   ${report.matchedTradeCount} (${formatPercent(report.matchRate)})`);

  console.log('\nPnL:');
  console.log(`  Dry-Run:   ${formatPnl(report.dryRunPnl)}`);
  console.log(`  Backtest:  ${formatPnl(report.backtestPnl)}`);
  console.log(`  Delta:     ${formatPercent(report.pnlDeltaPercent)}`);

  console.log('\nTiming/Price:');
  console.log(`  Avg Time Delta:  ${formatMs(report.avgTimeDeltaMs)}`);
  console.log(`  Max Time Delta:  ${formatMs(report.maxTimeDeltaMs)}`);
  console.log(`  Avg Price Delta: ${formatPercent(report.avgPriceDeltaPercent)}`);
  console.log(`  Max Price Delta: ${formatPercent(report.maxPriceDeltaPercent)}`);

  console.log('\nDiscrepancies:');
  printDiscrepancies(report.discrepancies);

  if (verbose && report.tradePairs.length > 0) {
    console.log('\nTrade-by-Trade:');
    for (let i = 0; i < report.tradePairs.length; i++) {
      printTradePair(report.tradePairs[i], i);
    }
  }
}

function printAggregateReport(report: AggregateComparisonReport, verbose: boolean): void {
  console.log('\n' + '='.repeat(70));
  console.log(`AGGREGATE COMPARISON REPORT - ${report.comparisonDate}`);
  console.log('='.repeat(70));

  console.log(`\nSessions Compared: ${report.sessionCount}`);
  console.log(`Sessions with Bots: ${report.sessionsWithBots}`);

  console.log('\n--- OVERALL METRICS ---');
  console.log(`\nTrade Counts:`);
  console.log(`  Total Dry-Run:    ${report.totalDryRunTrades}`);
  console.log(`  Total Backtest:   ${report.totalBacktestTrades}`);
  console.log(`  Total Matched:    ${report.totalMatchedTrades}`);
  console.log(`  Match Rate:       ${formatPercent(report.overallMatchRate)}`);

  console.log(`\nPnL:`);
  console.log(`  Total Dry-Run:    ${formatPnl(report.totalDryRunPnl)}`);
  console.log(`  Total Backtest:   ${formatPnl(report.totalBacktestPnl)}`);
  console.log(`  Overall Delta:    ${formatPercent(report.overallPnlDeltaPercent)}`);

  console.log(`\nTiming/Price (averaged):`);
  console.log(`  Avg Time Delta:   ${formatMs(report.overallAvgTimeDeltaMs)}`);
  console.log(`  Avg Price Delta:  ${formatPercent(report.overallAvgPriceDeltaPercent)}`);

  console.log('\n--- VALIDATION STATUS ---');
  if (report.passed) {
    console.log('✓ PASSED - All thresholds met');
  } else {
    console.log('✗ FAILED');
    for (const reason of report.failureReasons) {
      console.log(`  - ${reason}`);
    }
  }

  console.log('\n--- AGGREGATED DISCREPANCIES ---');
  printDiscrepancies(report.aggregatedDiscrepancies);

  // Print per-session reports
  for (const sessionReport of report.sessionReports) {
    printSessionReport(sessionReport, verbose);
  }

  // Summary table
  console.log('\n' + '='.repeat(70));
  console.log('SESSION SUMMARY TABLE');
  console.log('='.repeat(70));
  console.log(pad('Market', 40) + pad('DryRun', 8) + pad('BT', 8) + pad('Match%', 8) + pad('PnL Δ', 10));
  console.log('-'.repeat(70));
  for (const r of report.sessionReports) {
    const name = r.marketName.length > 38 ? r.marketName.substring(0, 35) + '...' : r.marketName;
    console.log(
      pad(name, 40) +
      pad(r.dryRunTradeCount.toString(), 8) +
      pad(r.backtestTradeCount.toString(), 8) +
      pad(formatPercent(r.matchRate), 8) +
      formatPercent(r.pnlDeltaPercent)
    );
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  // Default date to today
  const date = args.date || new Date().toISOString().split('T')[0];

  // Summary mode - just show what data is available
  if (args.summary) {
    printSummary(date);
    process.exit(0);
  }

  // Require backtest ID for comparison
  if (!args.backtestId) {
    console.error('Error: --backtest-id is required for comparison');
    console.error('Use --summary to see available backtest runs');
    process.exit(1);
  }

  try {
    if (args.sessionId) {
      // Compare single session
      console.log(`Comparing session ${args.sessionId} with backtest ${args.backtestId}...`);
      const report = compareSingleSession(args.sessionId, args.backtestId, DEFAULT_COMPARISON_CONFIG);

      if (!report) {
        console.error(`Session ${args.sessionId} not found`);
        process.exit(1);
      }

      printSessionReport(report, args.verbose);
    } else {
      // Compare all sessions for date
      console.log(`Comparing all sessions for ${date} with backtest ${args.backtestId}...`);
      const report = compareAllSessionsForDate(date, args.backtestId, DEFAULT_COMPARISON_CONFIG);
      printAggregateReport(report, args.verbose);

      // Exit with error code if validation failed
      if (!report.passed) {
        process.exit(1);
      }
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
