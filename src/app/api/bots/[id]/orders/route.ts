/**
 * Bot Orders API Route
 *
 * GET /api/bots/[id]/orders - Get active orders for a bot
 * DELETE /api/bots/[id]/orders - Cancel all orders for a bot
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBotManager } from '@/lib/bots';
import { error } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/bots/[id]/orders
 * Get active (open/partially filled) orders for a bot
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

    const orders = botManager.getActiveOrders(id);

    return NextResponse.json({
      success: true,
      data: orders,
      count: orders.length,
    });
  } catch (err) {
    error('API', 'GET /api/bots/[id]/orders error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to get orders',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/bots/[id]/orders
 * Cancel all active orders for a bot
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
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

    const cancelledCount = botManager.cancelBotOrders(id);

    return NextResponse.json({
      success: true,
      data: { cancelledCount },
      message: `Cancelled ${cancelledCount} orders`,
    });
  } catch (err) {
    error('API', 'DELETE /api/bots/[id]/orders error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to cancel orders',
      },
      { status: 500 }
    );
  }
}
