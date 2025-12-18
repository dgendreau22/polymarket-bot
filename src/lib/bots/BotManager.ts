/**
 * Bot Manager
 *
 * Singleton that orchestrates bot lifecycle, persistence, and trade execution.
 */

import { Bot } from './Bot';
import { createDryRunExecutor } from './DryRunExecutor';
import { createLiveExecutor } from './LiveExecutor';
import type {
  BotConfig,
  BotInstance,
  BotState,
  BotMode,
  Trade,
  StrategySignal,
} from './types';
import {
  createBot as createBotRecord,
  getBotById,
  getAllBots as getAllBotRecords,
  updateBotState,
  deleteBot as deleteBotRecord,
  getOrCreatePosition,
  updatePosition,
  rowToConfig,
  rowToPosition,
} from '../persistence/BotRepository';
import {
  createTrade,
  getBotTradeStats,
  rowToTrade,
} from '../persistence/TradeRepository';

class BotManager {
  private bots: Map<string, Bot> = new Map();
  private dryRunExecutor = createDryRunExecutor();
  private liveExecutor = createLiveExecutor();

  constructor() {
    // Restore running bots from database on startup
    this.restoreBotsFromDatabase();
  }

  /**
   * Restore bots from database (but don't auto-start them)
   */
  private restoreBotsFromDatabase(): void {
    try {
      const botRecords = getAllBotRecords();

      for (const record of botRecords) {
        const config = rowToConfig(record);
        const bot = new Bot(config);

        // Restore state (but mark as stopped - don't auto-start)
        bot.setState('stopped');

        // Restore position if exists
        const positionRecord = getOrCreatePosition(
          record.id,
          record.market_id,
          record.asset_id || ''
        );
        bot.setPosition(rowToPosition(positionRecord));

        // Restore metrics
        const stats = getBotTradeStats(record.id);
        bot.setMetrics({
          totalTrades: stats.totalTrades,
          winningTrades: stats.winningTrades,
          losingTrades: stats.losingTrades,
          totalPnl: stats.totalPnl,
          unrealizedPnl: '0',
          maxDrawdown: '0',
          avgTradeSize: stats.avgTradeSize,
        });

        // Restore timestamps
        bot.restoreTimestamps({
          createdAt: new Date(record.created_at),
          updatedAt: new Date(record.updated_at),
          startedAt: record.started_at ? new Date(record.started_at) : undefined,
          stoppedAt: record.stopped_at ? new Date(record.stopped_at) : undefined,
        });

        // Set executor
        this.setupBotExecutor(bot);

        this.bots.set(record.id, bot);
      }

      console.log(`[BotManager] Restored ${botRecords.length} bots from database`);
    } catch (error) {
      console.error('[BotManager] Failed to restore bots:', error);
    }
  }

  /**
   * Set up trade executor for a bot based on its mode
   */
  private setupBotExecutor(bot: Bot): void {
    const executor = bot.mode === 'live' ? this.liveExecutor : this.dryRunExecutor;

    bot.setTradeExecutor(async (b: Bot, signal: StrategySignal): Promise<Trade | null> => {
      const trade = await executor(b, signal);

      if (trade) {
        // Persist trade
        createTrade(trade);

        // Update position in database
        const position = b.getPosition();
        updatePosition(b.id, {
          size: position.size,
          avgEntryPrice: position.avgEntryPrice,
          realizedPnl: position.realizedPnl,
        });
      }

      return trade;
    });
  }

  // ============================================================================
  // Bot Lifecycle
  // ============================================================================

  /**
   * Create a new bot
   */
  createBot(config: Omit<BotConfig, 'id'>): BotInstance {
    // Create database record
    const record = createBotRecord(config);
    const fullConfig = rowToConfig(record);

    // Create bot instance
    const bot = new Bot(fullConfig);

    // Initialize position
    getOrCreatePosition(record.id, record.market_id, record.asset_id || '');

    // Set up executor
    this.setupBotExecutor(bot);

    this.bots.set(record.id, bot);

    console.log(`[BotManager] Created bot: ${record.id} (${config.name})`);
    return bot.toInstance();
  }

  /**
   * Start a bot
   */
  async startBot(botId: string): Promise<void> {
    const bot = this.bots.get(botId);
    if (!bot) {
      throw new Error(`Bot not found: ${botId}`);
    }

    await bot.start();

    // Update database
    updateBotState(botId, 'running', {
      startedAt: new Date().toISOString(),
    });

    console.log(`[BotManager] Started bot: ${botId}`);
  }

  /**
   * Stop a bot
   */
  async stopBot(botId: string): Promise<void> {
    const bot = this.bots.get(botId);
    if (!bot) {
      throw new Error(`Bot not found: ${botId}`);
    }

    await bot.stop();

    // Update database
    updateBotState(botId, 'stopped', {
      stoppedAt: new Date().toISOString(),
    });

    // Persist final position
    const position = bot.getPosition();
    updatePosition(botId, {
      size: position.size,
      avgEntryPrice: position.avgEntryPrice,
      realizedPnl: position.realizedPnl,
    });

    console.log(`[BotManager] Stopped bot: ${botId}`);
  }

  /**
   * Pause a bot
   */
  async pauseBot(botId: string): Promise<void> {
    const bot = this.bots.get(botId);
    if (!bot) {
      throw new Error(`Bot not found: ${botId}`);
    }

    await bot.pause();

    // Update database
    updateBotState(botId, 'paused');

    console.log(`[BotManager] Paused bot: ${botId}`);
  }

  /**
   * Resume a paused bot
   */
  async resumeBot(botId: string): Promise<void> {
    const bot = this.bots.get(botId);
    if (!bot) {
      throw new Error(`Bot not found: ${botId}`);
    }

    await bot.resume();

    // Update database
    updateBotState(botId, 'running');

    console.log(`[BotManager] Resumed bot: ${botId}`);
  }

  /**
   * Delete a bot
   */
  deleteBot(botId: string): boolean {
    const bot = this.bots.get(botId);

    if (bot && bot.isRunning) {
      throw new Error('Cannot delete a running bot. Stop it first.');
    }

    // Delete from database (also deletes trades and positions)
    const deleted = deleteBotRecord(botId);

    if (deleted) {
      this.bots.delete(botId);
      console.log(`[BotManager] Deleted bot: ${botId}`);
    }

    return deleted;
  }

  // ============================================================================
  // Bot Queries
  // ============================================================================

  /**
   * Get a bot by ID
   */
  getBot(botId: string): BotInstance | undefined {
    const bot = this.bots.get(botId);
    return bot?.toInstance();
  }

  /**
   * Get all bots
   */
  getAllBots(filters?: {
    state?: BotState;
    mode?: BotMode;
    strategySlug?: string;
  }): BotInstance[] {
    let bots = Array.from(this.bots.values());

    if (filters?.state) {
      bots = bots.filter(b => b.currentState === filters.state);
    }
    if (filters?.mode) {
      bots = bots.filter(b => b.mode === filters.mode);
    }
    if (filters?.strategySlug) {
      bots = bots.filter(b => b.strategySlug === filters.strategySlug);
    }

    return bots.map(b => b.toInstance());
  }

  /**
   * Get active (running or paused) bots
   */
  getActiveBots(): BotInstance[] {
    return Array.from(this.bots.values())
      .filter(b => b.isRunning || b.isPaused)
      .map(b => b.toInstance());
  }

  /**
   * Get bots by strategy
   */
  getBotsByStrategy(strategySlug: string): BotInstance[] {
    return Array.from(this.bots.values())
      .filter(b => b.strategySlug === strategySlug)
      .map(b => b.toInstance());
  }

  /**
   * Count bots by state
   */
  countBotsByState(): { running: number; paused: number; stopped: number } {
    let running = 0;
    let paused = 0;
    let stopped = 0;

    for (const bot of this.bots.values()) {
      switch (bot.currentState) {
        case 'running':
          running++;
          break;
        case 'paused':
          paused++;
          break;
        case 'stopped':
          stopped++;
          break;
      }
    }

    return { running, paused, stopped };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

// Use global to persist across Next.js hot reloads in development
const globalForBotManager = globalThis as unknown as {
  botManager: BotManager | undefined;
};

/**
 * Get the BotManager singleton
 */
export function getBotManager(): BotManager {
  if (!globalForBotManager.botManager) {
    globalForBotManager.botManager = new BotManager();
  }
  return globalForBotManager.botManager;
}

/**
 * Reset the BotManager (for testing)
 */
export function resetBotManager(): void {
  if (globalForBotManager.botManager) {
    // Stop all running bots
    for (const bot of globalForBotManager.botManager.getAllBots({ state: 'running' })) {
      globalForBotManager.botManager.stopBot(bot.config.id).catch(console.error);
    }
  }
  globalForBotManager.botManager = undefined;
}
