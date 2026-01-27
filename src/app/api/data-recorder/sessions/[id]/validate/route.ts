/**
 * Session Validation API
 *
 * GET /api/data-recorder/sessions/[id]/validate - Validate data quality for a session
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateSession, getRecordingSessionById } from '@/lib/persistence/DataRepository';

export async function GET(
  _request: NextRequest,
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

  const result = validateSession(id);

  if (!result) {
    return NextResponse.json(
      { success: false, error: 'Validation failed' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    data: result,
  });
}
