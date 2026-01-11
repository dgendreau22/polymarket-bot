/**
 * Session Statistics API
 *
 * GET /api/data-recorder/sessions/[id]/stats - Get statistics for a session
 */

import { NextRequest, NextResponse } from 'next/server';
import { calculateSessionStats, getRecordingSessionById } from '@/lib/persistence/DataRepository';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Check if session exists
  const session = getRecordingSessionById(id);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Session not found' },
      { status: 404 }
    );
  }

  const stats = calculateSessionStats(id);

  return NextResponse.json({
    success: true,
    data: {
      session,
      stats,
    },
  });
}
