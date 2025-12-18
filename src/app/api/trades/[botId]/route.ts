/**
 * Bot Trades API Route
 *
 * GET /api/trades/[botId] - Get trades for a specific bot
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTradesByBotId, getBotTradeStats, rowToTrade } from '@/lib/persistence';
import { getBotManager } from '@/lib/bots';

interface RouteParams {
  params: Promise<{ botId: string }>;
}

/**
 * GET /api/trades/[botId]
 * Get all trades for a specific bot
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { botId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get('limit')
      ? parseInt(searchParams.get('limit')!)
      : undefined;

    // Verify bot exists
    const botManager = getBotManager();
    const bot = botManager.getBot(botId);

    if (!bot) {
      return NextResponse.json(
        {
          success: false,
          error: 'Bot not found',
        },
        { status: 404 }
      );
    }

    const tradeRows = getTradesByBotId(botId, limit);
    const trades = tradeRows.map(rowToTrade);
    const stats = getBotTradeStats(botId);

    return NextResponse.json({
      success: true,
      data: {
        trades,
        stats,
        bot: {
          id: bot.config.id,
          name: bot.config.name,
          strategySlug: bot.config.strategySlug,
        },
      },
      count: trades.length,
    });
  } catch (error) {
    console.error('[API] GET /api/trades/[botId] error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch trades',
      },
      { status: 500 }
    );
  }
}
