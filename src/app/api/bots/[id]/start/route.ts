/**
 * Start Bot API Route
 *
 * POST /api/bots/[id]/start - Start a bot
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBotManager } from '@/lib/bots';
import { error } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/bots/[id]/start
 * Start a stopped or paused bot
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

    if (bot.state === 'running') {
      return NextResponse.json(
        {
          success: false,
          error: 'Bot is already running',
        },
        { status: 400 }
      );
    }

    await botManager.startBot(id);

    // Get updated bot state
    const updatedBot = botManager.getBot(id);

    return NextResponse.json({
      success: true,
      data: updatedBot,
      message: 'Bot started successfully',
    });
  } catch (err) {
    error('API', 'POST /api/bots/[id]/start error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to start bot',
      },
      { status: 500 }
    );
  }
}
