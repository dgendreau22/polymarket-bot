/**
 * Strategies API Route
 *
 * GET /api/strategies - List all available strategies
 */

import { NextResponse } from 'next/server';
import { loadAllStrategies } from '@/lib/strategies';
import { getBotManager } from '@/lib/bots';
import { getStrategyTradeStats } from '@/lib/persistence';
import { error } from '@/lib/logger';

/**
 * GET /api/strategies
 * List all available strategies with stats
 */
export async function GET() {
  try {
    const strategies = loadAllStrategies();
    const botManager = getBotManager();

    // Enrich with stats
    const strategiesWithStats = strategies.map(strategy => {
      const bots = botManager.getBotsByStrategy(strategy.slug);
      const activeBots = bots.filter(b => b.state === 'running' || b.state === 'paused');
      const stats = getStrategyTradeStats(strategy.slug);

      return {
        ...strategy,
        stats: {
          totalBots: bots.length,
          activeBots: activeBots.length,
          totalTrades: stats.totalTrades,
          winRate: stats.winRate,
          totalPnl: stats.totalPnl,
        },
      };
    });

    return NextResponse.json({
      success: true,
      data: strategiesWithStats,
      count: strategiesWithStats.length,
    });
  } catch (err) {
    error('API', 'GET /api/strategies error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to fetch strategies',
      },
      { status: 500 }
    );
  }
}
