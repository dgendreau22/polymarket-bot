/**
 * Bitcoin 15-Minute Market Orchestrator
 *
 * Singleton service that:
 * 1. Discovers next Bitcoin 15-min market on Polymarket
 * 2. Schedules bot creation 5 minutes before market start
 * 3. Manages continuous market cycling after each market closes
 */

import { getBotManager } from './BotManager';
import { getGammaClient } from '../polymarket/client';
import { getETOffsetMinutes, formatTime12Hour } from '../utils/time';
import type { BotConfig, BotMode, BotEvent } from './types';

// ============================================================================
// Types
// ============================================================================

/** Orchestrator lifecycle state */
export type OrchestratorState = 'idle' | 'searching' | 'scheduled' | 'active' | 'error';

/** Scheduled market info */
export interface ScheduledMarket {
  marketId: string;
  marketName: string;
  startTime: Date;
  endTime: Date;
  assetId?: string;
  noAssetId?: string;
}

/** Orchestrator configuration */
export interface OrchestratorConfig {
  strategy: string;
  mode: BotMode;
  strategyConfig?: Record<string, unknown>;
  leadTimeMinutes: number;
  enabled: boolean;
}

/** Bot info for display */
export interface OrchestratorBotInfo {
  botId: string;
  marketName: string;
  marketTimeWindow: string;
  state: 'running' | 'stopped' | 'paused';
  positionSize: number;
  pnl: number;
  createdAt: Date;
}

/** Orchestrator status for API responses */
export interface OrchestratorStatus {
  state: OrchestratorState;
  config: OrchestratorConfig;
  currentMarket: ScheduledMarket | null;
  scheduledStartTime: Date | null;
  currentBotId: string | null;
  botCount: number;
  lastError: string | null;
  /** Next scheduled market (shown even when a bot is active) */
  nextMarket: ScheduledMarket | null;
  /** When the next bot will be created */
  nextMarketStartTime: Date | null;
}

/** Orchestrator events for SSE */
export type OrchestratorEvent =
  | { type: 'STATE_CHANGED'; state: OrchestratorState; timestamp: Date }
  | { type: 'MARKET_FOUND'; market: ScheduledMarket; timestamp: Date }
  | { type: 'BOT_SCHEDULED'; botStartTime: Date; market: ScheduledMarket; timestamp: Date }
  | { type: 'BOT_CREATED'; botId: string; market: ScheduledMarket; timestamp: Date }
  | { type: 'CYCLE_COMPLETE'; botId: string; timestamp: Date }
  | { type: 'ERROR'; error: string; timestamp: Date };

export type OrchestratorEventHandler = (event: OrchestratorEvent) => void;

// ============================================================================
// Orchestrator Class
// ============================================================================

class Orchestrator {
  private state: OrchestratorState = 'idle';
  private config: OrchestratorConfig = {
    strategy: 'arbitrage',
    mode: 'dry_run',
    leadTimeMinutes: 5,
    enabled: false,
  };

  // Track the next scheduled market (waiting for bot start time)
  private nextScheduledMarket: ScheduledMarket | null = null;
  private nextScheduledStartTime: Date | null = null;
  private nextScheduledTimer: NodeJS.Timeout | null = null;

  // Track currently active/running market (bot is running)
  private activeMarket: ScheduledMarket | null = null;

  // Track all scheduled market IDs to avoid double-scheduling
  private scheduledMarketIds: Set<string> = new Set();

  // Track running bots
  private runningBotIds: Set<string> = new Set();

  private searchInterval: NodeJS.Timeout | null = null;
  private botHistory: OrchestratorBotInfo[] = [];
  private eventHandlers: OrchestratorEventHandler[] = [];
  private lastError: string | null = null;

  // Market discovery constants
  private readonly SEARCH_INTERVAL_MS = 30000; // Check for new markets every 30 seconds
  private readonly MIN_SEARCH_INTERVAL_MS = 5000; // Rate limit: 5 seconds between searches

  private lastSearchTime = 0;

  constructor() {}

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Start the orchestrator with given configuration
   */
  async start(config: Partial<OrchestratorConfig>): Promise<void> {
    if (this.config.enabled) {
      throw new Error('Orchestrator is already running');
    }

    this.config = { ...this.config, ...config, enabled: true };
    this.lastError = null;
    this.scheduledMarketIds.clear();
    this.runningBotIds.clear();
    this.setState('searching');

    console.log(`[Orchestrator] Starting with strategy=${this.config.strategy}, mode=${this.config.mode}, leadTime=${this.config.leadTimeMinutes}min`);

    // Begin market discovery
    await this.findAndScheduleNextMarket();

    // Set up continuous search interval to find and schedule upcoming markets
    this.searchInterval = setInterval(() => {
      if (this.config.enabled) {
        this.findAndScheduleNextMarket();
      }
    }, this.SEARCH_INTERVAL_MS);
  }

  /**
   * Stop the orchestrator
   */
  async stop(): Promise<void> {
    console.log('[Orchestrator] Stopping...');

    this.config.enabled = false;

    // Clear timers
    if (this.nextScheduledTimer) {
      clearTimeout(this.nextScheduledTimer);
      this.nextScheduledTimer = null;
    }
    if (this.searchInterval) {
      clearInterval(this.searchInterval);
      this.searchInterval = null;
    }

    this.nextScheduledMarket = null;
    this.nextScheduledStartTime = null;
    this.activeMarket = null;
    this.scheduledMarketIds.clear();
    this.setState('idle');

    console.log('[Orchestrator] Stopped');
  }

  /**
   * Get current orchestrator status
   */
  getStatus(): OrchestratorStatus {
    // Find the first running bot ID for display
    const runningBotId = this.runningBotIds.size > 0
      ? Array.from(this.runningBotIds)[0]
      : null;

    // Show active market if running, otherwise show next scheduled market
    const displayMarket = this.activeMarket || this.nextScheduledMarket;
    const displayStartTime = this.activeMarket ? null : this.nextScheduledStartTime;

    return {
      state: this.state,
      config: { ...this.config },
      currentMarket: displayMarket,
      scheduledStartTime: displayStartTime,
      currentBotId: runningBotId,
      botCount: this.botHistory.length,
      lastError: this.lastError,
      // Always provide next scheduled market info (even when active)
      nextMarket: this.nextScheduledMarket,
      nextMarketStartTime: this.nextScheduledStartTime,
    };
  }

  /**
   * Get bot history
   */
  getBotHistory(): OrchestratorBotInfo[] {
    return [...this.botHistory];
  }

  /**
   * Subscribe to orchestrator events
   */
  onEvent(handler: OrchestratorEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Unsubscribe from orchestrator events
   */
  offEvent(handler: OrchestratorEventHandler): void {
    const index = this.eventHandlers.indexOf(handler);
    if (index !== -1) {
      this.eventHandlers.splice(index, 1);
    }
  }

  // ============================================================================
  // Market Discovery
  // ============================================================================

  /**
   * Find next Bitcoin 15-min market and schedule bot
   */
  private async findAndScheduleNextMarket(): Promise<void> {
    // Don't search if we already have a market scheduled
    // We only schedule the next market after the current scheduled one starts
    if (this.nextScheduledMarket) {
      return;
    }

    // Rate limiting
    const now = Date.now();
    if (now - this.lastSearchTime < this.MIN_SEARCH_INTERVAL_MS) {
      return;
    }
    this.lastSearchTime = now;

    try {
      const market = await this.discoverNextMarket();

      if (market) {
        // Check if already scheduled (shouldn't happen but safety check)
        if (this.scheduledMarketIds.has(market.marketId)) {
          return;
        }

        console.log(`[Orchestrator] Found new market to schedule: ${market.marketName}`);
        console.log(`[Orchestrator] Market starts at: ${market.startTime.toLocaleString()}`);

        this.emitEvent({ type: 'MARKET_FOUND', market, timestamp: new Date() });
        await this.scheduleBot(market);
      } else if (this.runningBotIds.size === 0 && !this.nextScheduledMarket) {
        // Only show searching state if nothing is running or scheduled
        console.log('[Orchestrator] No upcoming market found, will retry...');
        this.setState('searching');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Orchestrator] Error finding market:', errorMsg);
      this.lastError = errorMsg;
      // Don't set error state if we have running bots - just log the error
      if (this.runningBotIds.size === 0) {
        this.setState('error');
        this.emitEvent({ type: 'ERROR', error: errorMsg, timestamp: new Date() });
      }
    }
  }

  /**
   * Discover next upcoming Bitcoin 15-min market
   * Uses direct event slug lookup based on calculated timestamps
   */
  private async discoverNextMarket(): Promise<ScheduledMarket | null> {
    const gamma = getGammaClient();
    const now = new Date();
    const nowMs = now.getTime();
    const MIN_REMAINING_MS = 2 * 60 * 1000; // Need at least 2 minutes remaining to join

    console.log(`[Orchestrator] Searching for markets at ${now.toLocaleString()} (UTC: ${now.toISOString()})`);

    // Calculate the next few 15-minute slot timestamps
    // Markets are at :00, :15, :30, :45 of each hour
    const slotTimestamps = this.getUpcoming15MinSlots(now, 8); // Check next 8 slots (2 hours)

    for (const slotInfo of slotTimestamps) {
      const { timestamp, startTimeET, endTimeET } = slotInfo;
      const eventSlug = `btc-updown-15m-${timestamp}`;

      // Skip if already scheduled
      if (this.scheduledMarketIds.has(eventSlug)) {
        console.log(`[Orchestrator] Skipping slot ${startTimeET}: already scheduled`);
        continue;
      }

      // Check if market has enough time remaining
      const endTimeMs = (timestamp + 15 * 60) * 1000; // 15 minutes after start
      const timeUntilEnd = endTimeMs - nowMs;
      if (timeUntilEnd < MIN_REMAINING_MS) {
        console.log(`[Orchestrator] Skipping slot ${startTimeET}: ends in ${Math.round(timeUntilEnd/1000)}s`);
        continue;
      }

      try {
        console.log(`[Orchestrator] Trying event slug: ${eventSlug} (${startTimeET}-${endTimeET} ET)`);
        const event = await gamma.getEventBySlug(eventSlug);

        if (event && event.markets && event.markets.length > 0) {
          const market = event.markets[0];
          const marketId = String(market.id || market.conditionId || '');
          const marketName = market.question || `Bitcoin Up or Down - ${startTimeET}-${endTimeET} ET`;
          const tokenIds = this.parseTokenIds(market.clobTokenIds);

          // Parse times from the slot
          const startTime = new Date(timestamp * 1000);
          const endTime = new Date((timestamp + 15 * 60) * 1000);

          console.log(`[Orchestrator] Found market: ${marketName}`);
          console.log(`  -> Market ID: ${marketId}`);
          console.log(`  -> Start: ${startTime.toLocaleString()} | End: ${endTime.toLocaleString()}`);

          // Track by event slug to avoid duplicate lookups
          this.scheduledMarketIds.add(eventSlug);

          return {
            marketId,
            marketName,
            startTime,
            endTime,
            assetId: tokenIds[0],
            noAssetId: tokenIds[1],
          };
        } else {
          console.log(`[Orchestrator] No market found for slug: ${eventSlug}`);
        }
      } catch (error) {
        // Event doesn't exist yet, try next slot
        console.log(`[Orchestrator] Event not found: ${eventSlug}`);
      }
    }

    console.log('[Orchestrator] No upcoming 15-min markets found in next 2 hours');
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
    // ET offset: EST (winter) = UTC-5, EDT (summer) = UTC-4
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

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Extract time window from market name for display
   * Input: "Bitcoin Up or Down - January 2, 2:30PM-2:45PM ET"
   * Output: "2:30PM-2:45PM"
   */
  private extractTimeWindow(name: string): string {
    const pattern = /(\d{1,2}:\d{2}(?:AM|PM)-\d{1,2}:\d{2}(?:AM|PM))/i;
    const match = name.match(pattern);
    return match ? match[1] : 'Unknown';
  }

  /**
   * Parse JSON token IDs array
   */
  private parseTokenIds(value: string | string[] | undefined): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
      return JSON.parse(value);
    } catch {
      return [];
    }
  }

  // ============================================================================
  // Bot Scheduling
  // ============================================================================

  /**
   * Schedule bot creation X minutes before market start
   */
  private async scheduleBot(market: ScheduledMarket): Promise<void> {
    // Mark this market as scheduled
    this.scheduledMarketIds.add(market.marketId);

    const now = new Date();
    const leadTimeMs = this.config.leadTimeMinutes * 60 * 1000;
    const botStartTime = new Date(market.startTime.getTime() - leadTimeMs);
    const delayMs = botStartTime.getTime() - now.getTime();

    if (delayMs <= 0) {
      // Bot start time has passed, create bot now
      console.log('[Orchestrator] Bot start time reached, creating bot immediately');
      await this.createBot(market);
      return;
    }

    // Track as the next scheduled market (for UI display)
    this.nextScheduledMarket = market;
    this.nextScheduledStartTime = botStartTime;

    // Update state based on whether we have running bots
    if (this.runningBotIds.size > 0) {
      this.setState('active'); // Show active if bots are running
    } else {
      this.setState('scheduled');
    }

    this.emitEvent({
      type: 'BOT_SCHEDULED',
      botStartTime,
      market,
      timestamp: new Date(),
    });

    const delaySeconds = Math.round(delayMs / 1000);
    const delayMinutes = Math.floor(delayMs / 60000);
    console.log(`[Orchestrator] Bot for ${this.extractTimeWindow(market.marketName)} scheduled to start at ${botStartTime.toLocaleString()} (in ${delayMinutes}m ${delaySeconds % 60}s)`);

    // Clear any existing timer before setting a new one
    if (this.nextScheduledTimer) {
      clearTimeout(this.nextScheduledTimer);
    }

    this.nextScheduledTimer = setTimeout(async () => {
      await this.createBot(market);
    }, delayMs);
  }

  /**
   * Create and start the bot
   */
  private async createBot(market: ScheduledMarket): Promise<void> {
    const botManager = getBotManager();

    // Create bot config
    const botConfig: Omit<BotConfig, 'id'> = {
      name: `BTC-15m-${this.extractTimeWindow(market.marketName)}`,
      strategySlug: this.config.strategy,
      marketId: market.marketId,
      marketName: market.marketName,
      assetId: market.assetId,
      noAssetId: this.config.strategy === 'arbitrage' ? market.noAssetId : undefined,
      mode: this.config.mode,
      strategyConfig: this.config.strategyConfig,
    };

    console.log(`[Orchestrator] Creating bot for market: ${market.marketName}`);

    // Create and start bot
    const botInstance = botManager.createBot(botConfig);
    const botId = botInstance.config.id;

    await botManager.startBot(botId);

    // Track running bot
    this.runningBotIds.add(botId);

    // Set this as the active market (for UI display)
    this.activeMarket = market;

    // Clear scheduled market tracking (this bot is now running)
    if (this.nextScheduledMarket?.marketId === market.marketId) {
      this.nextScheduledMarket = null;
      this.nextScheduledStartTime = null;
    }

    this.setState('active');
    this.emitEvent({
      type: 'BOT_CREATED',
      botId,
      market,
      timestamp: new Date(),
    });

    // Add to history
    this.botHistory.unshift({
      botId,
      marketName: market.marketName,
      marketTimeWindow: this.extractTimeWindow(market.marketName),
      state: 'running',
      positionSize: 0,
      pnl: 0,
      createdAt: new Date(),
    });

    // Keep history limited to last 50 bots
    if (this.botHistory.length > 50) {
      this.botHistory = this.botHistory.slice(0, 50);
    }

    console.log(`[Orchestrator] Bot created and started: ${botId}`);

    // Monitor for market close
    this.monitorBotForCycle(botId, market);

    // Immediately search for next market to schedule
    // This enables overlapping bots (next bot starts while current is running)
    if (this.config.enabled) {
      setTimeout(() => this.findAndScheduleNextMarket(), 1000);
    }
  }

  /**
   * Monitor bot and cycle to next market when done
   */
  private monitorBotForCycle(botId: string, market: ScheduledMarket): void {
    const botManager = getBotManager();
    const bot = botManager.getBotRaw(botId);

    if (!bot) {
      console.error(`[Orchestrator] Could not find bot ${botId} for monitoring`);
      return;
    }

    // Periodically update position/PnL while bot is running
    const updateInterval = setInterval(() => {
      this.updateBotHistoryStats(botId);
    }, 3000); // Update every 3 seconds

    // Listen for bot stop event (triggered by market close detection)
    const handler = (event: BotEvent) => {
      if (event.type === 'STOPPED') {
        bot.offEvent(handler);
        clearInterval(updateInterval);

        console.log(`[Orchestrator] Bot ${botId} stopped, updating history...`);

        // Remove from running bots
        this.runningBotIds.delete(botId);

        // Clear active market if this was the active one
        if (this.activeMarket?.marketId === market.marketId) {
          this.activeMarket = null;
        }

        // Final update of history
        const historyItem = this.botHistory.find(b => b.botId === botId);
        if (historyItem) {
          const botInstance = botManager.getBot(botId);
          if (botInstance) {
            historyItem.state = 'stopped';
            historyItem.positionSize = botInstance.totalPositionSize ?? parseFloat(botInstance.position.size);
            historyItem.pnl = parseFloat(botInstance.metrics.totalPnl);
          }
        }

        this.emitEvent({ type: 'CYCLE_COMPLETE', botId, timestamp: new Date() });

        // Update state based on remaining running bots and scheduled markets
        if (this.config.enabled) {
          if (this.runningBotIds.size > 0) {
            this.setState('active');
          } else if (this.nextScheduledMarket) {
            this.setState('scheduled');
          } else {
            this.setState('searching');
            // Trigger search for next market
            this.findAndScheduleNextMarket();
          }
        }
      }
    };

    bot.onEvent(handler);
  }

  /**
   * Update bot history stats (position, PnL) for a running bot
   */
  private updateBotHistoryStats(botId: string): void {
    const botManager = getBotManager();
    const historyItem = this.botHistory.find(b => b.botId === botId);
    if (!historyItem) return;

    const botInstance = botManager.getBot(botId);
    if (!botInstance) return;

    const newPositionSize = botInstance.totalPositionSize ?? parseFloat(botInstance.position.size);
    const newPnl = parseFloat(botInstance.metrics.totalPnl);

    // Only emit update if values changed
    if (historyItem.positionSize !== newPositionSize || historyItem.pnl !== newPnl) {
      historyItem.positionSize = newPositionSize;
      historyItem.pnl = newPnl;
      historyItem.state = botInstance.state;

      // Emit event so SSE clients get updated data
      this.emitEvent({
        type: 'STATE_CHANGED',
        state: this.state,
        timestamp: new Date(),
      });
    }
  }

  // ============================================================================
  // State Management
  // ============================================================================

  private setState(state: OrchestratorState): void {
    if (this.state !== state) {
      this.state = state;
      this.emitEvent({ type: 'STATE_CHANGED', state, timestamp: new Date() });
    }
  }

  private emitEvent(event: OrchestratorEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[Orchestrator] Event handler error:', error);
      }
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

// Use global to persist across Next.js hot reloads in development
const globalForOrchestrator = globalThis as unknown as {
  orchestrator: Orchestrator | undefined;
};

/**
 * Get the Orchestrator singleton
 */
export function getOrchestrator(): Orchestrator {
  if (!globalForOrchestrator.orchestrator) {
    globalForOrchestrator.orchestrator = new Orchestrator();
  }
  return globalForOrchestrator.orchestrator;
}

/**
 * Reset the Orchestrator (for testing)
 */
export function resetOrchestrator(): void {
  if (globalForOrchestrator.orchestrator) {
    globalForOrchestrator.orchestrator.stop().catch(console.error);
  }
  globalForOrchestrator.orchestrator = undefined;
}
