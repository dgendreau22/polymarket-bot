/**
 * GET /api/backtest/runs
 *
 * List all backtest runs (summaries).
 */

import { NextResponse } from 'next/server';
import {
  getAllBacktestRuns,
  getBacktestRunsByStrategy,
  getTopBacktestRuns,
} from '@/lib/persistence/BacktestRepository';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const strategy = searchParams.get('strategy');
    const limit = searchParams.get('limit')
      ? parseInt(searchParams.get('limit')!, 10)
      : undefined;
    const sortBy = searchParams.get('sortBy') as
      | 'total_pnl'
      | 'total_return'
      | 'sharpe_ratio'
      | 'win_rate'
      | null;

    let runs;

    if (sortBy) {
      runs = getTopBacktestRuns(sortBy, limit || 100, false);
    } else if (strategy) {
      runs = getBacktestRunsByStrategy(strategy, limit);
    } else {
      runs = getAllBacktestRuns(limit);
    }

    return NextResponse.json({
      runs,
      count: runs.length,
    });
  } catch (error) {
    console.error('[API] Error fetching backtest runs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch backtest runs' },
      { status: 500 }
    );
  }
}
