/**
 * GET /api/backtest/sessions
 *
 * List recording sessions available for backtesting.
 */

import { NextResponse } from 'next/server';
import {
  getAllRecordingSessions,
  calculateSessionStats,
} from '@/lib/persistence/DataRepository';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit')
      ? parseInt(searchParams.get('limit')!, 10)
      : undefined;

    const sessions = getAllRecordingSessions(limit);

    // Enrich with statistics
    const enrichedSessions = sessions.map((session) => {
      let stats = null;
      try {
        stats = calculateSessionStats(session.id);
      } catch {
        // Stats calculation failed, ignore
      }

      return {
        id: session.id,
        marketId: session.market_id,
        marketName: session.market_name,
        eventSlug: session.event_slug,
        yesAssetId: session.yes_asset_id,
        noAssetId: session.no_asset_id,
        startTime: session.start_time,
        endTime: session.end_time,
        tickCount: session.tick_count,
        snapshotCount: session.snapshot_count,
        createdAt: session.created_at,
        endedAt: session.ended_at,
        stats: stats
          ? {
              priceRange: stats.priceRange,
              avgVolume: stats.avgVolume,
              volatility: stats.volatility,
            }
          : null,
      };
    });

    return NextResponse.json({
      sessions: enrichedSessions,
      count: enrichedSessions.length,
    });
  } catch (error) {
    console.error('[API] Error fetching sessions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sessions' },
      { status: 500 }
    );
  }
}
