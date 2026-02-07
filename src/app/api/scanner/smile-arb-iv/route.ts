/**
 * Smile Arbitrage IV Scanner API Route
 *
 * GET /api/scanner/smile-arb-iv - Scan markets for smile arbitrage opportunities
 */

import { NextResponse } from 'next/server';
import { ScannerService } from '@/lib/strategies/smile-arb-iv/scanner-service';
import { error } from '@/lib/logger';

/**
 * Validates ISO date format (YYYY-MM-DD)
 */
function isValidISODate(dateString: string): boolean {
  const iso8601Regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso8601Regex.test(dateString)) {
    return false;
  }

  const date = new Date(dateString + 'T00:00:00Z');
  return !isNaN(date.getTime());
}

/**
 * GET /api/scanner/smile-arb-iv
 * Scan markets for smile arbitrage opportunities
 *
 * Query params:
 * - settlementDate: Required. ISO date string (YYYY-MM-DD)
 * - strikeRange: Optional. Percentage distance from BTC spot to filter strikes (default: 0 = all)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const settlementDate = searchParams.get('settlementDate');
    const strikeRangeParam = searchParams.get('strikeRange');

    // Validate required parameter
    if (!settlementDate) {
      return NextResponse.json(
        {
          success: false,
          error: 'settlementDate query parameter is required',
        },
        { status: 400 }
      );
    }

    // Validate date format
    if (!isValidISODate(settlementDate)) {
      return NextResponse.json(
        {
          success: false,
          error: 'settlementDate must be a valid ISO date in YYYY-MM-DD format',
        },
        { status: 400 }
      );
    }

    // Parse strikeRange (0 means no filtering)
    const strikeRange = strikeRangeParam ? parseInt(strikeRangeParam, 10) : 0;
    if (strikeRangeParam && (isNaN(strikeRange) || strikeRange < 0 || strikeRange > 100)) {
      return NextResponse.json(
        {
          success: false,
          error: 'strikeRange must be a number between 0 and 100',
        },
        { status: 400 }
      );
    }

    // Scan markets
    const scanner = new ScannerService();
    const results = await scanner.scanMarkets(settlementDate, { strikeRange });

    // Count opportunities
    const opportunityCount = results.filter((r) => r.hasOpportunity).length;

    return NextResponse.json(
      {
        success: true,
        data: {
          settlementDate,
          strikeRange: strikeRange || null, // null if no filtering
          scannedAt: new Date().toISOString(),
          marketCount: results.length,
          opportunityCount,
          results,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    error('API', 'GET /api/scanner/smile-arb-iv error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to scan markets',
      },
      { status: 500 }
    );
  }
}
