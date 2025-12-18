/**
 * Pause Bot API Route
 *
 * POST /api/bots/[id]/pause - Pause a running bot
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBotManager } from '@/lib/bots';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/bots/[id]/pause
 * Pause a running bot
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

    if (bot.state !== 'running') {
      return NextResponse.json(
        {
          success: false,
          error: 'Can only pause a running bot',
        },
        { status: 400 }
      );
    }

    await botManager.pauseBot(id);

    // Get updated bot state
    const updatedBot = botManager.getBot(id);

    return NextResponse.json({
      success: true,
      data: updatedBot,
      message: 'Bot paused successfully',
    });
  } catch (error) {
    console.error('[API] POST /api/bots/[id]/pause error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to pause bot',
      },
      { status: 500 }
    );
  }
}
