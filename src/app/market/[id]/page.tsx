import { MarketDetailClient } from "./market-detail-client";
import { notFound } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function getMarket(id: string) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

  try {
    const response = await fetch(`${baseUrl}/api/markets/${id}`, {
      next: { revalidate: 30 },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error("Failed to fetch market");
    }

    const data = await response.json();
    return data.success ? data.data : null;
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
