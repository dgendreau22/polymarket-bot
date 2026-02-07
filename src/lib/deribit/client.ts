/**
 * Deribit API Client
 *
 * Singleton client for fetching BTC options IV data from Deribit.
 * Provides caching and retry logic for reliability.
 */

import type {
  DeribitInstrument,
  DeribitTicker,
  IVSnapshot,
  StrikeIV,
  ExpiryData,
} from "./types";
import { log, warn, error, createLogger } from "@/lib/logger";

const logger = createLogger("Deribit");

const API_BASE = "https://www.deribit.com/api/v2/public";
const CACHE_TTL_MS = 60_000; // 60 seconds (extended for rate limiting)
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

/**
 * Options for IV snapshot filtering
 */
export interface IVSnapshotOptions {
  /** Minimum strike price to include */
  minStrike?: number;
  /** Maximum strike price to include */
  maxStrike?: number;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

interface DeribitApiResponse<T> {
  jsonrpc: string;
  id: number;
  result: T;
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Singleton Deribit API client with caching and retry logic
 */
export class DeribitClient {
  private static instance: DeribitClient | null = null;

  private instrumentsCache: CacheEntry<DeribitInstrument[]> | null = null;
  private tickerCache: Map<string, CacheEntry<DeribitTicker>> = new Map();
  private ivSnapshotCache: CacheEntry<IVSnapshot> | null = null;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): DeribitClient {
    if (!DeribitClient.instance) {
      DeribitClient.instance = new DeribitClient();
    }
    return DeribitClient.instance;
  }

  /**
   * Check if cache entry is still valid
   */
  private isCacheValid<T>(entry: CacheEntry<T> | null | undefined): entry is CacheEntry<T> {
    if (!entry) return false;
    return Date.now() - entry.timestamp < CACHE_TTL_MS;
  }

  /**
   * Fetch with retry logic and exponential backoff
   */
  private async fetchWithRetry<T>(url: string): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data: DeribitApiResponse<T> = await response.json();

        if (data.error) {
          throw new Error(`Deribit API error: ${data.error.message}`);
        }

        return data.result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < MAX_RETRIES - 1) {
          const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
          warn("Deribit", `Request failed, retrying in ${delay}ms`, {
            attempt: attempt + 1,
            error: lastError.message,
          });
          await this.sleep(delay);
        }
      }
    }

    throw lastError ?? new Error("Request failed after retries");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Fetch all BTC option instruments from Deribit
   */
  async getInstruments(): Promise<DeribitInstrument[]> {
    if (this.isCacheValid(this.instrumentsCache)) {
      return this.instrumentsCache.data;
    }

    try {
      const url = `${API_BASE}/get_instruments?currency=BTC&kind=option`;
      const instruments = await this.fetchWithRetry<DeribitInstrument[]>(url);

      this.instrumentsCache = {
        data: instruments,
        timestamp: Date.now(),
      };

      logger.log(`Fetched ${instruments.length} BTC option instruments`);
      return instruments;
    } catch (err) {
      if (this.instrumentsCache) {
        warn(
          "Deribit",
          "Failed to fetch instruments, returning stale cache",
          err
        );
        return this.instrumentsCache.data;
      }
      throw err;
    }
  }

  /**
   * Fetch ticker data for a single instrument
   */
  async getTicker(instrumentName: string): Promise<DeribitTicker> {
    const cached = this.tickerCache.get(instrumentName);
    if (this.isCacheValid(cached)) {
      return cached.data;
    }

    const url = `${API_BASE}/ticker?instrument_name=${encodeURIComponent(instrumentName)}`;
    const ticker = await this.fetchWithRetry<DeribitTicker>(url);

    this.tickerCache.set(instrumentName, {
      data: ticker,
      timestamp: Date.now(),
    });

    return ticker;
  }

  /**
   * Batch fetch tickers for multiple instruments
   * Note: Deribit doesn't have a bulk ticker endpoint, so we fetch in parallel
   */
  async getBulkTickers(instruments: string[]): Promise<Map<string, DeribitTicker>> {
    const results = new Map<string, DeribitTicker>();
    const uncachedInstruments: string[] = [];

    // Check cache first
    for (const name of instruments) {
      const cached = this.tickerCache.get(name);
      if (this.isCacheValid(cached)) {
        results.set(name, cached.data);
      } else {
        uncachedInstruments.push(name);
      }
    }

    if (uncachedInstruments.length === 0) {
      return results;
    }

    // Fetch uncached tickers in parallel batches
    const BATCH_SIZE = 20;
    for (let i = 0; i < uncachedInstruments.length; i += BATCH_SIZE) {
      const batch = uncachedInstruments.slice(i, i + BATCH_SIZE);
      const tickerPromises = batch.map(async (name) => {
        try {
          const ticker = await this.getTicker(name);
          return { name, ticker };
        } catch (err) {
          warn("Deribit", `Failed to fetch ticker for ${name}`, err);
          return null;
        }
      });

      const batchResults = await Promise.all(tickerPromises);

      for (const result of batchResults) {
        if (result) {
          results.set(result.name, result.ticker);
        }
      }
    }

    logger.log(`Fetched ${results.size} tickers`);
    return results;
  }

  /**
   * Build complete IV surface snapshot
   * @param targetDate - Target date to select relevant expiries (next 2 after this date)
   * @param options - Optional strike filtering options
   */
  async getIVSnapshot(targetDate?: Date, options: IVSnapshotOptions = {}): Promise<IVSnapshot> {
    // Create a cache key that includes strike filter range
    // Note: We use the base cache for unfiltered requests
    const hasStrikeFilter = options.minStrike !== undefined || options.maxStrike !== undefined;

    // Only use cache for unfiltered requests to avoid serving stale filtered data
    if (!hasStrikeFilter && this.isCacheValid(this.ivSnapshotCache)) {
      return this.ivSnapshotCache.data;
    }

    try {
      // Step 1: Fetch all instruments
      const instruments = await this.getInstruments();
      let activeInstruments = instruments.filter((i) => i.is_active);

      // Step 1.5: Filter by strike range if provided
      if (hasStrikeFilter) {
        const beforeCount = activeInstruments.length;
        activeInstruments = activeInstruments.filter((i) =>
          (options.minStrike === undefined || i.strike >= options.minStrike) &&
          (options.maxStrike === undefined || i.strike <= options.maxStrike)
        );
        logger.log(
          `Strike filter applied: ${beforeCount} -> ${activeInstruments.length} instruments (${options.minStrike?.toLocaleString()}-${options.maxStrike?.toLocaleString()})`
        );
      }

      // Step 2: Get unique expiries and filter to relevant ones
      const target = targetDate ?? new Date();
      const targetTimestamp = target.getTime();

      const expiryTimestamps = [
        ...new Set(activeInstruments.map((i) => i.expiration_timestamp)),
      ].sort((a, b) => a - b);

      // Find next 2 expiries after target date
      const relevantExpiries = expiryTimestamps
        .filter((ts) => ts > targetTimestamp)
        .slice(0, 2);

      if (relevantExpiries.length === 0) {
        throw new Error("No relevant expiries found after target date");
      }

      // Step 3: Filter instruments to relevant expiries
      const relevantInstruments = activeInstruments.filter((i) =>
        relevantExpiries.includes(i.expiration_timestamp)
      );

      logger.log(
        `Processing ${relevantInstruments.length} instruments across ${relevantExpiries.length} expiries`
      );

      // Step 4: Batch fetch tickers
      const instrumentNames = relevantInstruments.map((i) => i.instrument_name);
      const tickers = await this.getBulkTickers(instrumentNames);

      // Step 5: Build IV snapshot
      let underlyingPrice = 0;
      const expiryDataMap = new Map<number, ExpiryData>();

      for (const instrument of relevantInstruments) {
        const ticker = tickers.get(instrument.instrument_name);
        if (!ticker) continue;

        // Get underlying price from first available ticker
        if (underlyingPrice === 0 && ticker.underlying_price) {
          underlyingPrice = ticker.underlying_price;
        }

        // Get or create expiry data
        let expiryData = expiryDataMap.get(instrument.expiration_timestamp);
        if (!expiryData) {
          const expiryDate = new Date(instrument.expiration_timestamp);
          const timeToExpiryMs =
            instrument.expiration_timestamp - Date.now();
          const timeToExpiryYears =
            timeToExpiryMs / (365.25 * 24 * 60 * 60 * 1000);

          expiryData = {
            expiry_date: expiryDate.toISOString().split("T")[0],
            expiry_timestamp: instrument.expiration_timestamp,
            time_to_expiry_years: Math.max(0, timeToExpiryYears),
            strikes: [],
          };
          expiryDataMap.set(instrument.expiration_timestamp, expiryData);
        }

        // Find or create strike entry
        let strikeData = expiryData.strikes.find(
          (s) => s.strike === instrument.strike
        );
        if (!strikeData) {
          strikeData = {
            strike: instrument.strike,
            call_iv: null,
            put_iv: null,
            call_mark_iv: 0,
            put_mark_iv: 0,
          };
          expiryData.strikes.push(strikeData);
        }

        // Update strike with IV data
        if (instrument.option_type === "call") {
          strikeData.call_iv = ticker.bid_iv ?? ticker.ask_iv ?? ticker.mark_iv;
          strikeData.call_mark_iv = ticker.mark_iv;
        } else {
          strikeData.put_iv = ticker.bid_iv ?? ticker.ask_iv ?? ticker.mark_iv;
          strikeData.put_mark_iv = ticker.mark_iv;
        }
      }

      // Sort strikes within each expiry
      for (const expiryData of expiryDataMap.values()) {
        expiryData.strikes.sort((a, b) => a.strike - b.strike);
      }

      // Build final snapshot
      const snapshot: IVSnapshot = {
        underlying_price: underlyingPrice,
        timestamp: Date.now(),
        expiries: Array.from(expiryDataMap.values()).sort(
          (a, b) => a.expiry_timestamp - b.expiry_timestamp
        ),
      };

      // Only cache unfiltered snapshots
      if (!hasStrikeFilter) {
        this.ivSnapshotCache = {
          data: snapshot,
          timestamp: Date.now(),
        };
      }

      logger.log(
        `Built IV snapshot: underlying=${underlyingPrice}, expiries=${snapshot.expiries.length}${hasStrikeFilter ? ' (filtered)' : ''}`
      );

      return snapshot;
    } catch (err) {
      if (this.ivSnapshotCache) {
        warn(
          "Deribit",
          "Failed to build IV snapshot, returning stale cache",
          err
        );
        return this.ivSnapshotCache.data;
      }
      error("Deribit", "Failed to build IV snapshot", err);
      throw err;
    }
  }

  /**
   * Fetch BTC spot price from Deribit index
   * @returns Current BTC/USD index price
   */
  async getBTCSpotPrice(): Promise<number> {
    try {
      const url = `${API_BASE}/get_index_price?index_name=btc_usd`;
      const result = await this.fetchWithRetry<{ index_price: number }>(url);
      logger.log(`Fetched BTC spot price: $${result.index_price}`);
      return result.index_price;
    } catch (err) {
      error("Deribit", "Failed to fetch BTC spot price", err);
      throw err;
    }
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.instrumentsCache = null;
    this.tickerCache.clear();
    this.ivSnapshotCache = null;
    logger.log("Cache cleared");
  }
}
