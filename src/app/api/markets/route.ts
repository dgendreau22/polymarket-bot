/**
 * Markets API Route
 *
 * GET /api/markets - Fetch active markets from Polymarket
 */

import { NextResponse } from "next/server";
import { getGammaClient } from "@/lib/polymarket";
import { error } from '@/lib/logger';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const active = searchParams.get("active") !== "false";

    const gamma = getGammaClient();

    // Fetch markets using GammaSDK
    const markets = await gamma.getMarkets({
      limit,
      active,
    });

    return NextResponse.json({
      success: true,
      data: markets,
      count: markets.length,
    });
  } catch (err) {
    error('API', 'Failed to fetch markets:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
