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

  private currentMarket: ScheduledMarket | null = null;
  private currentBotId: string | null = null;
  private scheduledStartTime: Date | null = null;
  private scheduledTimer: NodeJS.Timeout | null = null;
  private searchInterval: NodeJS.Timeout | null = null;
  private botHistory: OrchestratorBotInfo[] = [];
  private eventHandlers: OrchestratorEventHandler[] = [];
  private lastError: string | null = null;

  // Market discovery constants
  private readonly SEARCH_QUERY = 'Bitcoin Up or Down';
  private readonly MARKET_PATTERN = /Bitcoin Up or Down - (\w+ \d{1,2}), (\d{1,2}):(\d{2})(AM|PM)-(\d{1,2}):(\d{2})(AM|PM) ET/i;
  private readonly SEARCH_INTERVAL_MS = 60000; // Check for new markets every minute
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
    this.setState('searching');

    console.log(`[Orchestrator] Starting with strategy=${this.config.strategy}, mode=${this.config.mode}`);

    // Begin market discovery
    await this.findAndScheduleNextMarket();

    // Set up continuous search interval
    this.searchInterval = setInterval(() => {
      if (this.state === 'idle' || this.state === 'searching') {
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
    if (this.scheduledTimer) {
      clearTimeout(this.scheduledTimer);
      this.scheduledTimer = null;
    }
    if (this.searchInterval) {
      clearInterval(this.searchInterval);
      this.searchInterval = null;
    }

    this.currentMarket = null;
    this.scheduledStartTime = null;
    this.setState('idle');

    console.log('[Orchestrator] Stopped');
  }

  /**
   * Get current orchestrator status
   */
  getStatus(): OrchestratorStatus {
    return {
      state: this.state,
      config: { ...this.config },
      currentMarket: this.currentMarket,
      scheduledStartTime: this.scheduledStartTime,
      currentBotId: this.currentBotId,
      botCount: this.botHistory.length,
      lastError: this.lastError,
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
    // Rate limiting
    const now = Date.now();
    if (now - this.lastSearchTime < this.MIN_SEARCH_INTERVAL_MS) {
      return;
    }
    this.lastSearchTime = now;

    try {
      console.log('[Orchestrator] Searching for next Bitcoin 15-min market...');
      const market = await this.discoverNextMarket();

      if (market) {
        this.currentMarket = market;
        this.emitEvent({ type: 'MARKET_FOUND', market, timestamp: new Date() });
        console.log(`[Orchestrator] Found market: ${market.marketName}`);
        console.log(`[Orchestrator] Market starts at: ${market.startTime.toLocaleString()}`);

        await this.scheduleBot(market);
      } else {
        console.log('[Orchestrator] No upcoming market found, will retry...');
        this.setState('searching');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Orchestrator] Error finding market:', errorMsg);
      this.lastError = errorMsg;
      this.setState('error');
      this.emitEvent({ type: 'ERROR', error: errorMsg, timestamp: new Date() });
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
    let nextMarket: ScheduledMarket | null = null;
    let earliestStart: Date | null = null;

    // Find events with markets matching our pattern
    const events = (results as { events?: Array<{ markets?: Array<{ question?: string; id?: string; conditionId?: string; clobTokenIds?: string | string[] }> }> }).events || [];

    for (const event of events) {
      const markets = event.markets || [];

      for (const market of markets) {
        const marketName = market.question || '';
        const parsed = this.parseMarketName(marketName);
        if (!parsed) continue;

        // Only consider markets starting in the future
        if (parsed.startTime <= now) continue;

        // Find the earliest upcoming market
        if (!earliestStart || parsed.startTime < earliestStart) {
          earliestStart = parsed.startTime;

          // Parse token IDs for asset IDs
          const tokenIds = this.parseTokenIds(market.clobTokenIds);

          nextMarket = {
            marketId: market.id || market.conditionId || '',
            marketName,
            startTime: parsed.startTime,
            endTime: parsed.endTime,
            assetId: tokenIds[0],
            noAssetId: tokenIds[1],
          };
        }
      }
    }

    return nextMarket;
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
    const now = new Date();
    const leadTimeMs = this.config.leadTimeMinutes * 60 * 1000;
    const botStartTime = new Date(market.startTime.getTime() - leadTimeMs);
    const delayMs = botStartTime.getTime() - now.getTime();

    if (delayMs <= 0) {
      // Market is about to start or already started, create bot now
      console.log('[Orchestrator] Market starting soon, creating bot immediately');
      await this.createBot(market);
      return;
    }

    // Schedule bot creation
    this.scheduledStartTime = botStartTime;
    this.setState('scheduled');
    this.emitEvent({
      type: 'BOT_SCHEDULED',
      botStartTime,
      market,
      timestamp: new Date(),
    });

    const delaySeconds = Math.round(delayMs / 1000);
    const delayMinutes = Math.round(delayMs / 60000);
    console.log(`[Orchestrator] Bot scheduled to start at ${botStartTime.toLocaleString()} (in ${delayMinutes}m ${delaySeconds % 60}s)`);

    this.scheduledTimer = setTimeout(async () => {
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
    this.currentBotId = botInstance.config.id;

    await botManager.startBot(this.currentBotId);

    this.scheduledStartTime = null;
    this.setState('active');
    this.emitEvent({
      type: 'BOT_CREATED',
      botId: this.currentBotId,
      market,
      timestamp: new Date(),
    });

    // Add to history
    this.botHistory.unshift({
      botId: this.currentBotId,
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

    console.log(`[Orchestrator] Bot created and started: ${this.currentBotId}`);

    // Monitor for market close and cycle to next
    this.monitorBotForCycle(this.currentBotId, market);
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

    // Listen for bot stop event (triggered by market close detection)
    const handler = (event: BotEvent) => {
      if (event.type === 'STOPPED') {
        bot.offEvent(handler);

        console.log(`[Orchestrator] Bot ${botId} stopped, updating history...`);

        // Update history
        const historyItem = this.botHistory.find(b => b.botId === botId);
        if (historyItem) {
          const botInstance = botManager.getBot(botId);
          if (botInstance) {
            historyItem.state = 'stopped';
            historyItem.positionSize = botInstance.totalPositionSize ?? parseFloat(botInstance.position.size);
            historyItem.pnl = parseFloat(botInstance.metrics.totalPnl);
          }
        }

        this.currentBotId = null;
        this.emitEvent({ type: 'CYCLE_COMPLETE', botId, timestamp: new Date() });

        // If orchestrator is still enabled, find next market
        if (this.config.enabled) {
          console.log('[Orchestrator] Cycling to next market...');
          this.setState('searching');
          this.findAndScheduleNextMarket();
        }
      }
    };

    bot.onEvent(handler);
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
