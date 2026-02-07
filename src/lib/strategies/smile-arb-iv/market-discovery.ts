/**
 * Market Discovery
 *
 * Discovers Polymarket markets matching criteria for IV smile arbitrage.
 * Supports auto-scan via search patterns or manual market ID specification.
 */

import { parseSettlementTime } from './settlement-time';
import { getGammaClient } from '@/lib/polymarket';
import { createLogger } from '@/lib/logger';

const logger = createLogger('MarketDiscovery');

// ============================================================================
// Types
// ============================================================================

export interface DiscoveredMarket {
  marketId: string;
  question: string;
  strike: number;
  settlementDate: Date | null;
  yesToken: string;
  noToken: string;
}

export interface DiscoveryOptions {
  mode: 'auto-scan' | 'manual';
  searchPattern?: string;
  manualMarketIds?: string[];
  settlementDate?: string;
}

interface CacheEntry {
  markets: DiscoveredMarket[];
  timestamp: number;
  optionsKey: string;
}

// ============================================================================
// Constants
// ============================================================================

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Market Discovery
// ============================================================================

export class MarketDiscovery {
  private cache: CacheEntry | null = null;

  constructor() {
    this.cache = null;
  }

  /**
   * Main entry point for market discovery.
   * Returns markets matching the specified options.
   */
  async discoverMarkets(options: DiscoveryOptions): Promise<DiscoveredMarket[]> {
    const optionsKey = this.createOptionsKey(options);

    // Check cache validity
    if (this.cache && this.cache.optionsKey === optionsKey) {
      const age = Date.now() - this.cache.timestamp;
      if (age < CACHE_TTL_MS) {
        return this.cache.markets;
      }
    }

    let markets: DiscoveredMarket[];

    if (options.mode === 'auto-scan') {
      if (!options.searchPattern) {
        throw new Error('searchPattern is required for auto-scan mode');
      }
      markets = await this.searchMarkets(options.searchPattern);
    } else {
      if (!options.manualMarketIds || options.manualMarketIds.length === 0) {
        throw new Error('manualMarketIds are required for manual mode');
      }
      markets = await this.fetchManualMarkets(options.manualMarketIds);
    }

    // Filter by settlement date if provided
    if (options.settlementDate) {
      markets = this.filterValidMarkets(markets, options.settlementDate);
    }

    // Update cache
    this.cache = {
      markets,
      timestamp: Date.now(),
      optionsKey,
    };

    return markets;
  }

  /**
   * Search markets via Gamma SDK using a pattern.
   * Returns markets with clobTokenIds from the search results directly.
   */
  async searchMarkets(pattern: string): Promise<DiscoveredMarket[]> {
    const gamma = getGammaClient();

    const searchResults = await gamma.search({
      q: pattern,
      limit_per_type: 50,
      events_status: 'active',
    });

    if (!searchResults.events || !Array.isArray(searchResults.events)) {
      return [];
    }

    const markets: DiscoveredMarket[] = [];

    for (const event of searchResults.events) {
      if (!event.markets || !Array.isArray(event.markets)) continue;

      for (const market of event.markets) {
        const parsed = this.parseMarketDetails({
          id: market.id || market.conditionId,
          question: market.question || event.title,
          clobTokenIds: market.clobTokenIds,
          active: market.active ?? true,
        });

        if (parsed) {
          markets.push(parsed);
        }
      }
    }

    return markets;
  }

  /**
   * Fetch specific markets by ID via Gamma SDK.
   */
  async fetchManualMarkets(marketIds: string[]): Promise<DiscoveredMarket[]> {
    const gamma = getGammaClient();
    const markets: DiscoveredMarket[] = [];

    const fetchPromises = marketIds.map(async (id) => {
      try {
        const market = await gamma.getMarketById(id as unknown as number);
        if (!market) return null;

        return this.parseMarketDetails({
          id: market.id,
          question: market.question,
          clobTokenIds: market.clobTokenIds,
          active: market.active ?? true,
        });
      } catch {
        return null;
      }
    });

    const results = await Promise.all(fetchPromises);

    for (const result of results) {
      if (result) {
        markets.push(result);
      }
    }

    return markets;
  }

  /**
   * Extract strike price from question text.
   * Handles formats: "$100,000", "$100k", "$100K", "$99,999.99"
   */
  parseStrike(question: string): number | null {
    // Match price patterns: $100,000 or $100k or $100K or $99,999.99
    const pricePatterns = [
      // $100,000 or $100,000.00 (with commas)
      /\$([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/,
      // $100000 or $100000.00 (without commas)
      /\$([0-9]+(?:\.[0-9]{2})?)/,
      // $100k or $100K or $100.5k
      /\$([0-9]+(?:\.[0-9]+)?)[kK]/,
    ];

    for (const pattern of pricePatterns) {
      const match = question.match(pattern);
      if (match) {
        let value = match[1];

        // Check if this is a "k" notation
        if (pattern.source.includes('[kK]')) {
          // Remove commas and parse
          const numValue = parseFloat(value.replace(/,/g, ''));
          return numValue * 1000;
        }

        // Remove commas and parse
        value = value.replace(/,/g, '');
        const numValue = parseFloat(value);

        if (!isNaN(numValue)) {
          return numValue;
        }
      }
    }

    return null;
  }

  /**
   * Filter markets to those matching the target settlement date.
   */
  filterValidMarkets(
    markets: DiscoveredMarket[],
    settlementDate: string
  ): DiscoveredMarket[] {
    // Parse target date as YYYY-MM-DD components directly to avoid timezone issues
    const [targetYear, targetMonth, targetDay] = settlementDate.split('-').map(Number);

    const filtered = markets.filter((market) => {
      if (!market.settlementDate) {
        return false;
      }

      // Use UTC methods (createETDate produces UTC timestamps: noon ET = 17:00 UTC)
      const marketYear = market.settlementDate.getUTCFullYear();
      const marketMonth = market.settlementDate.getUTCMonth() + 1; // getUTCMonth() is 0-indexed
      const marketDay = market.settlementDate.getUTCDate();

      return (
        marketYear === targetYear &&
        marketMonth === targetMonth &&
        marketDay === targetDay
      );
    });

    logger.log(`Settlement date filter: ${markets.length} -> ${filtered.length} markets match ${settlementDate}`);

    return filtered;
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private parseMarketDetails(market: {
    id: string;
    question: string;
    clobTokenIds?: string | string[];
    active?: boolean;
  }): DiscoveredMarket | null {
    const strike = this.parseStrike(market.question);

    // Skip markets without a parseable strike
    if (strike === null) {
      return null;
    }

    const settlementDate = parseSettlementTime(market.question);

    // Extract token IDs (YES is first, NO is second in clobTokenIds array)
    // Gamma API returns clobTokenIds as a stringified JSON array
    let tokenIds: string[] = [];
    if (typeof market.clobTokenIds === 'string') {
      try {
        tokenIds = JSON.parse(market.clobTokenIds);
      } catch {
        tokenIds = [];
      }
    } else if (Array.isArray(market.clobTokenIds)) {
      tokenIds = market.clobTokenIds;
    }

    const yesToken = tokenIds[0] ?? '';
    const noToken = tokenIds[1] ?? '';

    // Skip markets without token IDs (can't trade without them)
    if (!yesToken || !noToken) {
      return null;
    }

    return {
      marketId: market.id,
      question: market.question,
      strike,
      settlementDate,
      yesToken,
      noToken,
    };
  }

  private createOptionsKey(options: DiscoveryOptions): string {
    return JSON.stringify({
      mode: options.mode,
      searchPattern: options.searchPattern,
      manualMarketIds: options.manualMarketIds,
      settlementDate: options.settlementDate,
    });
  }
}
