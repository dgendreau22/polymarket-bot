import { NextRequest, NextResponse } from 'next/server';
import {
  getRecordingSessionById,
  deleteRecordingSession,
} from '@/lib/persistence/DataRepository';
import { getDataRecorder } from '@/lib/data/DataRecorder';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/data-recorder/sessions/[id]
 * Get a specific recording session
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id } = await context.params;

  const session = getRecordingSessionById(id);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Session not found' },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, data: session });
}

/**
 * DELETE /api/data-recorder/sessions/[id]
 * Delete a recording session and all associated data
 */
export async function DELETE(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id } = await context.params;

  // Check if this session is currently being recorded
  const recorder = getDataRecorder();
  const status = recorder.getStatus();
  if (status.currentSession?.id === id) {
    return NextResponse.json(
      { success: false, error: 'Cannot delete session that is currently recording' },
      { status: 400 }
    );
  }

  // Check if session exists
  const session = getRecordingSessionById(id);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Session not found' },
      { status: 404 }
    );
  }

  // Delete the session and all associated data
  const deleted = deleteRecordingSession(id);
  if (!deleted) {
    return NextResponse.json(
      { success: false, error: 'Failed to delete session' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, data: { deleted: true, id } });
}
