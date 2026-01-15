/**
 * SSE endpoint for real-time data recorder events
 *
 * Streams recorder events (state changes, ticks, snapshots, etc.)
 */

import { NextRequest } from 'next/server';
import { getDataRecorder } from '@/lib/data';
import type { RecorderEvent } from '@/lib/data';
import { error } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const recorder = getDataRecorder();

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Helper to send SSE message
      const send = (event: string, data: unknown) => {
        try {
          const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(message));
        } catch (err) {
          error('API', 'DataRecorder SSE Failed to send message:', err);
        }
      };

      // Send initial state
      send('status', recorder.getStatus());

      // Subscribe to recorder events
      const eventHandler = (event: RecorderEvent) => {
        send('event', event);

        // Send updated status on relevant state changes
        if (
          event.type === 'STATE_CHANGED' ||
          event.type === 'SESSION_STARTED' ||
          event.type === 'SESSION_ENDED' ||
          event.type === 'ERROR'
        ) {
          send('status', recorder.getStatus());
        }

        // Send tick events (throttled by recorder)
        if (event.type === 'TICK_RECORDED') {
          send('tick', {
            outcome: event.outcome,
            price: event.price,
            timestamp: event.timestamp,
          });
        }

        // Send snapshot events
        if (event.type === 'SNAPSHOT_SAVED') {
          send('snapshot', {
            combinedCost: event.combinedCost,
            timestamp: event.timestamp,
          });
        }
      };

      recorder.onEvent(eventHandler);

      // Send heartbeat every 30 seconds to keep connection alive
      const heartbeat = setInterval(() => {
        send('heartbeat', { timestamp: new Date().toISOString() });
      }, 30000);

      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        recorder.offEvent(eventHandler);
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
