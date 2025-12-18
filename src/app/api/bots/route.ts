/**
 * Bot API Routes
 *
 * GET /api/bots - List all bots
 * POST /api/bots - Create a new bot
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBotManager } from '@/lib/bots';
import type { BotMode, BotState } from '@/lib/bots/types';

/**
 * GET /api/bots
 * List all bots with optional filters
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const state = searchParams.get('state') as BotState | null;
    const mode = searchParams.get('mode') as BotMode | null;
    const strategySlug = searchParams.get('strategy');

    const botManager = getBotManager();
    const bots = botManager.getAllBots({
      state: state || undefined,
      mode: mode || undefined,
      strategySlug: strategySlug || undefined,
    });

    return NextResponse.json({
      success: true,
      data: bots,
      count: bots.length,
    });
  } catch (error) {
    console.error('[API] GET /api/bots error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch bots',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/bots
 * Create a new bot
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.name || !body.strategySlug || !body.marketId || !body.mode) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: name, strategySlug, marketId, mode',
        },
        { status: 400 }
      );
    }

    // Validate mode
    if (!['live', 'dry_run'].includes(body.mode)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid mode. Must be "live" or "dry_run"',
        },
        { status: 400 }
      );
    }

    const botManager = getBotManager();
    const bot = botManager.createBot({
      name: body.name,
      strategySlug: body.strategySlug,
      marketId: body.marketId,
      marketName: body.marketName,
      assetId: body.assetId,
      mode: body.mode as BotMode,
      strategyConfig: body.strategyConfig,
    });

    return NextResponse.json({
      success: true,
      data: bot,
    });
  } catch (error) {
    console.error('[API] POST /api/bots error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create bot',
      },
      { status: 500 }
    );
  }
}
