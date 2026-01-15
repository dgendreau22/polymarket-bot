/**
 * Manual Order API Route
 *
 * POST /api/bots/[id]/manual-order - Create a manual order for testing dry-run execution
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBotManager } from '@/lib/bots';
import { executeDryRunTrade } from '@/lib/bots/DryRunExecutor';
import { getPosition } from '@/lib/persistence/BotRepository';
import type { StrategySignal } from '@/lib/bots/types';
import { error } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface CreateOrderRequest {
  action: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO';
  orderType: 'market' | 'limit';
  price?: string;
  quantity: string;
}

/**
 * POST /api/bots/[id]/manual-order
 * Create a manual order for testing dry-run execution
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: botId } = await params;
    const body: CreateOrderRequest = await request.json();
    const { action, outcome, orderType, price, quantity } = body;

    // 1. Get bot from manager
    const botManager = getBotManager();
    const bot = botManager.getBot(botId);
    const botRaw = botManager.getBotRaw(botId);

    if (!bot) {
      return NextResponse.json(
        { success: false, error: 'Bot not found' },
        { status: 404 }
      );
    }

    if (!botRaw) {
      return NextResponse.json(
        { success: false, error: 'Bot instance not available' },
        { status: 500 }
      );
    }

    // 2. Only support dry-run mode
    if (bot.config.mode !== 'dry_run') {
      return NextResponse.json(
        { success: false, error: 'Only dry-run mode is supported for manual orders' },
        { status: 501 }
      );
    }

    // 3. Validate bot state - allow running and paused (for manual testing), reject stopped
    if (bot.state === 'stopped') {
      return NextResponse.json(
        { success: false, error: 'Cannot place orders on a stopped bot - start or resume the bot first' },
        { status: 400 }
      );
    }

    // 4. Validate action
    if (!['BUY', 'SELL'].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'Action must be BUY or SELL' },
        { status: 400 }
      );
    }

    // 5. Validate outcome
    if (!['YES', 'NO'].includes(outcome)) {
      return NextResponse.json(
        { success: false, error: 'Outcome must be YES or NO' },
        { status: 400 }
      );
    }

    // 6. Determine asset ID based on outcome
    const assetId = outcome === 'YES' ? bot.config.assetId : bot.config.noAssetId;
    if (!assetId) {
      return NextResponse.json(
        { success: false, error: `No ${outcome} asset ID configured for this bot` },
        { status: 400 }
      );
    }

    // 7. Validate quantity
    if (!quantity || parseFloat(quantity) <= 0) {
      return NextResponse.json(
        { success: false, error: 'Quantity must be greater than 0' },
        { status: 400 }
      );
    }

    // 8. For SELL orders, validate position
    if (action === 'SELL') {
      const position = getPosition(botId, assetId);
      const posSize = position ? parseFloat(position.size) : 0;
      if (parseFloat(quantity) > posSize) {
        return NextResponse.json(
          { success: false, error: `Cannot sell ${quantity} - only ${posSize.toFixed(2)} owned` },
          { status: 400 }
        );
      }
    }

    // 9. Fetch order book once - used for both price determination and marketability check
    const CLOB_HOST = process.env.POLYMARKET_CLOB_HOST || 'https://clob.polymarket.com';
    const orderBookResponse = await fetch(`${CLOB_HOST}/book?token_id=${encodeURIComponent(assetId)}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    const orderBook = await orderBookResponse.json();
    const bids = orderBook.bids || [];
    const asks = orderBook.asks || [];

    // 10. Determine final price
    let finalPrice = price;

    if (orderType === 'market' || !price) {
      if (action === 'BUY') {
        if (asks.length === 0) {
          return NextResponse.json(
            { success: false, error: 'No asks available for market order' },
            { status: 400 }
          );
        }
        const sortedAsks = [...asks].sort(
          (a: { price: string }, b: { price: string }) => parseFloat(a.price) - parseFloat(b.price)
        );
        finalPrice = sortedAsks[0].price;
      } else {
        if (bids.length === 0) {
          return NextResponse.json(
            { success: false, error: 'No bids available for market order' },
            { status: 400 }
          );
        }
        const sortedBids = [...bids].sort(
          (a: { price: string }, b: { price: string }) => parseFloat(b.price) - parseFloat(a.price)
        );
        finalPrice = sortedBids[0].price;
      }
    }

    // 11. Validate price
    if (!finalPrice) {
      return NextResponse.json(
        { success: false, error: 'Price is required for limit orders' },
        { status: 400 }
      );
    }

    const priceNum = parseFloat(finalPrice);
    if (isNaN(priceNum) || priceNum <= 0 || priceNum >= 1) {
      return NextResponse.json(
        { success: false, error: 'Price must be between 0 and 1' },
        { status: 400 }
      );
    }

    // 12. Construct signal and execute (reusing the same orderBook for marketability check)
    const signal: StrategySignal = {
      action,
      side: outcome,
      price: finalPrice,
      quantity,
      reason: 'Manual order',
      confidence: 1.0,
    };

    // Pass bot's emitEvent as callback to route events to SSE subscribers
    const result = await executeDryRunTrade(
      botRaw,
      signal,
      orderBook,
      (event) => botRaw.emitEvent(event)
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || 'Failed to create order' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        orderId: result.orderId,
        trade: result.trade,
        filled: result.trade?.status === 'filled',
        price: finalPrice,
        quantity,
      },
    });
  } catch (err) {
    error('API', 'POST /api/bots/[id]/manual-order error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to create order',
      },
      { status: 500 }
    );
  }
}
