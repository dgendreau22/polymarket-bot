/**
 * GET /api/backtest/runs/[runId]
 *
 * Get a specific backtest run result.
 */

import { NextResponse } from 'next/server';
import {
  getBacktestResultById,
  deleteBacktestRun,
} from '@/lib/persistence/BacktestRepository';

interface RouteParams {
  params: Promise<{
    runId: string;
  }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { runId } = await params;

    if (!runId) {
      return NextResponse.json({ error: 'runId is required' }, { status: 400 });
    }

    const result = getBacktestResultById(runId);

    if (!result) {
      return NextResponse.json(
        { error: 'Backtest run not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ result });
  } catch (error) {
    console.error('[API] Error fetching backtest run:', error);
    return NextResponse.json(
      { error: 'Failed to fetch backtest run' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { runId } = await params;

    if (!runId) {
      return NextResponse.json({ error: 'runId is required' }, { status: 400 });
    }

    const deleted = deleteBacktestRun(runId);

    if (!deleted) {
      return NextResponse.json(
        { error: 'Backtest run not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Error deleting backtest run:', error);
    return NextResponse.json(
      { error: 'Failed to delete backtest run' },
      { status: 500 }
    );
  }
}
