/**
 * Orchestrator API Routes
 *
 * GET /api/orchestrator - Get orchestrator status
 * POST /api/orchestrator - Start orchestrator with config
 * DELETE /api/orchestrator - Stop orchestrator
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOrchestrator } from '@/lib/bots/Orchestrator';

export async function GET() {
  const orchestrator = getOrchestrator();

  return NextResponse.json({
    success: true,
    data: orchestrator.getStatus(),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const orchestrator = getOrchestrator();

    // Validate strategy
    const validStrategies = ['arbitrage', 'market-maker', 'test-oscillator'];
    if (body.strategy && !validStrategies.includes(body.strategy)) {
      return NextResponse.json(
        { success: false, error: `Invalid strategy. Valid options: ${validStrategies.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate mode
    if (body.mode && !['live', 'dry_run'].includes(body.mode)) {
      return NextResponse.json(
        { success: false, error: 'Invalid mode. Valid options: live, dry_run' },
        { status: 400 }
      );
    }

    // Validate lead time
    const leadTime = body.leadTimeMinutes || 5;
    if (leadTime < 1 || leadTime > 15) {
      return NextResponse.json(
        { success: false, error: 'Lead time must be between 1 and 15 minutes' },
        { status: 400 }
      );
    }

    await orchestrator.start({
      strategy: body.strategy || 'arbitrage',
      mode: body.mode || 'dry_run',
      leadTimeMinutes: leadTime,
      strategyConfig: body.strategyConfig,
    });

    return NextResponse.json({
      success: true,
      data: orchestrator.getStatus(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start orchestrator';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const orchestrator = getOrchestrator();
    await orchestrator.stop();

    return NextResponse.json({
      success: true,
      data: orchestrator.getStatus(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to stop orchestrator';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
