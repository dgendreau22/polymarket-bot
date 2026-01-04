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
  private readonly SEARCH_QUERY = 'Bitcoin Up or Down';
  private readonly MARKET_PATTERN = /Bitcoin Up or Down - (\w+ \d{1,2}), (\d{1,2}):(\d{2})(AM|PM)-(\d{1,2}):(\d{2})(AM|PM) ET/i;
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
   */
  private async discoverNextMarket(): Promise<ScheduledMarket | null> {
    const gamma = getGammaClient();

    // Search for Bitcoin up/down markets
    const results = await gamma.search({
      q: this.SEARCH_QUERY,
      limit_per_type: 50,
      events_status: 'active',
    });

    const now = new Date();
    const nowMs = now.getTime();
    const leadTimeMs = this.config.leadTimeMinutes * 60 * 1000;
    const MIN_REMAINING_MS = 2 * 60 * 1000; // Need at least 2 minutes remaining to join

    // Collect all valid candidate markets
    const candidates: Array<{
      market: ScheduledMarket;
      startTime: number;
    }> = [];

    // Find events with markets matching our pattern
    const events = (results as { events?: Array<{ markets?: Array<{ question?: string; id?: string; conditionId?: string; clobTokenIds?: string | string[] }> }> }).events || [];

    for (const event of events) {
      const markets = event.markets || [];

      for (const market of markets) {
        const marketId = market.id || market.conditionId || '';

        // Skip already scheduled markets
        if (this.scheduledMarketIds.has(marketId)) continue;

        const marketName = market.question || '';
        const parsed = this.parseMarketName(marketName);
        if (!parsed) continue;

        // Skip if market has ended or is ending soon
        const timeUntilEnd = parsed.endTime.getTime() - nowMs;
        if (timeUntilEnd < MIN_REMAINING_MS) continue;

        // Parse token IDs for asset IDs
        const tokenIds = this.parseTokenIds(market.clobTokenIds);

        candidates.push({
          market: {
            marketId,
            marketName,
            startTime: parsed.startTime,
            endTime: parsed.endTime,
            assetId: tokenIds[0],
            noAssetId: tokenIds[1],
          },
          startTime: parsed.startTime.getTime(),
        });
      }
    }

    // Sort by start time ascending (earliest market first)
    candidates.sort((a, b) => a.startTime - b.startTime);

    // Log candidates for debugging
    if (candidates.length > 0) {
      console.log(`[Orchestrator] Found ${candidates.length} candidate markets:`);
      candidates.slice(0, 5).forEach((c, i) => {
        console.log(`  ${i + 1}. ${c.market.marketName} (starts: ${c.market.startTime.toLocaleString()})`);
      });
    }

    return candidates.length > 0 ? candidates[0].market : null;
  }

  // ============================================================================
  // Market Name Parsing
  // ============================================================================

  /**
   * Parse market name to extract date and time window
   *
   * Input: "Bitcoin Up or Down - January 2, 2:30PM-2:45PM ET"
   * Output: { startTime: Date, endTime: Date }
   */
  private parseMarketName(name: string): { startTime: Date; endTime: Date } | null {
    const match = name.match(this.MARKET_PATTERN);
    if (!match) return null;

    const [, dateStr, startHour, startMin, startPeriod, endHour, endMin, endPeriod] = match;

    // Parse the date (assume current year, handle year rollover)
    const currentYear = new Date().getFullYear();
    let dateWithYear = `${dateStr}, ${currentYear}`;
    let baseDate = new Date(dateWithYear);

    // If the date is in the past by more than 6 months, it's probably next year
    const now = new Date();
    if (baseDate.getTime() < now.getTime() - 180 * 24 * 60 * 60 * 1000) {
      dateWithYear = `${dateStr}, ${currentYear + 1}`;
      baseDate = new Date(dateWithYear);
    }

    if (isNaN(baseDate.getTime())) return null;

    // Convert 12-hour to 24-hour format
    const start24Hour = this.to24Hour(parseInt(startHour), startPeriod as 'AM' | 'PM');
    const end24Hour = this.to24Hour(parseInt(endHour), endPeriod as 'AM' | 'PM');

    // Create start and end times in ET (Eastern Time)
    // We'll create the times and then adjust for ET offset
    const startTime = new Date(baseDate);
    startTime.setHours(start24Hour, parseInt(startMin), 0, 0);

    const endTime = new Date(baseDate);
    endTime.setHours(end24Hour, parseInt(endMin), 0, 0);

    // Handle day rollover (e.g., 11:45PM-12:00AM)
    if (endTime <= startTime) {
      endTime.setDate(endTime.getDate() + 1);
    }

    // Convert from ET to local time
    // When we parsed "3:45PM", JavaScript created a Date for 3:45 PM LOCAL time.
    // But we want it to represent 3:45 PM ET (Eastern Time).
    //
    // Example: User is in Central (UTC-6), market time is 3:45 PM ET (UTC-5)
    // - Parsed Date = 3:45 PM Central = 21:45 UTC (wrong - too late by 1 hour)
    // - Correct Date = 3:45 PM ET = 20:45 UTC = 2:45 PM Central
    // - Adjustment: subtract (localOffset - etOffset) = subtract (360 - 300) = subtract 60 min
    //
    // getTimezoneOffset() returns minutes BEHIND UTC (positive for west of UTC)
    // Central (UTC-6) = +360, ET (UTC-5) = +300
    const localOffsetMinutes = startTime.getTimezoneOffset();
    const etOffsetMinutes = this.getETOffsetMinutes(startTime);
    const adjustmentMs = (localOffsetMinutes - etOffsetMinutes) * 60 * 1000;

    startTime.setTime(startTime.getTime() - adjustmentMs);
    endTime.setTime(endTime.getTime() - adjustmentMs);

    return { startTime, endTime };
  }

  /**
   * Get ET offset in minutes (in same format as getTimezoneOffset - positive for west of UTC)
   * EST (Nov-Mar) = UTC-5 = +300 minutes
   * EDT (Mar-Nov) = UTC-4 = +240 minutes
   */
  private getETOffsetMinutes(date: Date): number {
    const month = date.getMonth();
    // Rough DST handling: EDT (UTC-4) from March to November, EST (UTC-5) otherwise
    // More accurate would be second Sunday in March to first Sunday in November
    if (month >= 2 && month <= 10) {
      return 240; // EDT: UTC-4 = +240 minutes behind UTC
    }
    return 300; // EST: UTC-5 = +300 minutes behind UTC
  }

  /**
   * Convert 12-hour to 24-hour format
   */
  private to24Hour(hour: number, period: 'AM' | 'PM'): number {
    if (period === 'AM') {
      return hour === 12 ? 0 : hour;
    } else {
      return hour === 12 ? 12 : hour + 12;
    }
  }

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
