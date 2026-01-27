import { runBacktest } from '../src/lib/backtest';
import { DEFAULT_CONFIG } from '../src/lib/strategies/time-above-50/TimeAbove50Config';

const sessionId = '45d360d4-4c19-4e00-99c9-411d4684ffeb';

async function analyze() {
  const result = await runBacktest({
    sessionIds: [sessionId],
    strategySlug: 'time-above-50',
    strategyParams: DEFAULT_CONFIG,
    initialCapital: 1000,
  });

  // Group trades
  const yesBuys = result.trades.filter(t => t.side === 'BUY' && t.outcome === 'YES');
  const yesSells = result.trades.filter(t => t.side === 'SELL' && t.outcome === 'YES');
  const noBuys = result.trades.filter(t => t.side === 'BUY' && t.outcome === 'NO');
  const noSells = result.trades.filter(t => t.side === 'SELL' && t.outcome === 'NO');

  console.log('=== Session: 3:15PM-3:30PM ===');
  console.log('Total PnL:', result.totalPnl.toFixed(2));
  console.log('');
  console.log('Trade breakdown:');
  console.log('  YES buys:', yesBuys.length, '| YES sells:', yesSells.length);
  console.log('  NO buys:', noBuys.length, '| NO sells:', noSells.length);
  console.log('');

  // Find biggest losers
  const withPnl = result.trades.filter(t => t.pnl != null);
  const sorted = [...withPnl].sort((a, b) => (a.pnl || 0) - (b.pnl || 0));

  console.log('Biggest losing trades:');
  sorted.slice(0, 10).forEach(t => {
    const time = new Date(t.timestamp).toISOString().substr(11, 8);
    console.log(`  ${time} ${t.side.padEnd(4)} ${t.outcome} @ ${t.price.toFixed(3)} qty=${t.quantity.toFixed(1)} pnl=${t.pnl?.toFixed(2)}`);
  });

  console.log('');
  console.log('Trade timeline (first 20):');
  result.trades.slice(0, 20).forEach(t => {
    const time = new Date(t.timestamp).toISOString().substr(11, 8);
    const pnlStr = t.pnl != null ? `pnl=${t.pnl.toFixed(2)}` : '';
    console.log(`  ${time} ${t.side.padEnd(4)} ${t.outcome} @ ${t.price.toFixed(3)} qty=${t.quantity.toFixed(1)} ${pnlStr}`);
  });
}

analyze();
