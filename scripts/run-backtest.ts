#!/usr/bin/env npx tsx
/**
 * Run Backtest Script
 *
 * Runs a backtest on specified sessions and saves the result.
 *
 * Usage:
 *   npx tsx scripts/run-backtest.ts --date 2026-01-18
 *   npx tsx scripts/run-backtest.ts --sessions <id1,id2,id3>
 */

import { runBacktest } from '../src/lib/backtest';
import { saveBacktestRun } from '../src/lib/persistence/BacktestRepository';
import { getSessionsForDate } from '../src/lib/validation/DryRunExtractor';
import { DEFAULT_CONFIG } from '../src/lib/strategies/time-above-50/TimeAbove50Config';

interface CliArgs {
  date?: string;
  sessions?: string[];
  initialCapital: number;
  help: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {
    initialCapital: 1000,
    help: false,
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--date' || arg === '-d') {
      args.date = process.argv[++i];
    } else if (arg === '--sessions' || arg === '-s') {
      args.sessions = process.argv[++i].split(',');
    } else if (arg === '--capital' || arg === '-c') {
      args.initialCapital = parseFloat(process.argv[++i]);
    }
  }

  return args;
}

function printUsage(): void {
  console.log(`
Run Backtest Script

USAGE:
  npx tsx scripts/run-backtest.ts [OPTIONS]

OPTIONS:
  -d, --date <YYYY-MM-DD>    Run backtest on all sessions for this date
  -s, --sessions <ids>       Comma-separated session IDs
  -c, --capital <amount>     Initial capital (default: 1000)
  -h, --help                 Show this help

EXAMPLES:
  # Run on all January 18th sessions
  npx tsx scripts/run-backtest.ts --date 2026-01-18

  # Run on specific sessions
  npx tsx scripts/run-backtest.ts --sessions abc123,def456,ghi789

  # With custom capital
  npx tsx scripts/run-backtest.ts --date 2026-01-18 --capital 5000
`);
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  // Get session IDs
  let sessionIds: string[] = [];

  if (args.sessions) {
    sessionIds = args.sessions;
  } else if (args.date) {
    console.log(`Finding sessions for ${args.date}...`);
    const sessions = getSessionsForDate(args.date);
    sessionIds = sessions.map(s => s.id);
    console.log(`Found ${sessionIds.length} sessions`);
  } else {
    console.error('Error: Must specify --date or --sessions');
    printUsage();
    process.exit(1);
  }

  if (sessionIds.length === 0) {
    console.error('Error: No sessions found');
    process.exit(1);
  }

  console.log(`\nRunning backtest on ${sessionIds.length} sessions...`);
  console.log(`Initial capital: $${args.initialCapital}`);
  console.log(`Strategy: time-above-50 (default config)`);
  console.log('');

  try {
    const startTime = Date.now();

    const result = await runBacktest({
      sessionIds,
      strategySlug: 'time-above-50',
      strategyParams: DEFAULT_CONFIG,
      initialCapital: args.initialCapital,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('='.repeat(60));
    console.log('BACKTEST RESULTS');
    console.log('='.repeat(60));
    console.log(`Run ID:           ${result.runId}`);
    console.log(`Duration:         ${duration}s`);
    console.log(`Ticks processed:  ${result.ticksProcessed}`);
    console.log('');
    console.log('--- PERFORMANCE ---');
    console.log(`Initial Capital:  $${result.initialCapital.toFixed(2)}`);
    console.log(`Final Balance:    $${result.finalBalance.toFixed(2)}`);
    console.log(`Total PnL:        $${result.totalPnl.toFixed(4)}`);
    console.log(`Total Return:     ${result.totalReturn.toFixed(2)}%`);
    console.log(`Sharpe Ratio:     ${result.sharpeRatio.toFixed(2)}`);
    console.log(`Max Drawdown:     ${result.maxDrawdown.toFixed(2)}%`);
    console.log(`Win Rate:         ${result.winRate.toFixed(1)}%`);
    console.log(`Trade Count:      ${result.tradeCount}`);
    console.log(`Avg Trade PnL:    $${result.avgTradePnl.toFixed(4)}`);
    console.log(`Max Win:          $${result.maxWin.toFixed(4)}`);
    console.log(`Max Loss:         $${result.maxLoss.toFixed(4)}`);
    console.log(`Profit Factor:    ${result.profitFactor.toFixed(2)}`);
    console.log('');

    // Session breakdown
    console.log('--- SESSION BREAKDOWN ---');
    for (const session of result.sessionBreakdown) {
      const pnlSign = session.pnl >= 0 ? '+' : '';
      console.log(`  ${session.marketName.substring(0, 45)}`);
      console.log(`    PnL: ${pnlSign}$${session.pnl.toFixed(4)} | Trades: ${session.tradeCount} | Win: ${session.winRate.toFixed(0)}%`);
    }

    // Save to database
    console.log('\nSaving to database...');
    try {
      saveBacktestRun({
        id: result.runId,
        strategySlug: 'time-above-50',
        sessionIds,
        strategyParams: DEFAULT_CONFIG,
        initialCapital: args.initialCapital,
        totalPnl: result.totalPnl,
        totalReturn: result.totalReturn,
        sharpeRatio: result.sharpeRatio,
        maxDrawdown: result.maxDrawdown,
        winRate: result.winRate,
        tradeCount: result.tradeCount,
        results: result,
      });
      console.log(`Saved! Run ID: ${result.runId}`);
    } catch (saveErr) {
      console.error('Failed to save:', saveErr);
    }

    console.log('\n' + '='.repeat(60));
    console.log(`Use this run ID for comparison:`);
    console.log(`  npm run compare-trades -- --date ${args.date || 'YYYY-MM-DD'} --backtest-id ${result.runId}`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('Error running backtest:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
