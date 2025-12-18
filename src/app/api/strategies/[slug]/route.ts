/**
 * Single Strategy API Route
 *
 * GET /api/strategies/[slug] - Get strategy details with stats
 */

import { NextRequest, NextResponse } from 'next/server';
import { loadStrategy } from '@/lib/strategies';
import { getBotManager } from '@/lib/bots';
import { getStrategyTradeStats, getTrades, rowToTrade } from '@/lib/persistence';

interface RouteParams {
  params: Promise<{ slug: string }>;
}

/**
 * GET /api/strategies/[slug]
 * Get detailed strategy info with bots and trades
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const searchParams = request.nextUrl.searchParams;
    const tradesLimit = searchParams.get('tradesLimit')
      ? parseInt(searchParams.get('tradesLimit')!)
      : 50;

    const strategy = loadStrategy(slug);

    if (!strategy) {
      return NextResponse.json(
        {
          success: false,
          error: 'Strategy not found',
        },
        { status: 404 }
      );
    }

    const botManager = getBotManager();
    const allBots = botManager.getBotsByStrategy(slug);
    const activeBots = allBots.filter(b => b.state === 'running' || b.state === 'paused');
    const stoppedBots = allBots.filter(b => b.state === 'stopped');

    const stats = getStrategyTradeStats(slug);
    const tradeRows = getTrades({ strategySlug: slug, limit: tradesLimit });
    const trades = tradeRows.map(rowToTrade);

    return NextResponse.json({
      success: true,
      data: {
        strategy,
        stats: {
          ...stats,
          totalBots: allBots.length,
          activeBots: activeBots.length,
        },
        bots: {
          active: activeBots,
          stopped: stoppedBots.slice(0, 10), // Limit historical bots
        },
        trades,
      },
    });
  } catch (error) {
    console.error('[API] GET /api/strategies/[slug] error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch strategy',
      },
      { status: 500 }
    );
  }
}
