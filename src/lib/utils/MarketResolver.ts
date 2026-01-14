/**
 * Market Resolver
 *
 * Handles market resolution detection and position settlement.
 * When a market closes, this module detects the winning outcome from
 * last trade prices and settles all open positions at resolution prices.
 */

import { v4 as uuidv4 } from 'uuid';
import type { LastTrade } from '../polymarket/types';
import type { Trade, PositionRow } from '../bots/types';
import {
  getPositionsByBotId,
  updatePosition,
  getBotById,
} from '../persistence/BotRepository';
import { createTrade } from '../persistence/TradeRepository';

// ============================================================================
// Constants
// ============================================================================

/** Thresholds for determining market resolution */
export const RESOLUTION_THRESHOLDS = {
  /** Price >= this indicates the winning outcome */
  WINNER: 0.95,
  /** Price <= this indicates the losing outcome */
  LOSER: 0.05,
};

// ============================================================================
// Types
// ============================================================================

/** Result of resolution detection */
export interface ResolutionResult {
  winningOutcome: 'YES' | 'NO' | 'UNKNOWN';
  yesResolutionPrice: number;
  noResolutionPrice: number;
  confidence: number;
}

/** Result of settling a single position */
export interface SettlementResult {
  botId: string;
  assetId: string;
  outcome: 'YES' | 'NO';
  originalSize: number;
  avgEntryPrice: number;
  settlementPrice: number;
  realizedPnl: number;
  tradeId: string;
}

// ============================================================================
// Resolution Detection
// ============================================================================

/**
 * Detect market resolution from last trade prices.
 *
 * When a market resolves:
 * - If YES wins: YES trades at ~$1, NO trades at ~$0
 * - If NO wins: YES trades at ~$0, NO trades at ~$1
 *
 * @param lastTrades - Map of outcome label ('YES'|'NO') to LastTrade
 * @returns Resolution result with winning outcome and prices
 */
export function detectResolution(
  lastTrades: Map<string, LastTrade>
): ResolutionResult {
  const yesLastTrade = lastTrades.get('YES');
  const noLastTrade = lastTrades.get('NO');

  // Parse available prices
  const yesTradePrice = yesLastTrade ? parseFloat(yesLastTrade.price) : null;
  const noTradePrice = noLastTrade ? parseFloat(noLastTrade.price) : null;

  // Use complementary price as fallback (YES + NO ≈ 1.00)
  // If one outcome has no trade data, infer from the other
  const yesPrice = yesTradePrice ?? (noTradePrice !== null ? 1 - noTradePrice : 0.5);
  const noPrice = noTradePrice ?? (yesTradePrice !== null ? 1 - yesTradePrice : 0.5);

  // Calculate confidence based on how extreme the prices are
  const maxPrice = Math.max(yesPrice, noPrice);
  const minPrice = Math.min(yesPrice, noPrice);
  const confidence =
    maxPrice >= RESOLUTION_THRESHOLDS.WINNER &&
    minPrice <= RESOLUTION_THRESHOLDS.LOSER
      ? 1.0
      : maxPrice - minPrice;

  // Determine winner based on thresholds
  if (
    yesPrice >= RESOLUTION_THRESHOLDS.WINNER &&
    noPrice <= RESOLUTION_THRESHOLDS.LOSER
  ) {
    return {
      winningOutcome: 'YES',
      yesResolutionPrice: 1.0,
      noResolutionPrice: 0.0,
      confidence,
    };
  }

  if (
    noPrice >= RESOLUTION_THRESHOLDS.WINNER &&
    yesPrice <= RESOLUTION_THRESHOLDS.LOSER
  ) {
    return {
      winningOutcome: 'NO',
      yesResolutionPrice: 0.0,
      noResolutionPrice: 1.0,
      confidence,
    };
  }

  // Could not determine clear winner
  return {
    winningOutcome: 'UNKNOWN',
    yesResolutionPrice: yesPrice,
    noResolutionPrice: noPrice,
    confidence: 0,
  };
}

// ============================================================================
// Position Settlement
// ============================================================================

/**
 * Settle a single position at the resolution price.
 *
 * Creates a settlement trade record and updates the position to zero.
 *
 * @param botId - Bot ID
 * @param position - Position to settle
 * @param resolutionPrice - Final price (1.0 for winner, 0.0 for loser)
 * @returns Settlement result or null if position has no size
 */
export function settlePosition(
  botId: string,
  position: PositionRow,
  resolutionPrice: number
): SettlementResult | null {
  const size = parseFloat(position.size);
  if (size <= 0) {
    return null; // No position to settle
  }

  const avgEntryPrice = parseFloat(position.avg_entry_price);
  const currentRealizedPnl = parseFloat(position.realized_pnl);

  // Calculate PnL from settlement
  const settlementPnl = (resolutionPrice - avgEntryPrice) * size;
  const newRealizedPnl = currentRealizedPnl + settlementPnl;

  // Get bot info for trade record
  const bot = getBotById(botId);
  if (!bot) {
    console.warn(`[MarketResolver] Bot not found: ${botId}`);
    return null;
  }

  // Create settlement trade record
  const tradeId = uuidv4();
  const now = new Date();

  const settlementTrade: Trade = {
    id: tradeId,
    botId,
    strategySlug: bot.strategy_slug,
    marketId: bot.market_id,
    assetId: position.asset_id,
    mode: bot.mode,
    side: 'SELL', // Settlement is equivalent to selling at resolution price
    outcome: position.outcome,
    price: resolutionPrice.toString(),
    quantity: size.toString(),
    totalValue: (resolutionPrice * size).toFixed(6),
    fee: '0',
    pnl: settlementPnl.toFixed(6),
    status: 'settlement',
    executedAt: now,
    createdAt: now,
  };

  createTrade(settlementTrade);

  // Update position: set size to 0, update realized PnL
  updatePosition(botId, position.asset_id, {
    size: '0',
    avgEntryPrice: '0',
    realizedPnl: newRealizedPnl.toFixed(6),
  });

  console.log(
    `[MarketResolver] Settled ${position.outcome} position: ` +
      `${size.toFixed(4)} @ avg ${avgEntryPrice.toFixed(4)} -> ` +
      `settled @ ${resolutionPrice} | PnL: ${settlementPnl.toFixed(4)}`
  );

  return {
    botId,
    assetId: position.asset_id,
    outcome: position.outcome,
    originalSize: size,
    avgEntryPrice,
    settlementPrice: resolutionPrice,
    realizedPnl: settlementPnl,
    tradeId,
  };
}

/**
 * Settle all positions for a bot at resolution prices.
 *
 * For dual-asset bots, this settles both YES and NO positions.
 *
 * @param botId - Bot ID
 * @param resolution - Resolution result with winning outcome and prices
 * @returns Array of settlement results
 */
export function settleAllPositions(
  botId: string,
  resolution: ResolutionResult
): SettlementResult[] {
  const settlements: SettlementResult[] = [];

  // Get all positions for this bot
  const positionRows = getPositionsByBotId(botId);

  for (const position of positionRows) {
    // Determine resolution price based on outcome
    const resolutionPrice =
      position.outcome === 'YES'
        ? resolution.yesResolutionPrice
        : resolution.noResolutionPrice;

    const result = settlePosition(botId, position, resolutionPrice);
    if (result) {
      settlements.push(result);
    }
  }

  return settlements;
}
