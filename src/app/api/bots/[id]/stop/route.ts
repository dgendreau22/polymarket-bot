/**
 * Stop Bot API Route
 *
 * POST /api/bots/[id]/stop - Stop a bot
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBotManager } from '@/lib/bots';
import { error } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/bots/[id]/stop
 * Stop a running or paused bot
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const botManager = getBotManager();

    const bot = botManager.getBot(id);
    if (!bot) {
      return NextResponse.json(
        {
          success: false,
          error: 'Bot not found',
        },
        { status: 404 }
      );
    }

    if (bot.state === 'stopped') {
      return NextResponse.json(
        {
          success: false,
          error: 'Bot is already stopped',
        },
        { status: 400 }
      );
    }

    await botManager.stopBot(id);

    // Get updated bot state
    const updatedBot = botManager.getBot(id);

    return NextResponse.json({
      success: true,
      data: updatedBot,
      message: 'Bot stopped successfully',
    });
  } catch (err) {
    error('API', 'POST /api/bots/[id]/stop error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to stop bot',
      },
      { status: 500 }
    );
  }
}
