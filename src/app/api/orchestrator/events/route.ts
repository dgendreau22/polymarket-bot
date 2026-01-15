/**
 * SSE endpoint for real-time orchestrator events
 *
 * Streams orchestrator events (state changes, market found, bot created, etc.)
 */

import { NextRequest } from 'next/server';
import { getOrchestrator } from '@/lib/bots/Orchestrator';
import type { OrchestratorEvent } from '@/lib/bots/Orchestrator';
import { error } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const orchestrator = getOrchestrator();

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Helper to send SSE message
      const send = (event: string, data: unknown) => {
        try {
          const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(message));
        } catch (err) {
          error('API', 'Orchestrator SSE Failed to send message:', err);
        }
      };

      // Send initial state
      send('status', orchestrator.getStatus());
      send('bots', orchestrator.getBotHistory());

      // Subscribe to orchestrator events
      const eventHandler = (event: OrchestratorEvent) => {
        send('event', event);

        // Send updated status on relevant state changes
        if (
          event.type === 'STATE_CHANGED' ||
          event.type === 'MARKET_FOUND' ||
          event.type === 'BOT_SCHEDULED' ||
          event.type === 'BOT_CREATED' ||
          event.type === 'CYCLE_COMPLETE' ||
          event.type === 'ERROR'
        ) {
          send('status', orchestrator.getStatus());
        }

        // Send updated bot history when bot is created or cycle completes
        if (event.type === 'BOT_CREATED' || event.type === 'CYCLE_COMPLETE') {
          send('bots', orchestrator.getBotHistory());
        }
      };

      orchestrator.onEvent(eventHandler);

      // Send heartbeat every 30 seconds to keep connection alive
      const heartbeat = setInterval(() => {
        send('heartbeat', { timestamp: new Date().toISOString() });
      }, 30000);

      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        orchestrator.offEvent(eventHandler);
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
      'X-Accel-Buffering': 'no',
    },
  });
}
