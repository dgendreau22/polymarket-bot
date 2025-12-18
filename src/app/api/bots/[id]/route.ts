/**
 * Single Bot API Routes
 *
 * GET /api/bots/[id] - Get bot details
 * DELETE /api/bots/[id] - Delete a bot
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBotManager } from '@/lib/bots';

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

    return NextResponse.json({
      success: true,
      data: bot,
    });
  } catch (error) {
    console.error('[API] GET /api/bots/[id] error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch bot',
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
  } catch (error) {
    console.error('[API] DELETE /api/bots/[id] error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete bot',
      },
      { status: 500 }
    );
  }
}
