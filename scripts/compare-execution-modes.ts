/**
 * Compare Backtest Execution Modes
 *
 * Runs backtests for all January 19th sessions with both 'immediate' and 'limit'
 * execution modes to compare PnL and trade counts.
 */

import { BacktestEngine } from '../src/lib/backtest/BacktestEngine';
import { getAllRecordingSessions } from '../src/lib/persistence/DataRepository';
import { DEFAULT_CONFIG } from '../src/lib/strategies/time-above-50/TimeAbove50Config';

interface SessionResult {
  sessionId: string;
  marketName: string;
  timeSlot: string;
  // Immediate mode results
  immediatePnl: number;
  immediateTrades: number;
  // Limit mode results
  limitPnl: number;
  limitTrades: number;
  limitFillRate: number;
  limitOrdersCreated: number;
  limitOrdersFilled: number;
  limitOrdersExpired: number;
  // Comparison
  pnlDiff: number;
  tradeDiff: number;
  tradeReduction: string;
}

async function runComparison() {
  console.log('='.repeat(80));
  console.log('Backtest Execution Mode Comparison - January 19, 2026');
  console.log('='.repeat(80));
  console.log();

  // Get all sessions
  const allSessions = getAllRecordingSessions();

  // Filter for January 19th sessions
  const jan19Sessions = allSessions.filter(s => {
    const startDate = new Date(s.start_time);
    return startDate.getUTCFullYear() === 2026 &&
           startDate.getUTCMonth() === 0 && // January
           startDate.getUTCDate() === 19;
  });

  console.log(`Found ${jan19Sessions.length} sessions for January 19, 2026`);
  console.log();

  const results: SessionResult[] = [];

  for (let i = 0; i < jan19Sessions.length; i++) {
    const session = jan19Sessions[i];
    const timeSlot = extractTimeSlot(session.market_name);

    process.stdout.write(`[${i + 1}/${jan19Sessions.length}] ${timeSlot}... `);

    try {
      // Run with immediate mode
      const immediateEngine = new BacktestEngine({
        sessionIds: [session.id],
        strategySlug: 'time-above-50',
        strategyParams: DEFAULT_CONFIG,
        initialCapital: 1000,
        executionMode: 'immediate',
      });
      const immediateResult = await immediateEngine.run();

      // Run with limit mode
      const limitEngine = new BacktestEngine({
        sessionIds: [session.id],
        strategySlug: 'time-above-50',
        strategyParams: DEFAULT_CONFIG,
        initialCapital: 1000,
        executionMode: 'limit',
      });
      const limitResult = await limitEngine.run();

      const pnlDiff = limitResult.totalPnl - immediateResult.totalPnl;
      const tradeDiff = immediateResult.tradeCount - limitResult.tradeCount;
      const tradeReduction = immediateResult.tradeCount > 0
        ? ((tradeDiff / immediateResult.tradeCount) * 100).toFixed(1) + '%'
        : 'N/A';

      results.push({
        sessionId: session.id.slice(0, 8),
        marketName: session.market_name,
        timeSlot,
        immediatePnl: immediateResult.totalPnl,
        immediateTrades: immediateResult.tradeCount,
        limitPnl: limitResult.totalPnl,
        limitTrades: limitResult.tradeCount,
        limitFillRate: limitResult.fillRate ?? 0,
        limitOrdersCreated: limitResult.totalOrdersCreated ?? 0,
        limitOrdersFilled: limitResult.filledOrderCount ?? 0,
        limitOrdersExpired: limitResult.expiredOrderCount ?? 0,
        pnlDiff,
        tradeDiff,
        tradeReduction,
      });

      console.log(`Done (Imm: $${immediateResult.totalPnl.toFixed(2)}, Limit: $${limitResult.totalPnl.toFixed(2)})`);
    } catch (error) {
      console.log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Print results table
  console.log();
  console.log('='.repeat(120));
  console.log('RESULTS COMPARISON TABLE');
  console.log('='.repeat(120));
  console.log();

  // Header
  console.log(
    'Time Slot'.padEnd(22) +
    '| Imm PnL'.padStart(10) +
    '| Imm Trades'.padStart(12) +
    '| Limit PnL'.padStart(11) +
    '| Limit Trades'.padStart(14) +
    '| Fill Rate'.padStart(11) +
    '| PnL Diff'.padStart(10) +
    '| Trade Diff'.padStart(12)
  );
  console.log('-'.repeat(120));

  // Data rows
  for (const r of results) {
    console.log(
      r.timeSlot.padEnd(22) +
      `| $${r.immediatePnl.toFixed(2)}`.padStart(10) +
      `| ${r.immediateTrades}`.padStart(12) +
      `| $${r.limitPnl.toFixed(2)}`.padStart(11) +
      `| ${r.limitTrades}`.padStart(14) +
      `| ${(r.limitFillRate * 100).toFixed(1)}%`.padStart(11) +
      `| $${r.pnlDiff.toFixed(2)}`.padStart(10) +
      `| -${r.tradeDiff} (${r.tradeReduction})`.padStart(12)
    );
  }

  // Summary
  console.log('-'.repeat(120));

  const totalImmediatePnl = results.reduce((sum, r) => sum + r.immediatePnl, 0);
  const totalLimitPnl = results.reduce((sum, r) => sum + r.limitPnl, 0);
  const totalImmediateTrades = results.reduce((sum, r) => sum + r.immediateTrades, 0);
  const totalLimitTrades = results.reduce((sum, r) => sum + r.limitTrades, 0);
  const avgFillRate = results.reduce((sum, r) => sum + r.limitFillRate, 0) / results.length;

  console.log(
    'TOTALS'.padEnd(22) +
    `| $${totalImmediatePnl.toFixed(2)}`.padStart(10) +
    `| ${totalImmediateTrades}`.padStart(12) +
    `| $${totalLimitPnl.toFixed(2)}`.padStart(11) +
    `| ${totalLimitTrades}`.padStart(14) +
    `| ${(avgFillRate * 100).toFixed(1)}%`.padStart(11) +
    `| $${(totalLimitPnl - totalImmediatePnl).toFixed(2)}`.padStart(10) +
    `| -${totalImmediateTrades - totalLimitTrades} (${((1 - totalLimitTrades/totalImmediateTrades) * 100).toFixed(1)}%)`.padStart(12)
  );

  console.log();
  console.log('='.repeat(120));
  console.log('SUMMARY');
  console.log('='.repeat(120));
  console.log(`Sessions analyzed: ${results.length}`);
  console.log(`Immediate mode - Total PnL: $${totalImmediatePnl.toFixed(2)}, Total Trades: ${totalImmediateTrades}`);
  console.log(`Limit mode     - Total PnL: $${totalLimitPnl.toFixed(2)}, Total Trades: ${totalLimitTrades}`);
  console.log(`PnL improvement: $${(totalLimitPnl - totalImmediatePnl).toFixed(2)}`);
  console.log(`Trade reduction: ${totalImmediateTrades - totalLimitTrades} trades (${((1 - totalLimitTrades/totalImmediateTrades) * 100).toFixed(1)}% fewer)`);
  console.log(`Average fill rate: ${(avgFillRate * 100).toFixed(1)}%`);
}

function extractTimeSlot(marketName: string): string {
  // Extract time slot from market name like "Bitcoin Up or Down - January 19, 11:15AM-11:30AM ET"
  const match = marketName.match(/(\d{1,2}:\d{2}[AP]M-\d{1,2}:\d{2}[AP]M)/);
  return match ? match[1] : marketName.slice(0, 20);
}

// Run the comparison
runComparison().catch(console.error);
