/**
 * Scanner Service
 *
 * Orchestrates market scanning for smile arbitrage opportunities.
 * Discovers markets, fetches order books, prices options using IV surface,
 * and calculates edges for trading opportunities.
 */

import { MarketDiscovery, DiscoveredMarket } from './market-discovery';
import { DeribitClient } from '@/lib/deribit/client';
import { computeTheoreticalPriceWithDiagnostics, TheoreticalPriceResult } from './pricing-engine';
import { IVSnapshot } from '@/lib/deribit/types';
import { log, warn, error, createLogger } from '@/lib/logger';

const logger = createLogger('ScannerService');

const CLOB_HOST = process.env.POLYMARKET_CLOB_HOST || 'https://clob.polymarket.com';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for scanner configuration
 */
export interface ScannerOptions {
  /**
   * Percentage distance from BTC spot price to filter strikes.
   * E.g., 20 means only scan strikes between 80% and 120% of spot price.
   * Set to 0 or undefined for no filtering.
   */
  strikeRange?: number;
}

export interface ScannerResult {
  marketId: string;
  question: string;
  strike: number;
  settlementDate: string;
  yesBid: number;
  yesAsk: number;
  noBid: number;
  noAsk: number;
  yesBidSize: number;
  yesAskSize: number;
  noBidSize: number;
  noAskSize: number;
  yesLastTrade: number | null;
  noLastTrade: number | null;
  yesSpread: number;
  noSpread: number;
  theoreticalYes: number;
  theoreticalNo: number;
  interpolatedIV: number;
  confidence: 'high' | 'medium' | 'low';
  yesEdge: number | null; // (theo - marketPrice - 0.02) * 100
  noEdge: number | null;
  bestEdge: number | null;
  hasOpportunity: boolean; // bestEdge > 2
  yesHasLiquidity: boolean;
  noHasLiquidity: boolean;
}

interface OrderBookData {
  bestBid: number;
  bestAsk: number;
  bestBidSize: number;
  bestAskSize: number;
  hasAsks: boolean;  // True if there's actual ask liquidity
  hasBids: boolean;  // True if there's actual bid liquidity
  lastTradePrice: number | null;  // Most recent trade price
  midPrice: number;  // (bestBid + bestAsk) / 2
  spread: number;  // bestAsk - bestBid
}

// ============================================================================
// Scanner Service
// ============================================================================

export class ScannerService {
  private discovery: MarketDiscovery;
  private deribit: DeribitClient;

  constructor() {
    this.discovery = new MarketDiscovery();
    this.deribit = DeribitClient.getInstance();
  }

  /**
   * Main entry point: Scan markets for arbitrage opportunities.
   *
   * @param settlementDate - Target settlement date (ISO string)
   * @param options - Optional scanner configuration
   * @returns Array of scanner results sorted by best edge descending
   */
  async scanMarkets(settlementDate: string, options: ScannerOptions = {}): Promise<ScannerResult[]> {
    try {
      const strikeRange = options.strikeRange ?? 0; // 0 means no filtering
      logger.log(`Starting scan for settlement date: ${settlementDate}, strikeRange: ${strikeRange || 'all'}%`);

      // Step 1: Fetch BTC spot price FIRST (needed for strike filtering)
      const btcSpot = await this.deribit.getBTCSpotPrice();
      logger.log(`BTC spot price: $${btcSpot.toLocaleString()}`);

      // Calculate strike bounds if filtering is enabled
      let minStrike: number | undefined;
      let maxStrike: number | undefined;
      if (strikeRange > 0) {
        minStrike = btcSpot * (1 - strikeRange / 100);
        maxStrike = btcSpot * (1 + strikeRange / 100);
        logger.log(`Strike filter range: $${minStrike.toLocaleString()} - $${maxStrike.toLocaleString()}`);
      }

      // Step 2: Discover markets matching settlement date
      let markets = await this.discovery.discoverMarkets({
        mode: 'auto-scan',
        searchPattern: 'Bitcoin above',
        settlementDate,
      });

      if (markets.length === 0) {
        logger.log('No markets found for settlement date');
        return [];
      }

      const originalCount = markets.length;

      // Step 2.5: Filter markets by strike distance from BTC spot
      if (strikeRange > 0 && minStrike !== undefined && maxStrike !== undefined) {
        markets = markets.filter(m => m.strike >= minStrike! && m.strike <= maxStrike!);
        logger.log(`Strike filter applied: ${originalCount} -> ${markets.length} markets`);
      } else {
        logger.log(`Found ${markets.length} markets to scan (no strike filter)`);
      }

      if (markets.length === 0) {
        logger.log('No markets within strike range');
        return [];
      }

      // Step 3: Fetch IV snapshot with strike filter for efficiency
      const ivSnapshot = await this.deribit.getIVSnapshot(new Date(settlementDate), {
        minStrike,
        maxStrike,
      });

      logger.log(`IV snapshot ready: underlying=$${ivSnapshot.underlying_price.toLocaleString()}, expiries=${ivSnapshot.expiries.length}`);

      // Step 3: Process markets in parallel
      const results = await Promise.all(
        markets.map((market) =>
          this.scanMarket(market, ivSnapshot, settlementDate).catch((err) => {
            warn('ScannerService', `Failed to scan market ${market.marketId}:`, err);
            return null;
          })
        )
      );

      // Log success/failure counts
      const successCount = results.filter((r) => r !== null).length;
      const failCount = results.length - successCount;
      logger.log(`Order book fetch results: ${successCount} succeeded, ${failCount} failed out of ${results.length} markets`);

      // Step 4: Filter out null results and sort by strike (high to low)
      const validResults = results.filter((r): r is ScannerResult => r !== null);

      const sortedResults = validResults.sort((a, b) => a.strike - b.strike);

      logger.log(`Scan complete: ${sortedResults.length} results, ${sortedResults.filter((r) => r.hasOpportunity).length} with opportunities`);

      return sortedResults;
    } catch (err) {
      error('ScannerService', 'Scan failed:', err);
      throw err;
    }
  }

  /**
   * Scan a single market for arbitrage opportunities.
   */
  private async scanMarket(
    market: DiscoveredMarket,
    ivSnapshot: IVSnapshot,
    settlementDate: string
  ): Promise<ScannerResult | null> {
    try {
      // Fetch order books for YES and NO tokens in parallel
      const [yesOrderBook, noOrderBook] = await Promise.all([
        this.fetchOrderBook(market.yesToken),
        this.fetchOrderBook(market.noToken),
      ]);

      if (!yesOrderBook || !noOrderBook) {
        logger.warn(`Skipping market ${market.strike} (${market.marketId}): missing order book (YES: ${!!yesOrderBook}, NO: ${!!noOrderBook})`);
        return null;
      }

      // Compute theoretical prices using IV surface
      const targetExpiry = market.settlementDate ?? new Date(settlementDate);
      const yesPricing = computeTheoreticalPriceWithDiagnostics(
        ivSnapshot,
        market.strike,
        targetExpiry
      );

      // NO price is complement of YES price
      const theoreticalNo = 1 - yesPricing.price;

      // Determine market price to use for edge calculation
      // Use mid-price when spread is reasonable, otherwise best ask
      const getMarketPrice = (ob: OrderBookData): number | null => {
        if (!ob.hasAsks || !ob.hasBids) return null;

        // Use mid-price if spread is reasonable (< 20%)
        // This is more reliable than last_trade_price which can be stale
        if (ob.spread < 0.2) {
          return ob.midPrice;
        }

        // For wider spreads, use best ask (conservative for buy signals)
        return ob.bestAsk;
      };

      const yesMarketPrice = getMarketPrice(yesOrderBook);
      const noMarketPrice = getMarketPrice(noOrderBook);

      // Calculate edges: (theo - marketPrice - 0.02) * 100
      // Positive edge = theo > market price (buy opportunity)
      // Subtract 2 cents for fees/spread capture
      const yesEdge = yesMarketPrice !== null
        ? (yesPricing.price - yesMarketPrice - 0.02) * 100
        : null;
      const noEdge = noMarketPrice !== null
        ? (theoreticalNo - noMarketPrice - 0.02) * 100
        : null;

      // Best edge is the max of available edges
      let bestEdge: number | null = null;
      if (yesEdge !== null && noEdge !== null) {
        bestEdge = Math.max(yesEdge, noEdge);
      } else if (yesEdge !== null) {
        bestEdge = yesEdge;
      } else if (noEdge !== null) {
        bestEdge = noEdge;
      }

      const hasOpportunity = bestEdge !== null && bestEdge > 2;

      return {
        marketId: market.marketId,
        question: market.question,
        strike: market.strike,
        settlementDate: targetExpiry.toISOString(),
        yesBid: yesOrderBook.bestBid,
        yesAsk: yesOrderBook.bestAsk,
        noBid: noOrderBook.bestBid,
        noAsk: noOrderBook.bestAsk,
        yesBidSize: yesOrderBook.bestBidSize,
        yesAskSize: yesOrderBook.bestAskSize,
        noBidSize: noOrderBook.bestBidSize,
        noAskSize: noOrderBook.bestAskSize,
        yesLastTrade: yesOrderBook.lastTradePrice,
        noLastTrade: noOrderBook.lastTradePrice,
        yesSpread: yesOrderBook.spread,
        noSpread: noOrderBook.spread,
        theoreticalYes: yesPricing.price,
        theoreticalNo,
        interpolatedIV: yesPricing.iv,
        confidence: yesPricing.confidence,
        yesEdge,
        noEdge,
        bestEdge,
        hasOpportunity,
        yesHasLiquidity: yesOrderBook.hasAsks,
        noHasLiquidity: noOrderBook.hasAsks,
      };
    } catch (err) {
      warn('ScannerService', `Error scanning market ${market.marketId}:`, err);
      return null;
    }
  }

  /**
   * Fetch order book for a token from Polymarket CLOB API.
   *
   * @param tokenId - Asset ID (YES or NO token)
   * @returns Order book data with best bid/ask and sizes
   */
  private async fetchOrderBook(tokenId: string): Promise<OrderBookData | null> {
    try {
      const url = `${CLOB_HOST}/book?token_id=${encodeURIComponent(tokenId)}`;
      const response = await fetch(url, { cache: 'no-store' });

      if (!response.ok) {
        throw new Error(`CLOB order book API failed: ${response.status}`);
      }

      const data = await response.json() as {
        bids: Array<{ price: string; size: string }>;
        asks: Array<{ price: string; size: string }>;
        last_trade_price?: string;
      };

      const { bids, asks, last_trade_price } = data;

      // Extract best bid/ask and sizes, tracking whether liquidity exists
      // IMPORTANT: CLOB returns bids sorted ascending (worst to best) and asks sorted descending (worst to best)
      // So best bid = last bid (highest), best ask = last ask (lowest)
      const hasAsks = asks.length > 0;
      const hasBids = bids.length > 0;
      const bestBid = hasBids ? parseFloat(bids[bids.length - 1].price) : 0;
      const bestAsk = hasAsks ? parseFloat(asks[asks.length - 1].price) : 1;
      const bestBidSize = hasBids ? parseFloat(bids[bids.length - 1].size) : 0;
      const bestAskSize = hasAsks ? parseFloat(asks[asks.length - 1].size) : 0;

      // Parse last trade price if available
      const lastTradePrice = last_trade_price ? parseFloat(last_trade_price) : null;

      // Calculate mid-price and spread
      const midPrice = (bestBid + bestAsk) / 2;
      const spread = bestAsk - bestBid;

      return {
        bestBid,
        bestAsk,
        bestBidSize,
        bestAskSize,
        hasAsks,
        hasBids,
        lastTradePrice,
        midPrice,
        spread,
      };
    } catch (err) {
      warn('ScannerService', `Failed to fetch order book for token ${tokenId}:`, err);
      return null;
    }
  }
}
