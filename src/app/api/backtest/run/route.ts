/**
 * POST /api/backtest/run
 *
 * Run a backtest with the given configuration.
 */

import { NextResponse } from 'next/server';
import { runBacktest, type BacktestConfig } from '@/lib/backtest';
import { DEFAULT_CONFIG } from '@/lib/strategies/time-above-50/TimeAbove50Config';
import { saveBacktestRun } from '@/lib/persistence/BacktestRepository';

interface RunBacktestRequest {
  sessionIds: string[];
  strategySlug?: string;
  strategyParams?: Record<string, unknown>;
  initialCapital?: number;
  saveResult?: boolean;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RunBacktestRequest;

    // Validate required fields
    if (!body.sessionIds || body.sessionIds.length === 0) {
      return NextResponse.json(
        { error: 'sessionIds is required and must not be empty' },
        { status: 400 }
      );
    }

    // Build config
    const config: BacktestConfig = {
      sessionIds: body.sessionIds,
      strategySlug: body.strategySlug || 'time-above-50',
      strategyParams: { ...DEFAULT_CONFIG, ...(body.strategyParams || {}) },
      initialCapital: body.initialCapital || 1000,
    };

    // Run backtest
    const result = await runBacktest(config);

    // Optionally save to database
    if (body.saveResult !== false) {
      try {
        saveBacktestRun({
          id: result.runId,
          strategySlug: config.strategySlug,
          sessionIds: config.sessionIds,
          strategyParams: config.strategyParams,
          initialCapital: config.initialCapital,
          totalPnl: result.totalPnl,
          totalReturn: result.totalReturn,
          sharpeRatio: result.sharpeRatio,
          maxDrawdown: result.maxDrawdown,
          winRate: result.winRate,
          tradeCount: result.tradeCount,
          results: result,
        });
      } catch (saveError) {
        console.error('[API] Failed to save backtest run:', saveError);
        // Continue anyway, just don't save
      }
    }

    return NextResponse.json({
      success: true,
      result: {
        runId: result.runId,
        initialCapital: result.initialCapital,
        finalBalance: result.finalBalance,
        totalPnl: result.totalPnl,
        totalReturn: result.totalReturn,
        sharpeRatio: result.sharpeRatio,
        maxDrawdown: result.maxDrawdown,
        winRate: result.winRate,
        tradeCount: result.tradeCount,
        avgTradePnl: result.avgTradePnl,
        maxWin: result.maxWin,
        maxLoss: result.maxLoss,
        profitFactor: result.profitFactor,
        backtestDurationSeconds: result.backtestDurationSeconds,
        ticksProcessed: result.ticksProcessed,
        sessionBreakdown: result.sessionBreakdown,
        // Include trades and balance history for visualization
        trades: result.trades,
        balanceHistory: result.balanceHistory,
      },
    });
  } catch (error) {
    console.error('[API] Error running backtest:', error);
    return NextResponse.json(
      {
        error: 'Failed to run backtest',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
