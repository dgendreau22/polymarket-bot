/**
 * Data Recorder
 *
 * Records market data from Bitcoin 15-minute prediction markets for analysis.
 * Discovers upcoming markets, connects via WebSocket, and saves ticks/snapshots.
 */

import { getGammaClient } from '@/lib/polymarket/client';
import { PolymarketWebSocket } from '@/lib/polymarket/websocket';
import type { Market, OrderBook, LastTrade } from '@/lib/polymarket/types';
import { getETOffsetMinutes, formatTime12Hour } from '@/lib/utils/time';
import {
  createRecordingSession,
  saveTick,
  saveSnapshot,
  updateSessionStats,
  getRecordingSessionByEventSlug,
  incrementTickCount,
  incrementSnapshotCount,
  endSessionByEventSlug,
} from '@/lib/persistence/DataRepository';
import type {
  RecorderStatus,
  RecorderState,
  RecorderEvent,
  RecorderEventHandler,
  CurrentSession,
} from './types';

const BITCOIN_15MIN_SLUG_PREFIX = 'will-bitcoin-go-up-or-down-in-the-next-15-minutes';
const SNAPSHOT_INTERVAL_MS = 2000; // 2 seconds (high-resolution for accurate backtesting)
const MARKET_DISCOVERY_INTERVAL_MS = 30000; // 30 seconds

export class DataRecorder {
  private state: RecorderState = 'idle';
  private currentSession: CurrentSession | null = null;
  private error: string | null = null;

  private ws: PolymarketWebSocket | null = null;
  private discoveryTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private sessionEndTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private eventHandlers: Set<RecorderEventHandler> = new Set();

  // Current market data for snapshots
  private yesOrderBook: OrderBook | null = null;
  private noOrderBook: OrderBook | null = null;
  private yesAssetId: string | null = null;
  private noAssetId: string | null = null;
  private tickCount = 0;
  private snapshotCount = 0;

  /**
   * Get current recorder status
   */
  getStatus(): RecorderStatus {
    return {
      state: this.state,
      currentSession: this.currentSession ?? undefined,
      error: this.error ?? undefined,
    };
  }

  /**
   * Subscribe to recorder events
   */
  onEvent(handler: RecorderEventHandler): void {
    this.eventHandlers.add(handler);
  }

  /**
   * Unsubscribe from recorder events
   */
  offEvent(handler: RecorderEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  /**
   * Start the recorder
   */
  async start(): Promise<void> {
    if (this.state === 'recording' || this.state === 'discovering') {
      return;
    }

    this.setState('discovering');
    this.error = null;

    // Start market discovery loop
    await this.discoverAndRecord();
    this.discoveryTimer = setInterval(() => {
      if (this.state === 'discovering') {
        this.discoverAndRecord().catch((err) => {
          console.error('[DataRecorder] Discovery error:', err);
        });
      }
    }, MARKET_DISCOVERY_INTERVAL_MS);
  }

  /**
   * Stop the recorder
   */
  async stop(): Promise<void> {
    // Clear timers
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
    }
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }

    // Clear all session end timers
    for (const timer of this.sessionEndTimers.values()) {
      clearTimeout(timer);
    }
    this.sessionEndTimers.clear();

    // Disconnect WebSocket
    if (this.ws) {
      this.ws.disconnect();
      this.ws = null;
    }

    // End current session if any
    if (this.currentSession) {
      this.endSession();
    }

    this.setState('idle');
  }

  /**
   * End recording for a specific market by event slug
   * Called by Orchestrator when bot stops (market closes)
   */
  endRecordingForMarket(eventSlug: string): void {
    console.log(`[DataRecorder] Ending session for ${eventSlug}`);
    endSessionByEventSlug(eventSlug);

    // If this was the current session, clean up
    if (this.currentSession) {
      // Check if current session matches this event slug by comparing timestamps
      const currentEventSlug = `btc-updown-15m-${Math.floor(new Date(this.currentSession.startTime).getTime() / 1000)}`;
      if (currentEventSlug === eventSlug) {
        this.endSession();
        this.setState('idle');
      }
    }
  }

  /**
   * Start recording for a specific market with explicit time boundaries
   * Called by Orchestrator to align recording with market open/close times
   */
  async startRecordingForMarket(
    market: {
      marketId: string;
      marketName: string;
      eventSlug: string;
      yesAssetId: string;
      noAssetId: string;
    },
    startTime: Date,
    endTime: Date
  ): Promise<void> {
    // Check if already recording this market
    if (this.state === 'recording' && this.currentSession?.marketId === market.marketId) {
      console.log(`[DataRecorder] Already recording market ${market.marketId}`);
      return;
    }

    // Check if session already exists (avoid duplicate recording)
    const existing = getRecordingSessionByEventSlug(market.eventSlug);
    if (existing) {
      console.log(`[DataRecorder] Session already exists for ${market.eventSlug}`);
      return;
    }

    // Create recording session with market's official start time
    const session = createRecordingSession({
      marketId: market.marketId,
      marketName: market.marketName,
      eventSlug: market.eventSlug,
      yesAssetId: market.yesAssetId,
      noAssetId: market.noAssetId,
      startTime: startTime.toISOString(),  // Use market start, not now()
      endTime: endTime.toISOString(),
    });

    this.currentSession = {
      id: session.id,
      marketId: market.marketId,
      marketName: market.marketName,
      tickCount: 0,
      snapshotCount: 0,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    };

    this.tickCount = 0;
    this.snapshotCount = 0;
    this.yesOrderBook = null;
    this.noOrderBook = null;
    this.yesAssetId = market.yesAssetId;
    this.noAssetId = market.noAssetId;

    this.setState('recording');
    this.emitEvent({
      type: 'SESSION_STARTED',
      sessionId: session.id,
      marketId: market.marketId,
      marketName: market.marketName,
      timestamp: new Date().toISOString(),
    });

    // Connect WebSocket and subscribe to market data
    this.ws = new PolymarketWebSocket();
    await this.ws.connect();

    // Subscribe to order book updates for snapshots (combined subscription for sync)
    this.ws.subscribeOrderBook([market.yesAssetId, market.noAssetId], (orderBook) => {
      if (orderBook.asset_id === market.yesAssetId) {
        this.yesOrderBook = orderBook;
      } else if (orderBook.asset_id === market.noAssetId) {
        this.noOrderBook = orderBook;
      }
    });

    // Subscribe to trades for ticks (combined subscription for sync)
    this.ws.subscribeTrades([market.yesAssetId, market.noAssetId], (trade) => {
      const outcome = trade.asset_id === market.yesAssetId ? 'YES' : 'NO';
      this.recordTick(trade, outcome);
    });

    // Start snapshot timer
    this.snapshotTimer = setInterval(() => {
      this.saveSnapshotData();
    }, SNAPSHOT_INTERVAL_MS);

    // Schedule session end at exact market end time (sharp cutoff)
    const msUntilEnd = endTime.getTime() - Date.now();
    if (msUntilEnd > 0) {
      const timer = setTimeout(() => {
        this.sessionEndTimers.delete(market.eventSlug);
        this.endRecordingForMarket(market.eventSlug);
      }, msUntilEnd);
      this.sessionEndTimers.set(market.eventSlug, timer);
    }

    console.log(`[DataRecorder] Recording started for ${market.marketName}`);
    console.log(`[DataRecorder] Session ends at ${endTime.toISOString()} (sharp cutoff)`);
  }

  /**
   * Discover upcoming Bitcoin 15-min markets and start recording
   */
  private async discoverAndRecord(): Promise<void> {
    try {
      const market = await this.findUpcomingMarket();
      if (market) {
        await this.startRecording(market);
      }
    } catch (err) {
      console.error('[DataRecorder] Failed to discover market:', err);
      this.emitError(err instanceof Error ? err.message : 'Discovery failed');
    }
  }

  /**
   * Find the next upcoming Bitcoin 15-minute market
   * Uses the same timestamp-based slug lookup as the Orchestrator
   */
  private async findUpcomingMarket(): Promise<Market | null> {
    const gamma = getGammaClient();
    const now = new Date();
    const nowMs = now.getTime();
    const MIN_REMAINING_MS = 2 * 60 * 1000; // Need at least 2 minutes remaining

    console.log(`[DataRecorder] Searching for markets at ${now.toLocaleString()} (UTC: ${now.toISOString()})`);

    // Calculate the next few 15-minute slot timestamps
    const slotTimestamps = this.getUpcoming15MinSlots(now, 8); // Check next 8 slots (2 hours)

    for (const slotInfo of slotTimestamps) {
      const { timestamp, startTimeET, endTimeET } = slotInfo;
      const eventSlug = `btc-updown-15m-${timestamp}`;

      // Check if we're already recording this market
      if (this.currentSession?.marketId === eventSlug) {
        console.log(`[DataRecorder] Skipping slot ${startTimeET}: already recording`);
        continue;
      }

      // Check if we've already recorded this session
      const existing = getRecordingSessionByEventSlug(eventSlug);
      if (existing) {
        console.log(`[DataRecorder] Skipping slot ${startTimeET}: already recorded`);
        continue;
      }

      // Check if market has enough time remaining
      const endTimeMs = (timestamp + 15 * 60) * 1000; // 15 minutes after start
      const timeUntilEnd = endTimeMs - nowMs;
      if (timeUntilEnd < MIN_REMAINING_MS) {
        console.log(`[DataRecorder] Skipping slot ${startTimeET}: ends in ${Math.round(timeUntilEnd / 1000)}s`);
        continue;
      }

      try {
        console.log(`[DataRecorder] Trying event slug: ${eventSlug} (${startTimeET}-${endTimeET} ET)`);
        const event = await gamma.getEventBySlug(eventSlug);

        if (event && event.markets && event.markets.length > 0) {
          const market = event.markets[0] as Market;
          const marketId = String(market.id || market.conditionId || '');
          const marketName = market.question || `Bitcoin Up or Down - ${startTimeET}-${endTimeET} ET`;

          console.log(`[DataRecorder] Found market: ${marketName}`);
          console.log(`  -> Market ID: ${marketId}`);

          // Build a market object compatible with existing code
          return {
            ...market,
            id: marketId,
            question: marketName,
            slug: eventSlug,
            endDateIso: new Date((timestamp + 15 * 60) * 1000).toISOString(),
            endDate: new Date((timestamp + 15 * 60) * 1000).toISOString(),
            active: true,
            closed: false,
          } as Market;
        } else {
          console.log(`[DataRecorder] No market found for slug: ${eventSlug}`);
        }
      } catch (err) {
        // Event doesn't exist yet, try next slot
        console.log(`[DataRecorder] Event not found: ${eventSlug}`);
      }
    }

    console.log('[DataRecorder] No upcoming 15-min markets found in next 2 hours');
    return null;
  }

  /**
   * Get upcoming 15-minute slot timestamps
   * Returns Unix timestamps (in seconds) for upcoming market slots
   */
  private getUpcoming15MinSlots(now: Date, count: number): Array<{
    timestamp: number;
    startTimeET: string;
    endTimeET: string;
  }> {
    const slots: Array<{ timestamp: number; startTimeET: string; endTimeET: string }> = [];

    // Get current time in ET
    const etOffsetMs = getETOffsetMinutes(now) * 60 * 1000;

    // Current UTC time
    const nowUtcMs = now.getTime();

    // Current ET time (as if it were UTC, for calculation purposes)
    const nowEtMs = nowUtcMs - etOffsetMs;
    const nowEt = new Date(nowEtMs);

    // Round down to the current 15-minute slot in ET
    const etMinutes = nowEt.getUTCMinutes();
    const slotMinutes = Math.floor(etMinutes / 15) * 15;
    const currentSlotEt = new Date(nowEt);
    currentSlotEt.setUTCMinutes(slotMinutes, 0, 0);

    // Generate upcoming slots
    for (let i = 0; i < count; i++) {
      const slotEt = new Date(currentSlotEt.getTime() + i * 15 * 60 * 1000);

      // Convert back to UTC for the timestamp
      const slotUtcMs = slotEt.getTime() + etOffsetMs;
      const timestamp = Math.floor(slotUtcMs / 1000);

      // Format ET times for display
      const startHour = slotEt.getUTCHours();
      const startMin = slotEt.getUTCMinutes();
      const endSlotEt = new Date(slotEt.getTime() + 15 * 60 * 1000);
      const endHour = endSlotEt.getUTCHours();
      const endMin = endSlotEt.getUTCMinutes();

      slots.push({
        timestamp,
        startTimeET: formatTime12Hour(startHour, startMin),
        endTimeET: formatTime12Hour(endHour, endMin),
      });
    }

    return slots;
  }

  /**
   * Start recording a market
   */
  private async startRecording(market: Market): Promise<void> {
    const endDate = new Date(market.endDateIso || market.endDate);
    const startTime = new Date();
    const eventSlug = market.slug || market.id;

    // Get asset IDs (YES and NO tokens)
    const [yesAssetId, noAssetId] = market.clobTokenIds || [];
    if (!yesAssetId || !noAssetId) {
      console.error('[DataRecorder] Market missing asset IDs');
      return;
    }

    // Create recording session
    const session = createRecordingSession({
      marketId: market.id,
      marketName: market.question,
      eventSlug,
      yesAssetId,
      noAssetId,
      startTime: startTime.toISOString(),
      endTime: endDate.toISOString(),
    });

    this.currentSession = {
      id: session.id,
      marketId: market.id,
      marketName: market.question,
      tickCount: 0,
      snapshotCount: 0,
      startTime: startTime.toISOString(),
      endTime: endDate.toISOString(),
    };

    this.tickCount = 0;
    this.snapshotCount = 0;
    this.yesOrderBook = null;
    this.noOrderBook = null;
    this.yesAssetId = yesAssetId;
    this.noAssetId = noAssetId;

    this.setState('recording');
    this.emitEvent({
      type: 'SESSION_STARTED',
      sessionId: session.id,
      marketId: market.id,
      marketName: market.question,
      timestamp: new Date().toISOString(),
    });

    // Connect WebSocket and subscribe to market data
    this.ws = new PolymarketWebSocket();
    await this.ws.connect();

    // Subscribe to order book updates for snapshots (combined subscription for sync)
    this.ws.subscribeOrderBook([yesAssetId, noAssetId], (orderBook) => {
      if (orderBook.asset_id === yesAssetId) {
        this.yesOrderBook = orderBook;
      } else if (orderBook.asset_id === noAssetId) {
        this.noOrderBook = orderBook;
      }
    });

    // Subscribe to trades for ticks (combined subscription for sync)
    this.ws.subscribeTrades([yesAssetId, noAssetId], (trade) => {
      const outcome = trade.asset_id === yesAssetId ? 'YES' : 'NO';
      this.recordTick(trade, outcome);
    });

    // Start snapshot timer
    this.snapshotTimer = setInterval(() => {
      this.saveSnapshotData();
    }, SNAPSHOT_INTERVAL_MS);

    // Schedule session end
    const msUntilEnd = endDate.getTime() - Date.now();
    if (msUntilEnd > 0) {
      setTimeout(() => {
        this.endSession();
        this.setState('discovering');
      }, msUntilEnd + 5000); // Add 5 seconds buffer
    }

    console.log(`[DataRecorder] Recording started for ${market.question}`);
    console.log(`[DataRecorder] Session ends at ${endDate.toISOString()}`);
  }

  /**
   * Record a trade tick
   */
  private recordTick(trade: LastTrade, outcome: 'YES' | 'NO'): void {
    if (!this.currentSession) return;

    saveTick({
      sessionId: this.currentSession.id,
      assetId: trade.asset_id,
      outcome,
      timestamp: trade.timestamp,
      price: trade.price,
      size: trade.size,
      side: trade.side,
    });

    incrementTickCount(this.currentSession.id);
    this.tickCount++;
    this.currentSession.tickCount = this.tickCount;

    this.emitEvent({
      type: 'TICK_RECORDED',
      outcome,
      price: trade.price,
      size: trade.size,
      side: trade.side,
      timestamp: trade.timestamp,
    });
  }

  /**
   * Save order book snapshot
   */
  private saveSnapshotData(): void {
    if (!this.currentSession) return;

    const timestamp = new Date().toISOString();

    // Sort bids descending (highest first = best bid)
    const sortedYesBids = [...(this.yesOrderBook?.bids || [])].sort(
      (a, b) => parseFloat(b.price) - parseFloat(a.price)
    );
    const sortedNoBids = [...(this.noOrderBook?.bids || [])].sort(
      (a, b) => parseFloat(b.price) - parseFloat(a.price)
    );

    // Sort asks ascending (lowest first = best ask)
    const sortedYesAsks = [...(this.yesOrderBook?.asks || [])].sort(
      (a, b) => parseFloat(a.price) - parseFloat(b.price)
    );
    const sortedNoAsks = [...(this.noOrderBook?.asks || [])].sort(
      (a, b) => parseFloat(a.price) - parseFloat(b.price)
    );

    // Extract best bid/ask from sorted order books
    const yesBestBid = sortedYesBids[0]?.price;
    const yesBestAsk = sortedYesAsks[0]?.price;
    const noBestBid = sortedNoBids[0]?.price;
    const noBestAsk = sortedNoAsks[0]?.price;

    // Calculate combined cost (YES ask + NO ask)
    let combinedCost: string | undefined;
    if (yesBestAsk && noBestAsk) {
      combinedCost = (parseFloat(yesBestAsk) + parseFloat(noBestAsk)).toFixed(4);
    }

    // Calculate spread
    let spread: string | undefined;
    if (yesBestBid && yesBestAsk) {
      spread = (parseFloat(yesBestAsk) - parseFloat(yesBestBid)).toFixed(4);
    }

    saveSnapshot({
      sessionId: this.currentSession.id,
      timestamp,
      yesBestBid,
      yesBestAsk,
      noBestBid,
      noBestAsk,
      yesBidDepth: sortedYesBids.slice(0, 5).map((b) => `${b.price}:${b.size}`),
      yesAskDepth: sortedYesAsks.slice(0, 5).map((a) => `${a.price}:${a.size}`),
      noBidDepth: sortedNoBids.slice(0, 5).map((b) => `${b.price}:${b.size}`),
      noAskDepth: sortedNoAsks.slice(0, 5).map((a) => `${a.price}:${a.size}`),
      combinedCost,
      spread,
    });

    incrementSnapshotCount(this.currentSession.id);
    this.snapshotCount++;
    this.currentSession.snapshotCount = this.snapshotCount;

    this.emitEvent({
      type: 'SNAPSHOT_SAVED',
      combinedCost,
      spread,
      timestamp,
    });
  }

  /**
   * End current recording session
   */
  private endSession(): void {
    if (!this.currentSession) return;

    // Update session with final stats
    updateSessionStats(this.currentSession.id, {
      tickCount: this.tickCount,
      snapshotCount: this.snapshotCount,
      endedAt: new Date().toISOString(),
    });

    // Stop snapshot timer
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }

    // Disconnect WebSocket
    if (this.ws) {
      this.ws.disconnect();
      this.ws = null;
    }

    this.emitEvent({
      type: 'SESSION_ENDED',
      sessionId: this.currentSession.id,
      tickCount: this.tickCount,
      snapshotCount: this.snapshotCount,
      timestamp: new Date().toISOString(),
    });

    console.log(
      `[DataRecorder] Session ended: ${this.tickCount} ticks, ${this.snapshotCount} snapshots`
    );

    this.currentSession = null;
    this.tickCount = 0;
    this.snapshotCount = 0;
    this.yesOrderBook = null;
    this.noOrderBook = null;
    this.yesAssetId = null;
    this.noAssetId = null;
  }

  /**
   * Set state and emit event
   */
  private setState(newState: RecorderState): void {
    const previousState = this.state;
    this.state = newState;

    this.emitEvent({
      type: 'STATE_CHANGED',
      state: newState,
      previousState,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit an error event
   */
  private emitError(message: string): void {
    this.error = message;
    this.emitEvent({
      type: 'ERROR',
      error: message,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit event to all handlers
   */
  private emitEvent(event: RecorderEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error('[DataRecorder] Event handler error:', err);
      }
    }
  }
}

// Singleton instance
const globalForRecorder = globalThis as unknown as {
  dataRecorder: DataRecorder | undefined;
};

export function getDataRecorder(): DataRecorder {
  if (!globalForRecorder.dataRecorder) {
    globalForRecorder.dataRecorder = new DataRecorder();
  }
  return globalForRecorder.dataRecorder;
}
