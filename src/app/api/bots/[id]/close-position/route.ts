/**
 * Close Position API Route
 *
 * POST /api/bots/[id]/close-position - Close the bot's position with a market order
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBotManager } from '@/lib/bots';
import { getPosition, updatePosition } from '@/lib/persistence/BotRepository';
import { createLimitOrder, updateOrderFill } from '@/lib/persistence/LimitOrderRepository';
import { createTrade } from '@/lib/persistence/TradeRepository';
import { v4 as uuidv4 } from 'uuid';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/bots/[id]/close-position
 * Close the bot's current position with a market order
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: botId } = await params;
    const botManager = getBotManager();
    const bot = botManager.getBot(botId);

    if (!bot) {
      return NextResponse.json(
        { success: false, error: 'Bot not found' },
        { status: 404 }
      );
    }

    // Get position from database (use assetId for multi-position bots)
    const position = getPosition(botId, bot.config.assetId);
    if (!position) {
      return NextResponse.json(
        { success: false, error: 'No position found' },
        { status: 400 }
      );
    }

    const positionSize = parseFloat(position.size);
    if (positionSize <= 0) {
      return NextResponse.json(
        { success: false, error: 'No position to close' },
        { status: 400 }
      );
    }

    // For dry-run mode, simulate a market order by placing a limit order at the best bid
    // In live mode, this would be an actual market order
    if (bot.config.mode === 'dry_run') {
      if (!bot.config.assetId) {
        return NextResponse.json(
          { success: false, error: 'No asset ID configured for this bot' },
          { status: 400 }
        );
      }

      // Fetch current order book to get best bid
      const CLOB_HOST = process.env.POLYMARKET_CLOB_HOST || 'https://clob.polymarket.com';
      const response = await fetch(`${CLOB_HOST}/book?token_id=${encodeURIComponent(bot.config.assetId)}`);
      const orderBook = await response.json();

      const bids = orderBook.bids || [];
      if (bids.length === 0) {
        return NextResponse.json(
          { success: false, error: 'No bids available to fill market order' },
          { status: 400 }
        );
      }

      // Sort bids by price descending to get best bid
      const sortedBids = [...bids].sort(
        (a: { price: string }, b: { price: string }) =>
          parseFloat(b.price) - parseFloat(a.price)
      );
      const bestBid = sortedBids[0].price;

      const orderId = uuidv4();
      const now = new Date();

      // Create a limit order at the best bid (simulates market sell)
      createLimitOrder({
        id: orderId,
        botId,
        assetId: bot.config.assetId,
        side: 'SELL',
        outcome: position.outcome as 'YES' | 'NO',
        price: bestBid,
        quantity: positionSize.toFixed(6),
        createdAt: now,
      });

      // Mark the order as filled immediately (market order)
      updateOrderFill(orderId, positionSize.toFixed(6), 'filled');

      // Calculate PnL
      const avgEntry = parseFloat(position.avg_entry_price);
      const sellPrice = parseFloat(bestBid);
      const pnl = (sellPrice - avgEntry) * positionSize;
      const totalValue = sellPrice * positionSize;

      // Create the trade record (marked as filled immediately for market order)
      const trade = createTrade({
        id: uuidv4(),
        botId,
        strategySlug: bot.config.strategySlug,
        marketId: bot.config.marketId,
        assetId: bot.config.assetId,
        mode: bot.config.mode,
        side: 'SELL',
        outcome: position.outcome as 'YES' | 'NO',
        price: bestBid,
        quantity: positionSize.toFixed(6),
        totalValue: totalValue.toFixed(6),
        fee: '0',
        status: 'filled',
        pnl: pnl.toFixed(6),
        orderId,
        executedAt: now,
        createdAt: now,
      });

      // Update database position to zero
      const currentRealizedPnl = parseFloat(position.realized_pnl);
      const newRealizedPnl = (currentRealizedPnl + pnl).toFixed(6);
      updatePosition(botId, bot.config.assetId, {
        size: '0',
        avgEntryPrice: '0',
        realizedPnl: newRealizedPnl,
      });

      // Also update the in-memory bot position so it stays in sync
      botManager.updateBotPosition(botId, {
        size: '0',
        avgEntryPrice: '0',
        realizedPnl: newRealizedPnl,
      });

      console.log(`[ClosePosition] Bot ${botId} closed position: SELL ${positionSize} @ ${bestBid}, PnL: ${pnl.toFixed(4)}`);

      return NextResponse.json({
        success: true,
        data: {
          trade,
          sellPrice: bestBid,
          quantity: positionSize,
          pnl,
        },
      });
    } else {
      // Live mode - would need actual market order implementation
      return NextResponse.json(
        { success: false, error: 'Live market orders not yet implemented' },
        { status: 501 }
      );
    }
  } catch (error) {
    console.error('[API] POST /api/bots/[id]/close-position error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to close position',
      },
      { status: 500 }
    );
  }
}
