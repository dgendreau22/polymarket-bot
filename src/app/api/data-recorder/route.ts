/**
 * Data Recorder API Routes
 *
 * GET /api/data-recorder - Get recorder status
 * POST /api/data-recorder - Start recorder
 * DELETE /api/data-recorder - Stop recorder
 */

import { NextResponse } from 'next/server';
import { getDataRecorder } from '@/lib/data';

export async function GET() {
  const recorder = getDataRecorder();

  return NextResponse.json({
    success: true,
    data: recorder.getStatus(),
  });
}

export async function POST() {
  try {
    const recorder = getDataRecorder();
    await recorder.start();

    return NextResponse.json({
      success: true,
      data: recorder.getStatus(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start data recorder';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const recorder = getDataRecorder();
    await recorder.stop();

    return NextResponse.json({
      success: true,
      data: recorder.getStatus(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to stop data recorder';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
