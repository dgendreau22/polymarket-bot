/**
 * Single Bot API Routes
 *
 * GET /api/bots/[id] - Get bot details
 * DELETE /api/bots/[id] - Delete a bot
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBotManager } from '@/lib/bots';
import { getPosition, rowToPosition } from '@/lib/persistence/BotRepository';
import { log, error } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/bots/[id]
 * Get a single bot by ID
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
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

    // Fetch position from database to ensure we have the latest
    const dbPosition = getPosition(id);
    log('API', `GET /bots/${id} dbPosition:`, dbPosition);
    if (dbPosition) {
      const position = rowToPosition(dbPosition);
      log('API', `GET /bots/${id} Converted position:`, position);
      bot.position = position;
    }
    log('API', `GET /bots/${id} Final bot.position:`, bot.position);

    return NextResponse.json({
      success: true,
      data: bot,
    });
  } catch (err) {
    error('API', 'GET /api/bots/[id] error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to fetch bot',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/bots/[id]
 * Delete a bot (must be stopped)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const botManager = getBotManager();

    // Directly call deleteBot which checks the database
    // Don't rely on in-memory check as singleton may be reset in dev mode
    const deleted = botManager.deleteBot(id);

    if (!deleted) {
      return NextResponse.json(
        {
          success: false,
          error: 'Bot not found or failed to delete',
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Bot deleted successfully',
    });
  } catch (err) {
    error('API', 'DELETE /api/bots/[id] error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to delete bot',
      },
      { status: 500 }
    );
  }
}
