/**
 * POST /api/backtest/phased
 *
 * Run phased optimization with SSE progress streaming.
 */

import { NextResponse } from 'next/server';
import {
  runPhasedOptimization,
  getPhasePresets,
} from '@/lib/backtest/ParameterOptimizer';
import { DEFAULT_CONFIG } from '@/lib/strategies/time-above-50/TimeAbove50Config';
import {
  saveOptimizationRun,
  savePhaseResults,
  getAllOptimizationRuns,
  getOptimizationResultById,
} from '@/lib/persistence/OptimizationRepository';
import type {
  PhasedOptimizationConfig,
  PhaseConfig,
} from '@/lib/backtest/types';

interface PhasedOptimizeRequest {
  sessionIds: string[];
  strategySlug?: string;
  baseParams?: Record<string, unknown>;
  phases?: number[]; // Which phases to run (1-9), defaults to all
  initialCapital?: number;
  saveResult?: boolean;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PhasedOptimizeRequest;

    // Validate required fields
    if (!body.sessionIds || body.sessionIds.length === 0) {
      return NextResponse.json(
        { error: 'sessionIds is required and must not be empty' },
        { status: 400 }
      );
    }

    // Get phase presets
    const allPhases = getPhasePresets();

    // Filter phases if specified
    let phases: PhaseConfig[];
    if (body.phases && body.phases.length > 0) {
      phases = allPhases.filter((p) => body.phases!.includes(p.phase));
      if (phases.length === 0) {
        return NextResponse.json(
          { error: 'No valid phases specified. Valid phases are 1-9.' },
          { status: 400 }
        );
      }
    } else {
      phases = allPhases;
    }

    // Build config
    const config: PhasedOptimizationConfig = {
      sessionIds: body.sessionIds,
      strategySlug: body.strategySlug || 'time-above-50',
      baseParams: { ...DEFAULT_CONFIG, ...(body.baseParams || {}) },
      phases,
      initialCapital: body.initialCapital || 1000,
    };

    // Create SSE stream with cancellation handling
    const encoder = new TextEncoder();
    let isCancelled = false;

    const stream = new ReadableStream({
      async start(controller) {
        // Helper to safely enqueue data (handles cancelled streams)
        const safeEnqueue = (data: string) => {
          if (isCancelled) return false;
          try {
            controller.enqueue(encoder.encode(data));
            return true;
          } catch {
            // Controller is closed, mark as cancelled
            isCancelled = true;
            return false;
          }
        };

        try {
          const result = await runPhasedOptimization(config, (progress) => {
            // Send progress update as SSE (ignore if cancelled)
            const data = `data: ${JSON.stringify(progress)}\n\n`;
            safeEnqueue(data);
          });

          // Don't continue if cancelled
          if (isCancelled) return;

          // Save result if requested
          if (body.saveResult !== false) {
            try {
              saveOptimizationRun({
                id: result.runId,
                strategySlug: config.strategySlug,
                sessionIds: config.sessionIds,
                optimizationType: 'phased',
                phasesConfig: phases.map((p) => ({
                  phase: p.phase,
                  name: p.name,
                  parameterRanges: p.parameterRanges,
                  optimizeMetric: p.optimizeMetric,
                })),
                initialCapital: config.initialCapital,
                totalCombinationsTested: result.totalCombinationsTested,
                durationSeconds: result.totalDurationSeconds,
                finalParams: result.finalParams,
                finalSharpe: result.finalMetrics.sharpeRatio,
                finalPnl: result.finalMetrics.totalPnl,
                finalWinRate: result.finalMetrics.winRate,
                results: result,
              });

              savePhaseResults(result.runId, result.phaseSummaries);
            } catch (saveError) {
              console.error('[API] Error saving optimization result:', saveError);
            }
          }

          // Send final result
          const finalData = `data: ${JSON.stringify({
            type: 'result',
            runId: result.runId,
            optimizationRunId: result.runId,
            strategySlug: config.strategySlug,
            totalCombinationsTested: result.totalCombinationsTested,
            totalDurationSeconds: result.totalDurationSeconds,
            finalParams: result.finalParams,
            finalMetrics: result.finalMetrics,
            phaseSummaries: result.phaseSummaries.map((ps) => ({
              phase: ps.phase,
              name: ps.name,
              combinationsTested: ps.combinationsTested,
              durationSeconds: ps.durationSeconds,
              bestParams: ps.bestParams,
              skipped: ps.skipped,
              skipReason: ps.skipReason,
              topResult: ps.topResults[0] || null,
            })),
          })}\n\n`;

          if (safeEnqueue(finalData)) {
            controller.close();
          }
        } catch (error) {
          if (isCancelled) return;

          // Send error
          const errorData = `data: ${JSON.stringify({
            status: 'error',
            errorMessage: error instanceof Error ? error.message : String(error),
          })}\n\n`;

          if (safeEnqueue(errorData)) {
            controller.close();
          }
        }
      },
      cancel() {
        // Called when the client disconnects
        isCancelled = true;
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
    console.error('[API] Error starting phased optimization:', error);
    return NextResponse.json(
      {
        error: 'Failed to start phased optimization',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/backtest/phased
 *
 * Get phased optimization runs history or a specific run.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const limit = searchParams.get('limit');

    if (id) {
      // Get specific optimization result
      const result = getOptimizationResultById(id);
      if (!result) {
        return NextResponse.json(
          { error: 'Optimization run not found' },
          { status: 404 }
        );
      }
      return NextResponse.json({ success: true, result });
    }

    // Get optimization runs list
    const runs = getAllOptimizationRuns(limit ? parseInt(limit, 10) : 20);
    return NextResponse.json({ success: true, runs });
  } catch (error) {
    console.error('[API] Error fetching optimization runs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch optimization runs' },
      { status: 500 }
    );
  }
}
