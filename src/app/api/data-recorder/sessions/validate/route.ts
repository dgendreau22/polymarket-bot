/**
 * Batch Session Validation API
 *
 * POST /api/data-recorder/sessions/validate - Validate data quality for multiple sessions
 *
 * Request body:
 * {
 *   sessionIds: string[]  // Array of session IDs to validate
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateSessions, getAllRecordingSessions } from '@/lib/persistence/DataRepository';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionIds } = body as { sessionIds?: string[] };

    // If no sessionIds provided, validate all sessions
    let idsToValidate: string[];
    if (!sessionIds || sessionIds.length === 0) {
      const allSessions = getAllRecordingSessions();
      idsToValidate = allSessions.map((s) => s.id);
    } else {
      idsToValidate = sessionIds;
    }

    const results = validateSessions(idsToValidate);

    // Calculate summary stats
    const summary = {
      total: results.length,
      valid: results.filter((r) => r.status === 'valid').length,
      warning: results.filter((r) => r.status === 'warning').length,
      error: results.filter((r) => r.status === 'error').length,
    };

    return NextResponse.json({
      success: true,
      data: {
        summary,
        results,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Invalid request body' },
      { status: 400 }
    );
  }
}
