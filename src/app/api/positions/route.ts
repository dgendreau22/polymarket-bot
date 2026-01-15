/**
 * Positions API Route
 *
 * GET /api/positions - Get all positions from the connected Polymarket account
 */

import { NextResponse } from 'next/server';
import { hasCredentials, getOrInitClobClient } from '@/lib/polymarket/client';
import { error } from '@/lib/logger';

interface Position {
  asset: string;
  conditionId: string;
  size: string;
  avgPrice: string;
  currentPrice?: string;
  pnl?: string;
  outcome: string;
  marketQuestion?: string;
}

/**
 * GET /api/positions
 * Fetch all positions from the connected account
 */
export async function GET() {
  try {
    if (!hasCredentials()) {
      return NextResponse.json({
        success: true,
        data: [],
        message: 'No credentials configured',
      });
    }

    const client = await getOrInitClobClient();

    // Get balance allowance (includes positions)
    const balanceAllowance = await client.getBalanceAllowance();

    // Get open orders to check for any positions
    const openOrders = await client.getOpenOrders();

    // Combine position data
    const positions: Position[] = [];

    // The CLOB client returns balance information
    // We need to check the actual response structure
    if (balanceAllowance) {
      // Parse balance allowance response
      // Format may vary - adjust based on actual API response
      const balance = balanceAllowance as unknown as {
        balance?: string;
        allowance?: string;
        positions?: Array<{
          asset: string;
          conditionId: string;
          size: string;
          avgPrice: string;
          outcome: string;
        }>;
      };

      if (balance.positions && Array.isArray(balance.positions)) {
        positions.push(...balance.positions.map(p => ({
          asset: p.asset,
          conditionId: p.conditionId,
          size: p.size,
          avgPrice: p.avgPrice,
          outcome: p.outcome,
        })));
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        positions,
        openOrders: openOrders?.length || 0,
        balance: balanceAllowance,
      },
    });
  } catch (err) {
    error('API', 'GET /api/positions error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to fetch positions',
      },
      { status: 500 }
    );
  }
}
