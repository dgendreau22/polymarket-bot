/**
 * Markets Search API Route
 *
 * GET /api/markets/search - Search markets on Polymarket
 */

import { NextResponse } from "next/server";
import { getGammaClient } from "@/lib/polymarket";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    if (!q || q.trim() === "") {
      return NextResponse.json({
        success: true,
        data: [],
        pagination: { hasMore: false, page: 1 },
      });
    }

    const gamma = getGammaClient();

    // Use the search method from GammaSDK
    const searchResults = await gamma.search({
      q: q.trim(),
      limit_per_type: limit,
      page,
      events_status: "active",
    });

    // Extract markets from events in search results
    const markets: Array<{
      id: string;
      question: string;
      outcomePrices?: string[];
      volume?: string;
      active: boolean;
      slug?: string;
      image?: string;
    }> = [];

    if (searchResults.events && Array.isArray(searchResults.events)) {
      for (const event of searchResults.events) {
        if (event.markets && Array.isArray(event.markets)) {
          for (const market of event.markets) {
            // Parse outcomePrices if it's a stringified JSON array
            let outcomePrices: string[] | undefined;
            if (typeof market.outcomePrices === "string") {
              try {
                outcomePrices = JSON.parse(market.outcomePrices);
              } catch {
                outcomePrices = undefined;
              }
            } else {
              outcomePrices = market.outcomePrices;
            }

            markets.push({
              id: market.id || market.conditionId,
              question: market.question || event.title,
              outcomePrices,
              volume: market.volume,
              active: market.active ?? true,
              slug: market.slug,
              image: market.image,
            });
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: markets,
      pagination: {
        hasMore: searchResults.pagination?.hasMore ?? false,
        page,
      },
      count: markets.length,
    });
  } catch (error) {
    console.error("[API] Failed to search markets:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
