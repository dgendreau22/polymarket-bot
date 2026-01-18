/**
 * Strategy Preset by ID API Route
 *
 * GET /api/strategies/presets/[id] - Get preset by ID
 * DELETE /api/strategies/presets/[id] - Delete preset
 */

import { NextResponse } from "next/server";
import { getPresetById, deletePreset } from "@/lib/persistence/StrategyPresetsRepository";
import { error } from "@/lib/logger";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    const preset = getPresetById(id);

    if (!preset) {
      return NextResponse.json(
        { success: false, error: "Preset not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: preset,
    });
  } catch (err) {
    error("API", "Failed to fetch preset:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    const deleted = deletePreset(id);

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Preset not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Preset deleted",
    });
  } catch (err) {
    error("API", "Failed to delete preset:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
