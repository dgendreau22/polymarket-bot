/**
 * All Ticks API
 *
 * GET /api/data-recorder/ticks - Get all ticks across all sessions
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAllTicks } from '@/lib/persistence/DataRepository';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const outcome = searchParams.get('outcome') as 'YES' | 'NO' | null;

  const ticks = getAllTicks(outcome || undefined);

  return NextResponse.json({
    success: true,
    data: ticks,
    count: ticks.length,
  });
}
