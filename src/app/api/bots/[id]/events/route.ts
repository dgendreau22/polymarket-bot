/**
 * SSE endpoint for real-time bot events
 *
 * Streams bot events (trades, fills, state changes) to the client
 * Eliminates the need for polling
 */

import { NextRequest } from 'next/server';
import { getBotManager } from '@/lib/bots/BotManager';
import { getTrades, rowToTrade } from '@/lib/persistence/TradeRepository';
import { getOpenOrdersByBotId, rowToLimitOrder } from '@/lib/persistence/LimitOrderRepository';
import { getPositionsByBotId, rowToPosition } from '@/lib/persistence/BotRepository';
import type { BotEvent } from '@/lib/bots/types';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const manager = getBotManager();

  // Get the raw Bot instance for event subscription
  const bot = manager.getBotRaw(id);
  if (!bot) {
    return new Response('Bot not found', { status: 404 });
  }

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Helper to send SSE message
      const send = (event: string, data: unknown) => {
        try {
          const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(message));
        } catch (err) {
          console.error('[SSE] Failed to send message:', err);
        }
      };

      // Send initial state
      const sendInitialState = () => {
        // Send current bot state
        const botInstance = manager.getBot(id);
        if (botInstance) {
          send('bot', botInstance);
        }

        // Send current positions (for arbitrage bots, returns YES and NO positions)
        const positionRows = getPositionsByBotId(id);
        const positions = positionRows.map(rowToPosition);
        send('positions', positions);

        // Send current trades (convert from DB rows to Trade objects)
        const tradeRows = getTrades({ botId: id, status: 'filled' });
        const trades = tradeRows.map(rowToTrade);
        send('trades', trades);

        // Send current orders
        const orderRows = getOpenOrdersByBotId(id);
        const orders = orderRows.map(rowToLimitOrder);
        send('orders', orders);
      };

      // Send initial state immediately
      sendInitialState();

      // Subscribe to bot events
      const eventHandler = (event: BotEvent) => {
        send('event', event);

        // For trade/fill events, also send updated data
        if (event.type === 'TRADE_EXECUTED' || event.type === 'ORDER_FILLED') {
          // Use setImmediate to ensure position updates complete before we fetch and send data
          setImmediate(() => {
            // Send updated bot instance (for metrics)
            const botInstance = manager.getBot(id);
            if (botInstance) {
              send('bot', botInstance);
            }

            // Send updated positions (for arbitrage bots, returns YES and NO positions)
            const positionRows = getPositionsByBotId(id);
            const positions = positionRows.map(rowToPosition);
            send('positions', positions);

            // Send updated trades (convert from DB rows to Trade objects)
            const tradeRows = getTrades({ botId: id, status: 'filled' });
            const trades = tradeRows.map(rowToTrade);
            send('trades', trades);

            // Send updated orders
            const orderRows = getOpenOrdersByBotId(id);
            const orders = orderRows.map(rowToLimitOrder);
            send('orders', orders);
          });
        }
      };

      bot.onEvent(eventHandler);

      // Send heartbeat every 30 seconds to keep connection alive
      const heartbeat = setInterval(() => {
        send('heartbeat', { timestamp: new Date().toISOString() });
      }, 30000);

      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        bot.offEvent(eventHandler);
        clearInterval(heartbeat);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}
