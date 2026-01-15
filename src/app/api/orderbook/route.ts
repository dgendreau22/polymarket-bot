import { NextResponse } from "next/server";
import { error } from '@/lib/logger';

const CLOB_HOST = process.env.POLYMARKET_CLOB_HOST || "https://clob.polymarket.com";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const tokenId = url.searchParams.get("token_id");

    if (!tokenId) {
      return NextResponse.json(
        { success: false, error: "token_id is required" },
        { status: 400 }
      );
    }

    // Fetch order book from CLOB API
    const response = await fetch(
      `${CLOB_HOST}/book?token_id=${encodeURIComponent(tokenId)}`,
      {
        headers: {
          "Content-Type": "application/json",
        },
        // No caching - we want fresh data for real-time updates
        cache: "no-store",
      }
    );

    if (!response.ok) {
      throw new Error(`CLOB API error: ${response.status}`);
    }

    const orderBook = await response.json();

    return NextResponse.json({
      success: true,
      data: orderBook,
      timestamp: Date.now(),
    });
  } catch (err) {
    error('API', 'Error fetching order book:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to fetch order book",
      },
      { status: 500 }
    );
  }
}
