#!/usr/bin/env npx tsx
/**
 * Compare Sessions Script
 *
 * Runs individual backtests for each session and compares with dry-run results.
 */

import { runBacktest } from '../src/lib/backtest';
import { getSessionsForDate, extractDryRunDataForDate } from '../src/lib/validation';
import { DEFAULT_CONFIG } from '../src/lib/strategies/time-above-50/TimeAbove50Config';

interface SessionResult {
  sessionId: string;
  marketName: string;
  startTime: string;
  // Dry-run metrics
  dryRunTrades: number;
  dryRunPnl: number;
  dryRunBuys: number;
  dryRunSells: number;
  // Backtest metrics
  backtestTrades: number;
  backtestPnl: number;
  backtestBuys: number;
  backtestSells: number;
  backtestWinRate: number;
  // Deltas
  tradeCountDelta: number;
  pnlDelta: number;
  directionMatch: boolean; // Both profitable or both losing
}

function pad(str: string, len: number, align: 'left' | 'right' = 'left'): string {
  if (align === 'right') {
    return str.padStart(len);
  }
  return str.padEnd(len);
}

function formatPnl(pnl: number): string {
  const sign = pnl >= 0 ? '+' : '';
  return `${sign}$${pnl.toFixed(2)}`;
}

async function main(): Promise<void> {
  const date = process.argv[2] || '2026-01-18';

  console.log(`\nComparing dry-run vs backtest for ${date}...\n`);

  // Get sessions and dry-run data
  const sessions = getSessionsForDate(date);
  const dryRunData = extractDryRunDataForDate(date);

  if (sessions.length === 0) {
    console.error('No sessions found for date');
    process.exit(1);
  }

  console.log(`Found ${sessions.length} sessions\n`);
  console.log('Running individual backtests...\n');

  const results: SessionResult[] = [];

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const dryRun = dryRunData.find(d => d.session.id === session.id);

    // Extract time from market name (e.g., "2:45PM-3:00PM")
    const timeMatch = session.market_name.match(/(\d+:\d+[AP]M-\d+:\d+[AP]M)/);
    const timeSlot = timeMatch ? timeMatch[1] : session.start_time.substring(11, 16);

    process.stdout.write(`  [${i + 1}/${sessions.length}] ${timeSlot}... `);

    // Run backtest for this single session
    const backtestResult = await runBacktest({
      sessionIds: [session.id],
      strategySlug: 'time-above-50',
      strategyParams: DEFAULT_CONFIG,
      initialCapital: 1000,
    });

    // Calculate dry-run metrics
    const dryRunTrades = dryRun?.trades || [];
    const dryRunBuys = dryRunTrades.filter(t => t.side === 'BUY').length;
    const dryRunSells = dryRunTrades.filter(t => t.side === 'SELL').length;
    const dryRunPnl = dryRunTrades.reduce((sum, t) => sum + parseFloat(t.pnl), 0);

    // Calculate backtest metrics
    const backtestBuys = backtestResult.trades.filter(t => t.side === 'BUY').length;
    const backtestSells = backtestResult.trades.filter(t => t.side === 'SELL').length;

    const result: SessionResult = {
      sessionId: session.id,
      marketName: session.market_name,
      startTime: timeSlot,
      dryRunTrades: dryRunTrades.length,
      dryRunPnl,
      dryRunBuys,
      dryRunSells,
      backtestTrades: backtestResult.tradeCount,
      backtestPnl: backtestResult.totalPnl,
      backtestBuys,
      backtestSells,
      backtestWinRate: backtestResult.winRate,
      tradeCountDelta: backtestResult.tradeCount - dryRunTrades.length,
      pnlDelta: backtestResult.totalPnl - dryRunPnl,
      directionMatch: (dryRunPnl >= 0) === (backtestResult.totalPnl >= 0),
    };

    results.push(result);
    console.log(`Done (BT: ${backtestResult.tradeCount} trades, ${formatPnl(backtestResult.totalPnl)})`);
  }

  // Print results table
  console.log('\n' + '='.repeat(120));
  console.log('SESSION COMPARISON: DRY-RUN vs BACKTEST');
  console.log('='.repeat(120));

  // Header
  console.log(
    pad('Time Slot', 18) +
    pad('DryRun', 10) +
    pad('Backtest', 10) +
    pad('Δ Trades', 10) +
    pad('DR PnL', 12) +
    pad('BT PnL', 12) +
    pad('Δ PnL', 12) +
    pad('BT Win%', 10) +
    pad('Match', 8)
  );
  console.log('-'.repeat(120));

  let totalDryRunTrades = 0;
  let totalBacktestTrades = 0;
  let totalDryRunPnl = 0;
  let totalBacktestPnl = 0;
  let directionMatches = 0;

  for (const r of results) {
    const match = r.directionMatch ? '✓' : '✗';
    const deltaTrades = r.tradeCountDelta >= 0 ? `+${r.tradeCountDelta}` : `${r.tradeCountDelta}`;
    const deltaPnl = r.pnlDelta >= 0 ? `+$${r.pnlDelta.toFixed(2)}` : `$${r.pnlDelta.toFixed(2)}`;

    console.log(
      pad(r.startTime, 18) +
      pad(r.dryRunTrades.toString(), 10) +
      pad(r.backtestTrades.toString(), 10) +
      pad(deltaTrades, 10) +
      pad(formatPnl(r.dryRunPnl), 12) +
      pad(formatPnl(r.backtestPnl), 12) +
      pad(deltaPnl, 12) +
      pad(`${r.backtestWinRate.toFixed(0)}%`, 10) +
      pad(match, 8)
    );

    totalDryRunTrades += r.dryRunTrades;
    totalBacktestTrades += r.backtestTrades;
    totalDryRunPnl += r.dryRunPnl;
    totalBacktestPnl += r.backtestPnl;
    if (r.directionMatch) directionMatches++;
  }

  // Totals
  console.log('-'.repeat(120));
  const totalDeltaTrades = totalBacktestTrades - totalDryRunTrades;
  const totalDeltaPnl = totalBacktestPnl - totalDryRunPnl;
  console.log(
    pad('TOTAL', 18) +
    pad(totalDryRunTrades.toString(), 10) +
    pad(totalBacktestTrades.toString(), 10) +
    pad(totalDeltaTrades >= 0 ? `+${totalDeltaTrades}` : `${totalDeltaTrades}`, 10) +
    pad(formatPnl(totalDryRunPnl), 12) +
    pad(formatPnl(totalBacktestPnl), 12) +
    pad(totalDeltaPnl >= 0 ? `+$${totalDeltaPnl.toFixed(2)}` : `$${totalDeltaPnl.toFixed(2)}`, 12) +
    pad('-', 10) +
    pad(`${directionMatches}/${results.length}`, 8)
  );

  // Summary
  console.log('\n' + '='.repeat(120));
  console.log('SUMMARY');
  console.log('='.repeat(120));
  console.log(`Sessions compared:        ${results.length}`);
  console.log(`Direction matches:        ${directionMatches}/${results.length} (${((directionMatches/results.length)*100).toFixed(0)}%)`);
  console.log(`Trade count ratio:        ${(totalBacktestTrades/totalDryRunTrades).toFixed(2)}x (backtest executes more)`);
  console.log(`PnL ratio:                ${(totalBacktestPnl/totalDryRunPnl).toFixed(2)}x`);
  console.log('');
  console.log('Dry-Run Total:');
  console.log(`  Trades: ${totalDryRunTrades}  |  PnL: ${formatPnl(totalDryRunPnl)}`);
  console.log('');
  console.log('Backtest Total:');
  console.log(`  Trades: ${totalBacktestTrades}  |  PnL: ${formatPnl(totalBacktestPnl)}`);

  // Trade breakdown
  console.log('\n' + '='.repeat(120));
  console.log('TRADE BREAKDOWN BY SESSION');
  console.log('='.repeat(120));
  console.log(
    pad('Time Slot', 18) +
    pad('DR Buys', 10) +
    pad('DR Sells', 10) +
    pad('BT Buys', 10) +
    pad('BT Sells', 10) +
    pad('Buy Ratio', 12) +
    pad('Sell Ratio', 12)
  );
  console.log('-'.repeat(120));

  for (const r of results) {
    const buyRatio = r.dryRunBuys > 0 ? (r.backtestBuys / r.dryRunBuys).toFixed(2) : '-';
    const sellRatio = r.dryRunSells > 0 ? (r.backtestSells / r.dryRunSells).toFixed(2) : '-';

    console.log(
      pad(r.startTime, 18) +
      pad(r.dryRunBuys.toString(), 10) +
      pad(r.dryRunSells.toString(), 10) +
      pad(r.backtestBuys.toString(), 10) +
      pad(r.backtestSells.toString(), 10) +
      pad(`${buyRatio}x`, 12) +
      pad(`${sellRatio}x`, 12)
    );
  }

  console.log('\n');
}

main().catch(console.error);
