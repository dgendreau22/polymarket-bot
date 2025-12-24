import { MarketDetailClient } from "./market-detail-client";
import { notFound } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function getMarket(id: string) {
  try {
    // Fetch directly from Gamma API to avoid port mismatch issues
    const response = await fetch(
      `https://gamma-api.polymarket.com/markets/${id}`,
      {
        headers: { "Content-Type": "application/json" },
        next: { revalidate: 30 },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error("Failed to fetch market");
    }

    return await response.json();
  } catch (error) {
    console.error("[Market Page] Error fetching market:", error);
    return null;
  }
}

export default async function MarketDetailPage({ params }: PageProps) {
  const { id } = await params;
  const market = await getMarket(id);

  if (!market) {
    notFound();
  }

  return <MarketDetailClient initialMarket={market} />;
}
