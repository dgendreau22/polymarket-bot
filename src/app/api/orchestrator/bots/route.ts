/**
 * GET /api/orchestrator/bots - Get orchestrator bot history
 */

import { NextResponse } from 'next/server';
import { getOrchestrator } from '@/lib/bots/Orchestrator';

export async function GET() {
  const orchestrator = getOrchestrator();

  return NextResponse.json({
    success: true,
    data: orchestrator.getBotHistory(),
  });
}
