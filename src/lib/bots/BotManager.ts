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
  LimitOrder,
} from './types';
import {
  createBot as createBotRecord,
  getBotById,
  getAllBots as getAllBotRecords,
  updateBotState,
  deleteBot as deleteBotRecord,
  getOrCreatePosition,
  updatePosition,
  getPositionsByBotId,
  rowToConfig,
  rowToPosition,
} from '../persistence/BotRepository';
import {
  createTrade,
  getBotTradeStats,
  rowToTrade,
} from '../persistence/TradeRepository';
import { cleanupBotState, getExecutor } from '../strategies/registry';
import {
  getOpenOrdersByBotId,
  cancelAllBotOrders,
  rowToLimitOrder,
} from '../persistence/LimitOrderRepository';

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

        // Sync database state to 'stopped' if it wasn't already
        if (record.state !== 'stopped') {
          updateBotState(record.id, 'stopped');
        }

        // Restore positions - for arbitrage bots there may be multiple (YES and NO)
        const positions = getPositionsByBotId(record.id);
        if (positions.length > 0) {
          // For non-arbitrage bots, just use the first position
          bot.setPosition(rowToPosition(positions[0]));
        } else {
          // Create initial position if none exists
          const positionRecord = getOrCreatePosition(
            record.id,
            record.market_id,
            record.asset_id || '',
            'YES'
          );
          bot.setPosition(rowToPosition(positionRecord));
        }

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

        // Position is updated by LimitOrderMatcher for all strategies
        // No need to update here since LimitOrderMatcher.updateTradeForOrderFill handles it
      }

      return trade;
    });

    // Note: Position updates are now handled directly by LimitOrderMatcher
    // for both immediate fills and pending order fills, using the unified
    // position system (positions table with bot_id + asset_id).
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

    // Initialize position(s) based on executor metadata
    const executor = getExecutor(config.strategySlug);
    if (executor?.metadata.positionHandler === 'multi') {
      // Multi-asset strategies: create position for each required asset
      for (const asset of executor.metadata.requiredAssets) {
        const assetId = config[asset.configKey as keyof typeof config] as string | undefined;
        if (assetId) {
          getOrCreatePosition(record.id, record.market_id, assetId, asset.label as 'YES' | 'NO');
        }
      }
      console.log(`[BotManager] Created multi-asset positions for bot: ${record.id}`);
    } else {
      // Single-asset strategies: create single position
      getOrCreatePosition(record.id, record.market_id, record.asset_id || '', 'YES');
    }

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

    // Cancel all pending orders to prevent stale orders from filling later
    const cancelledCount = cancelAllBotOrders(botId);
    if (cancelledCount > 0) {
      console.log(`[BotManager] Cancelled ${cancelledCount} pending orders for bot: ${botId}`);
    }

    // Update database
    updateBotState(botId, 'stopped', {
      stoppedAt: new Date().toISOString(),
    });

    // Note: Position is already persisted by LimitOrderMatcher during trading
    // The database is the source of truth, no need to persist in-memory position

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

    // Clean up any per-bot state in strategy executors (prevents memory leaks)
    cleanupBotState(botId);

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
   * Get a bot by ID (returns BotInstance for UI consumption)
   */
  getBot(botId: string): BotInstance | undefined {
    const bot = this.bots.get(botId);
    return bot?.toInstance();
  }

  /**
   * Get the raw Bot instance by ID (for event subscription)
   */
  getBotRaw(botId: string): Bot | undefined {
    return this.bots.get(botId);
  }

  /**
   * Update a bot's in-memory position (merges with existing position)
   */
  updateBotPosition(botId: string, updates: Partial<{
    size: string;
    avgEntryPrice: string;
    realizedPnl: string;
    outcome: 'YES' | 'NO';
  }>): void {
    const bot = this.bots.get(botId);
    if (bot) {
      const currentPosition = bot.getPosition();
      bot.setPosition({
        ...currentPosition,
        ...updates,
      });
    }
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

  // ============================================================================
  // Order Management
  // ============================================================================

  /**
   * Get active orders for a bot
   */
  getActiveOrders(botId: string): LimitOrder[] {
    const bot = this.bots.get(botId);
    if (bot) {
      return bot.getActiveOrders();
    }

    // Fallback to database query if bot not in memory
    const orderRows = getOpenOrdersByBotId(botId);
    return orderRows.map(rowToLimitOrder);
  }

  /**
   * Cancel all orders for a bot
   */
  cancelBotOrders(botId: string): number {
    const cancelledCount = cancelAllBotOrders(botId);
    console.log(`[BotManager] Cancelled ${cancelledCount} orders for bot: ${botId}`);
    return cancelledCount;
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
