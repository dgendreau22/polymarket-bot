/**
 * Individual Order API Route
 *
 * DELETE /api/bots/[id]/orders/[orderId] - Cancel a specific order
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBotManager } from '@/lib/bots';
import { cancelOrder, getLimitOrderById } from '@/lib/persistence/LimitOrderRepository';
import { error } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ id: string; orderId: string }>;
}

/**
 * DELETE /api/bots/[id]/orders/[orderId]
 * Cancel a specific order
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: botId, orderId } = await params;
    const botManager = getBotManager();

    const bot = botManager.getBot(botId);
    if (!bot) {
      return NextResponse.json(
        { success: false, error: 'Bot not found' },
        { status: 404 }
      );
    }

    // Verify the order exists and belongs to this bot
    const order = getLimitOrderById(orderId);
    if (!order) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    if (order.bot_id !== botId) {
      return NextResponse.json(
        { success: false, error: 'Order does not belong to this bot' },
        { status: 403 }
      );
    }

    if (order.status !== 'open' && order.status !== 'partially_filled') {
      return NextResponse.json(
        { success: false, error: `Cannot cancel order with status: ${order.status}` },
        { status: 400 }
      );
    }

    cancelOrder(orderId);

    return NextResponse.json({
      success: true,
      message: 'Order cancelled',
    });
  } catch (err) {
    error('API', 'DELETE /api/bots/[id]/orders/[orderId] error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to cancel order',
      },
      { status: 500 }
    );
  }
}
