/**
 * Bot API Routes
 *
 * GET /api/bots - List all bots
 * POST /api/bots - Create a new bot
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBotManager } from '@/lib/bots';
import type { BotMode, BotState } from '@/lib/bots/types';

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
  } catch (error) {
    console.error('[API] GET /api/bots error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch bots',
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

    // Auto-fetch assetId from market if not provided
    let assetId = body.assetId;
    if (!assetId) {
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
            assetId = tokenIds[0]; // Use YES token as default
            console.log(`[API] Auto-assigned assetId: ${assetId}`);
          }
        }
      } catch (err) {
        console.warn('[API] Failed to fetch market for assetId:', err);
        // Continue without assetId - bot will work but without live market data
      }
    }

    const botManager = getBotManager();
    const bot = botManager.createBot({
      name,
      strategySlug: body.strategySlug,
      marketId: body.marketId,
      marketName: body.marketName,
      assetId,
      mode: body.mode as BotMode,
      strategyConfig: body.strategyConfig,
    });

    return NextResponse.json({
      success: true,
      data: bot,
    });
  } catch (error) {
    console.error('[API] POST /api/bots error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create bot',
      },
      { status: 500 }
    );
  }
}
