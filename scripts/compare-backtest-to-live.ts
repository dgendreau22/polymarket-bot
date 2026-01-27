/**
 * Compare Backtest Results to Actual Live Bot PnL
 *
 * Runs backtests for sessions that have actual bot trading data and compares
 * the results to see which execution mode better matches live performance.
 */

import { BacktestEngine } from '../src/lib/backtest/BacktestEngine';
import { getAllRecordingSessions } from '../src/lib/persistence/DataRepository';
import { getDatabase } from '../src/lib/persistence/database';
import { DEFAULT_CONFIG } from '../src/lib/strategies/time-above-50/TimeAbove50Config';

interface SessionComparison {
  sessionId: string;
  marketId: string;
  timeSlot: string;
  // Actual bot results
  botPnl: number;
  botTrades: number;
  // Immediate mode backtest
  immPnl: number;
  immTrades: number;
  immError: number; // Difference from bot PnL
  immErrorPct: string;
  // Limit mode backtest
  limitPnl: number;
  limitTrades: number;
  limitError: number; // Difference from bot PnL
  limitErrorPct: string;
  // Which is closer?
  closerMode: 'immediate' | 'limit' | 'tie';
}

async function runComparison() {
  console.log('='.repeat(100));
  console.log('Backtest vs Live Bot PnL Comparison - January 19, 2026');
  console.log('='.repeat(100));
  console.log();

  const db = getDatabase();

  // Get sessions with actual bot trading data
  const sessionsWithBotData = db.prepare(`
    SELECT
      rs.id as session_id,
      rs.market_id,
      substr(rs.market_name, instr(rs.market_name, ', ') + 2) as time_slot,
      COUNT(t.id) as bot_trades,
      ROUND(SUM(CAST(t.pnl as REAL)), 2) as bot_pnl
    FROM recording_sessions rs
    JOIN bots b ON rs.market_id = b.market_id
    JOIN trades t ON t.bot_id = b.id AND t.status = 'filled' AND date(t.executed_at) = '2026-01-19'
    WHERE date(rs.start_time) = '2026-01-19'
    GROUP BY rs.id, b.market_id
    HAVING bot_trades > 0
    ORDER BY rs.start_time
  `).all() as Array<{
    session_id: string;
    market_id: string;
    time_slot: string;
    bot_trades: number;
    bot_pnl: number;
  }>;

  console.log(`Found ${sessionsWithBotData.length} sessions with actual bot trading data`);
  console.log();

  const results: SessionComparison[] = [];

  for (let i = 0; i < sessionsWithBotData.length; i++) {
    const session = sessionsWithBotData[i];
    const timeSlot = session.time_slot.replace(' ET', '');

    process.stdout.write(`[${i + 1}/${sessionsWithBotData.length}] ${timeSlot}... `);

    try {
      // Run with immediate mode
      const immediateEngine = new BacktestEngine({
        sessionIds: [session.session_id],
        strategySlug: 'time-above-50',
        strategyParams: DEFAULT_CONFIG,
        initialCapital: 1000,
        executionMode: 'immediate',
      });
      const immediateResult = await immediateEngine.run();

      // Run with limit mode
      const limitEngine = new BacktestEngine({
        sessionIds: [session.session_id],
        strategySlug: 'time-above-50',
        strategyParams: DEFAULT_CONFIG,
        initialCapital: 1000,
        executionMode: 'limit',
      });
      const limitResult = await limitEngine.run();

      const immError = immediateResult.totalPnl - session.bot_pnl;
      const limitError = limitResult.totalPnl - session.bot_pnl;

      const immErrorPct = session.bot_pnl !== 0
        ? ((immError / Math.abs(session.bot_pnl)) * 100).toFixed(0) + '%'
        : immError === 0 ? '0%' : 'N/A';
      const limitErrorPct = session.bot_pnl !== 0
        ? ((limitError / Math.abs(session.bot_pnl)) * 100).toFixed(0) + '%'
        : limitError === 0 ? '0%' : 'N/A';

      const closerMode = Math.abs(immError) < Math.abs(limitError)
        ? 'immediate'
        : Math.abs(limitError) < Math.abs(immError)
          ? 'limit'
          : 'tie';

      results.push({
        sessionId: session.session_id.slice(0, 8),
        marketId: session.market_id,
        timeSlot,
        botPnl: session.bot_pnl,
        botTrades: session.bot_trades,
        immPnl: immediateResult.totalPnl,
        immTrades: immediateResult.tradeCount,
        immError,
        immErrorPct,
        limitPnl: limitResult.totalPnl,
        limitTrades: limitResult.tradeCount,
        limitError,
        limitErrorPct,
        closerMode,
      });

      const winner = closerMode === 'limit' ? '← LIMIT' : closerMode === 'immediate' ? 'IMM →' : 'TIE';
      console.log(`Bot: $${session.bot_pnl.toFixed(2)} | Imm: $${immediateResult.totalPnl.toFixed(2)} | Limit: $${limitResult.totalPnl.toFixed(2)} ${winner}`);
    } catch (error) {
      console.log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Print results table
  console.log();
  console.log('='.repeat(140));
  console.log('COMPARISON TABLE: Backtest vs Actual Bot PnL');
  console.log('='.repeat(140));
  console.log();

  // Header
  console.log(
    'Time Slot'.padEnd(18) +
    '| Bot PnL'.padStart(10) +
    '| Bot Tr'.padStart(8) +
    '| Imm PnL'.padStart(10) +
    '| Imm Err'.padStart(10) +
    '| Limit PnL'.padStart(11) +
    '| Limit Err'.padStart(11) +
    '| Closer'.padStart(10)
  );
  console.log('-'.repeat(140));

  // Data rows
  for (const r of results) {
    const closerIcon = r.closerMode === 'limit' ? '✓ LIMIT' : r.closerMode === 'immediate' ? '✓ IMM' : '= TIE';
    console.log(
      r.timeSlot.padEnd(18) +
      `| $${r.botPnl.toFixed(2)}`.padStart(10) +
      `| ${r.botTrades}`.padStart(8) +
      `| $${r.immPnl.toFixed(2)}`.padStart(10) +
      `| $${r.immError.toFixed(2)}`.padStart(10) +
      `| $${r.limitPnl.toFixed(2)}`.padStart(11) +
      `| $${r.limitError.toFixed(2)}`.padStart(11) +
      `| ${closerIcon}`.padStart(10)
    );
  }

  // Summary statistics
  console.log('-'.repeat(140));

  const totalBotPnl = results.reduce((sum, r) => sum + r.botPnl, 0);
  const totalBotTrades = results.reduce((sum, r) => sum + r.botTrades, 0);
  const totalImmPnl = results.reduce((sum, r) => sum + r.immPnl, 0);
  const totalLimitPnl = results.reduce((sum, r) => sum + r.limitPnl, 0);
  const totalImmError = totalImmPnl - totalBotPnl;
  const totalLimitError = totalLimitPnl - totalBotPnl;

  console.log(
    'TOTALS'.padEnd(18) +
    `| $${totalBotPnl.toFixed(2)}`.padStart(10) +
    `| ${totalBotTrades}`.padStart(8) +
    `| $${totalImmPnl.toFixed(2)}`.padStart(10) +
    `| $${totalImmError.toFixed(2)}`.padStart(10) +
    `| $${totalLimitPnl.toFixed(2)}`.padStart(11) +
    `| $${totalLimitError.toFixed(2)}`.padStart(11) +
    `| ${Math.abs(totalLimitError) < Math.abs(totalImmError) ? '✓ LIMIT' : '✓ IMM'}`.padStart(10)
  );

  // Count wins
  const limitWins = results.filter(r => r.closerMode === 'limit').length;
  const immWins = results.filter(r => r.closerMode === 'immediate').length;
  const ties = results.filter(r => r.closerMode === 'tie').length;

  // Calculate mean absolute error
  const immMAE = results.reduce((sum, r) => sum + Math.abs(r.immError), 0) / results.length;
  const limitMAE = results.reduce((sum, r) => sum + Math.abs(r.limitError), 0) / results.length;

  console.log();
  console.log('='.repeat(140));
  console.log('ACCURACY SUMMARY');
  console.log('='.repeat(140));
  console.log();
  console.log(`Sessions analyzed: ${results.length}`);
  console.log();
  console.log('Which mode is closer to actual bot PnL?');
  console.log(`  Limit mode wins:     ${limitWins} sessions (${(limitWins/results.length*100).toFixed(0)}%)`);
  console.log(`  Immediate mode wins: ${immWins} sessions (${(immWins/results.length*100).toFixed(0)}%)`);
  console.log(`  Ties:                ${ties} sessions`);
  console.log();
  console.log('Total PnL Comparison:');
  console.log(`  Actual Bot:      $${totalBotPnl.toFixed(2)}`);
  console.log(`  Immediate Mode:  $${totalImmPnl.toFixed(2)} (error: $${totalImmError.toFixed(2)})`);
  console.log(`  Limit Mode:      $${totalLimitPnl.toFixed(2)} (error: $${totalLimitError.toFixed(2)})`);
  console.log();
  console.log('Mean Absolute Error (MAE) per session:');
  console.log(`  Immediate mode: $${immMAE.toFixed(2)}`);
  console.log(`  Limit mode:     $${limitMAE.toFixed(2)}`);
  console.log(`  ${limitMAE < immMAE ? '→ Limit mode is MORE accurate' : '→ Immediate mode is MORE accurate'}`);
  console.log();

  // Direction accuracy (did backtest predict profit/loss correctly?)
  const immDirectionCorrect = results.filter(r =>
    (r.botPnl > 0 && r.immPnl > 0) || (r.botPnl < 0 && r.immPnl < 0) || (r.botPnl === 0 && r.immPnl === 0)
  ).length;
  const limitDirectionCorrect = results.filter(r =>
    (r.botPnl > 0 && r.limitPnl > 0) || (r.botPnl < 0 && r.limitPnl < 0) || (r.botPnl === 0 && r.limitPnl === 0)
  ).length;

  console.log('Direction Accuracy (did backtest predict profit vs loss correctly?):');
  console.log(`  Immediate mode: ${immDirectionCorrect}/${results.length} (${(immDirectionCorrect/results.length*100).toFixed(0)}%)`);
  console.log(`  Limit mode:     ${limitDirectionCorrect}/${results.length} (${(limitDirectionCorrect/results.length*100).toFixed(0)}%)`);
}

// Run the comparison
runComparison().catch(console.error);
