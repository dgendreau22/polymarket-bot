/**
 * Strategy Metrics API Routes
 *
 * GET /api/bots/[id]/metrics - Get all strategy metrics for a bot
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMetricsByBotId, rowToMetric } from '@/lib/persistence/StrategyMetricsRepository';
import { error } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/bots/[id]/metrics
 * Get all strategy metrics for a bot (for TimeAbove50 parameter charting)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Fetch all metrics for this bot
    const metricRows = getMetricsByBotId(id);
    const metrics = metricRows.map(rowToMetric);

    return NextResponse.json({
      success: true,
      data: metrics,
    });
  } catch (err) {
    error('API', 'GET /api/bots/[id]/metrics error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to fetch metrics',
      },
      { status: 500 }
    );
  }
}
