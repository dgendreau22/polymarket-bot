/**
 * Bot API Routes
 *
 * GET /api/bots - List all bots
 * POST /api/bots - Create a new bot
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBotManager } from '@/lib/bots';
import { getExecutor } from '@/lib/strategies/registry';
import type { BotMode, BotState } from '@/lib/bots/types';
import { log, warn, error } from '@/lib/logger';

/**
 * GET /api/bots
 * List all bots with optional filters
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const state = searchParams.get('state') as BotState | null;
    const mode = searchParams.get('mode') as BotMode | null;
    const strategySlug = searchParams.get('strategy');

    const botManager = getBotManager();
    const bots = botManager.getAllBots({
      state: state || undefined,
      mode: mode || undefined,
      strategySlug: strategySlug || undefined,
    });

    return NextResponse.json({
      success: true,
      data: bots,
      count: bots.length,
    });
  } catch (err) {
    error('API', 'GET /api/bots error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to fetch bots',
      },
      { status: 500 }
    );
  }
}

/**
 * Helper to parse JSON string arrays
 */
function parseJsonArray<T>(value: T[] | string | undefined): T[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * POST /api/bots
 * Create a new bot
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.strategySlug || !body.marketId || !body.mode) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: strategySlug, marketId, mode',
        },
        { status: 400 }
      );
    }

    // Auto-generate name if not provided
    const name = body.name || `${body.strategySlug}-${Date.now()}`;

    // Validate mode
    if (!['live', 'dry_run'].includes(body.mode)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid mode. Must be "live" or "dry_run"',
        },
        { status: 400 }
      );
    }

    // Auto-fetch asset IDs from market if not provided
    // All bots get both YES and NO asset IDs when available (normalized dual-asset support)
    let assetId = body.assetId;
    let noAssetId = body.noAssetId;

    if (!assetId || !noAssetId) {
      try {
        // Fetch directly from Gamma API to avoid port mismatch issues
        const marketRes = await fetch(
          `https://gamma-api.polymarket.com/markets/${body.marketId}`,
          { headers: { 'Content-Type': 'application/json' } }
        );
        const marketData = await marketRes.json();

        if (marketData) {
          const tokenIds = parseJsonArray<string>(marketData.clobTokenIds);
          if (tokenIds && tokenIds.length > 0) {
            if (!assetId) {
              assetId = tokenIds[0]; // YES token
              log('API', `Auto-assigned YES assetId: ${assetId}`);
            }
            // Always fetch NO token if market has two outcomes
            if (!noAssetId && tokenIds.length > 1) {
              noAssetId = tokenIds[1]; // NO token
              log('API', `Auto-assigned NO assetId: ${noAssetId}`);
            }
          }
        }
      } catch (fetchErr) {
        warn('API', 'Failed to fetch market for assetId:', fetchErr);
        // Continue without assetId - bot will work but without live market data
      }
    }

    // Validate if strategy requires dual assets (determined by executor metadata, not strategy name)
    const executor = getExecutor(body.strategySlug);
    const requiresDualAssets = executor?.metadata.requiredAssets.some(
      (a) => a.configKey === 'noAssetId'
    );

    if (requiresDualAssets && (!assetId || !noAssetId)) {
      return NextResponse.json(
        {
          success: false,
          error: `Strategy '${body.strategySlug}' requires both YES and NO asset IDs. Market may not have two outcomes.`,
        },
        { status: 400 }
      );
    }

    const botManager = getBotManager();
    const bot = botManager.createBot({
      name,
      strategySlug: body.strategySlug,
      marketId: body.marketId,
      marketName: body.marketName,
      assetId,
      noAssetId, // Always include (may be undefined for single-outcome markets)
      mode: body.mode as BotMode,
      strategyConfig: body.strategyConfig,
    });

    return NextResponse.json({
      success: true,
      data: bot,
    });
  } catch (err) {
    error('API', 'POST /api/bots error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to create bot',
      },
      { status: 500 }
    );
  }
}
