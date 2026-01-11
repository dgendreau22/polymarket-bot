/**
 * Recording Sessions API
 *
 * GET /api/data-recorder/sessions - List all recording sessions
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAllRecordingSessions } from '@/lib/persistence/DataRepository';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : 50;

  const sessions = getAllRecordingSessions(limit);

  return NextResponse.json({
    success: true,
    data: sessions,
  });
}
