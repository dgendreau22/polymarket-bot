/**
 * Strategy Presets API Route
 *
 * GET /api/strategies/presets - List presets (optionally filter by strategy)
 * POST /api/strategies/presets - Create a new preset
 */

import { NextResponse } from "next/server";
import {
  createPreset,
  getPresetsByStrategy,
  getAllPresets,
} from "@/lib/persistence/StrategyPresetsRepository";
import { error } from "@/lib/logger";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const strategySlug = searchParams.get("strategy");

    const presets = strategySlug
      ? getPresetsByStrategy(strategySlug)
      : getAllPresets();

    return NextResponse.json({
      success: true,
      data: presets,
    });
  } catch (err) {
    error("API", "Failed to fetch presets:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const { name, strategySlug, description, params, sourceOptimizationId, finalSharpe, finalPnl, finalWinRate } = body;

    // Validate required fields
    if (!name || typeof name !== "string" || name.trim() === "") {
      return NextResponse.json(
        { success: false, error: "Name is required" },
        { status: 400 }
      );
    }

    if (!strategySlug || typeof strategySlug !== "string") {
      return NextResponse.json(
        { success: false, error: "Strategy slug is required" },
        { status: 400 }
      );
    }

    if (!params || typeof params !== "object") {
      return NextResponse.json(
        { success: false, error: "Params are required" },
        { status: 400 }
      );
    }

    const preset = createPreset({
      name: name.trim(),
      strategySlug,
      description: description?.trim() || undefined,
      params,
      sourceOptimizationId,
      finalSharpe,
      finalPnl,
      finalWinRate,
    });

    return NextResponse.json({
      success: true,
      data: preset,
    });
  } catch (err) {
    error("API", "Failed to create preset:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
