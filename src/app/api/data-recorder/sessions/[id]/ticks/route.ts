/**
 * Session Ticks API
 *
 * GET /api/data-recorder/sessions/[id]/ticks - Get ticks for a session
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTicksBySession, getRecordingSessionById } from '@/lib/persistence/DataRepository';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const outcome = searchParams.get('outcome') as 'YES' | 'NO' | null;

  // Check if session exists
  const session = getRecordingSessionById(id);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Session not found' },
      { status: 404 }
    );
  }

  const ticks = getTicksBySession(id, outcome || undefined);

  return NextResponse.json({
    success: true,
    data: ticks,
  });
}
