/**
 * POST /api/backtest/optimize
 *
 * Run grid search optimization with SSE progress streaming.
 */

import { NextResponse } from 'next/server';
import {
  runOptimization,
  countCombinations,
  validateRanges,
  MAX_COMBINATIONS_DEFAULT,
  type OptimizationConfig,
  type ParameterRange,
  type OptimizationMetric,
} from '@/lib/backtest';
import { DEFAULT_CONFIG } from '@/lib/strategies/time-above-50/TimeAbove50Config';

interface OptimizeRequest {
  sessionIds: string[];
  strategySlug?: string;
  baseParams?: Record<string, unknown>;
  parameterRanges: ParameterRange[];
  initialCapital?: number;
  optimizeMetric?: OptimizationMetric;
  maxCombinations?: number;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as OptimizeRequest;

    // Validate required fields
    if (!body.sessionIds || body.sessionIds.length === 0) {
      return NextResponse.json(
        { error: 'sessionIds is required and must not be empty' },
        { status: 400 }
      );
    }

    if (!body.parameterRanges || body.parameterRanges.length === 0) {
      return NextResponse.json(
        { error: 'parameterRanges is required and must not be empty' },
        { status: 400 }
      );
    }

    // Validate ranges
    const rangeErrors = validateRanges(body.parameterRanges);
    if (rangeErrors.length > 0) {
      return NextResponse.json(
        { error: 'Invalid parameter ranges', details: rangeErrors },
        { status: 400 }
      );
    }

    // Check combination count
    const combinationCount = countCombinations(body.parameterRanges);
    const maxCombinations = body.maxCombinations || MAX_COMBINATIONS_DEFAULT;

    if (combinationCount > maxCombinations) {
      return NextResponse.json(
        {
          error: `Too many parameter combinations (${combinationCount}). Maximum allowed is ${maxCombinations}.`,
          combinationCount,
          maxCombinations,
        },
        { status: 400 }
      );
    }

    // Build config
    const config: OptimizationConfig = {
      sessionIds: body.sessionIds,
      strategySlug: body.strategySlug || 'time-above-50',
      baseParams: { ...DEFAULT_CONFIG, ...(body.baseParams || {}) },
      parameterRanges: body.parameterRanges,
      initialCapital: body.initialCapital || 1000,
      optimizeMetric: body.optimizeMetric || 'sharpeRatio',
      maxCombinations,
    };

    // Create SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const result = await runOptimization(config, (progress) => {
            // Send progress update as SSE
            const data = `data: ${JSON.stringify(progress)}\n\n`;
            controller.enqueue(encoder.encode(data));
          });

          // Send final result
          const finalData = `data: ${JSON.stringify({
            type: 'result',
            runId: result.runId,
            combinationsTested: result.combinationsTested,
            durationSeconds: result.durationSeconds,
            topResults: result.results.slice(0, 10), // Top 10 only in stream
          })}\n\n`;
          controller.enqueue(encoder.encode(finalData));

          controller.close();
        } catch (error) {
          // Send error
          const errorData = `data: ${JSON.stringify({
            status: 'error',
            errorMessage: error instanceof Error ? error.message : String(error),
          })}\n\n`;
          controller.enqueue(encoder.encode(errorData));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[API] Error starting optimization:', error);
    return NextResponse.json(
      {
        error: 'Failed to start optimization',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/backtest/optimize
 *
 * Get combination count for preview (without running).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rangesParam = searchParams.get('ranges');

    if (!rangesParam) {
      return NextResponse.json(
        { error: 'ranges query parameter is required' },
        { status: 400 }
      );
    }

    const ranges = JSON.parse(rangesParam) as ParameterRange[];

    // Validate
    const errors = validateRanges(ranges);
    if (errors.length > 0) {
      return NextResponse.json({ error: 'Invalid ranges', details: errors }, { status: 400 });
    }

    const count = countCombinations(ranges);
    const isWithinLimit = count <= MAX_COMBINATIONS_DEFAULT;

    return NextResponse.json({
      combinationCount: count,
      isWithinLimit,
      maxCombinations: MAX_COMBINATIONS_DEFAULT,
    });
  } catch (error) {
    console.error('[API] Error counting combinations:', error);
    return NextResponse.json(
      { error: 'Failed to count combinations' },
      { status: 500 }
    );
  }
}
