/**
 * Trades API Route
 *
 * GET /api/trades - List all trades with filters
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTrades, rowToTrade } from '@/lib/persistence';
import type { BotMode, TradeStatus } from '@/lib/bots/types';

/**
 * GET /api/trades
 * List all trades with optional filters
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const filters = {
      botId: searchParams.get('botId') || undefined,
      strategySlug: searchParams.get('strategy') || undefined,
      marketId: searchParams.get('marketId') || undefined,
      mode: (searchParams.get('mode') as BotMode) || undefined,
      side: (searchParams.get('side') as 'BUY' | 'SELL') || undefined,
      outcome: (searchParams.get('outcome') as 'YES' | 'NO') || undefined,
      status: (searchParams.get('status') as TradeStatus) || undefined,
      startDate: searchParams.get('startDate')
        ? new Date(searchParams.get('startDate')!)
        : undefined,
      endDate: searchParams.get('endDate')
        ? new Date(searchParams.get('endDate')!)
        : undefined,
      limit: searchParams.get('limit')
        ? parseInt(searchParams.get('limit')!)
        : 100,
      offset: searchParams.get('offset')
        ? parseInt(searchParams.get('offset')!)
        : 0,
    };

    const tradeRows = getTrades(filters);
    const trades = tradeRows.map(rowToTrade);

    return NextResponse.json({
      success: true,
      data: trades,
      count: trades.length,
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        hasMore: trades.length === filters.limit,
      },
    });
  } catch (error) {
    console.error('[API] GET /api/trades error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch trades',
      },
      { status: 500 }
    );
  }
}
