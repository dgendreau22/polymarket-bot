import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Market ID is required" },
        { status: 400 }
      );
    }

    // Fetch market directly from Gamma API
    const response = await fetch(
      `https://gamma-api.polymarket.com/markets/${id}`,
      {
        headers: {
          "Content-Type": "application/json",
        },
        next: { revalidate: 30 }, // Cache for 30 seconds
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json(
          { success: false, error: "Market not found" },
          { status: 404 }
        );
      }
      throw new Error(`Gamma API error: ${response.status}`);
    }

    const market = await response.json();

    return NextResponse.json({
      success: true,
      data: market,
    });
  } catch (error) {
    console.error("[API] Error fetching market:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch market",
      },
      { status: 500 }
    );
  }
}
