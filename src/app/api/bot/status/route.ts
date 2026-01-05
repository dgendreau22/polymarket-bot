/**
 * Bot Status API Route
 *
 * GET /api/bot/status - Get current bot status
 */

import { NextResponse } from "next/server";
import { hasCredentials, getConfig, getOrInitClobClient } from "@/lib/polymarket";
import { getBotManager } from "@/lib/bots/BotManager";
import { AssetType } from "@polymarket/clob-client";

async function getPortfolioData() {
  if (!hasCredentials()) {
    return {
      totalValue: 0,
      cashBalance: 0,
      positionsValue: 0,
    };
  }

  try {
    const client = await getOrInitClobClient();

    // Fetch USDC collateral balance (cash)
    const balanceResponse = await client.getBalanceAllowance({
      asset_type: AssetType.COLLATERAL,
    });

    const cashBalance = parseFloat(balanceResponse.balance) / 1e6; // USDC has 6 decimals

    // For positions value, we'd need to:
    // 1. Get all open orders and filled trades
    // 2. Calculate current position values based on market prices
    // This is complex - for now return 0, can be implemented later
    const positionsValue = 0;

    return {
      totalValue: cashBalance + positionsValue,
      cashBalance,
      positionsValue,
    };
  } catch (error) {
    console.error("[API] Failed to fetch portfolio data:", error);
    return {
      totalValue: 0,
      cashBalance: 0,
      positionsValue: 0,
    };
  }
}

export async function GET() {
  try {
    const botManager = getBotManager();
    const portfolio = await getPortfolioData();
    const bots = botManager.getAllBots();

    // Count bots by strategy
    const botsByStrategy = bots.reduce((acc, bot) => {
      const strategy = bot.config.strategySlug;
      acc[strategy] = (acc[strategy] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return NextResponse.json({
      success: true,
      data: {
        configured: hasCredentials(),
        config: getConfig(),
        bots: {
          total: bots.length,
          running: bots.filter(b => b.state === 'running').length,
          byStrategy: botsByStrategy,
        },
        portfolio,
      },
    });
  } catch (error) {
    console.error("[API] Failed to get bot status:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
