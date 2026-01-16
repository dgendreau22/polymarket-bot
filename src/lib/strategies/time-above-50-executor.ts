/**
 * TimeAbove50 Strategy Executor
 *
 * 15-minute binary market strategy using time-above-0.50 signal.
 *
 * Key features:
 * - Consensus pricing from YES/NO books (spread-weighted)
 * - Time-above-0.50 signal with exponential decay
 * - Full exposure switching (long YES ↔ long NO via unwind-first)
 * - Risk controls: spread gates, time flatten, hysteresis
 */

import { log } from '@/lib/logger';
import type {
  IStrategyExecutor,
  StrategyContext,
  StrategySignal,
  ExecutorMetadata,
} from '../bots/types';

import {
  parseConfig,
  TimeAbove50State,
  ConsensusPriceCalculator,
  SignalCalculator,
  ExposureManager,
  RiskValidator,
  DecisionEngine,
  SignalFactory,
} from './time-above-50/index';
import { createStrategyMetric } from '../persistence/StrategyMetricsRepository';

// Strategy constants
const MAX_PRICE_DISTANCE = 0.02;  // 2% max distance for stale order detection
const DEFAULT_FILLABILITY_THRESHOLD = 0.80;

export class TimeAbove50Executor implements IStrategyExecutor {
  /** Executor metadata - declares dual-asset requirements */
  readonly metadata: ExecutorMetadata = {
    requiredAssets: [
      { configKey: 'assetId', label: 'YES', subscriptions: ['orderBook', 'price', 'trades'] },
      { configKey: 'noAssetId', label: 'NO', subscriptions: ['orderBook', 'price', 'trades'] },
    ],
    positionHandler: 'multi',
    staleOrderRules: {
      maxOrderAge: 3,  // Cancel orders older than 3 seconds (per spec section 5.4)
      maxPriceDistance: MAX_PRICE_DISTANCE,
      perOutcome: true,
    },
    fillabilityThreshold: DEFAULT_FILLABILITY_THRESHOLD,
  };

  // Shared state across all bots using this strategy
  private state = new TimeAbove50State();

  // Lazy-initialized modules (recreated when config changes)
  private consensusCalculator = new ConsensusPriceCalculator();
  private signalFactory = new SignalFactory();
  private currentConfig: ReturnType<typeof parseConfig> | null = null;
  private signalCalculator: SignalCalculator | null = null;
  private exposureManager: ExposureManager | null = null;
  private riskValidator: RiskValidator | null = null;
  private decisionEngine: DecisionEngine | null = null;

  /**
   * Clean up state for a deleted bot (prevents memory leaks)
   */
  cleanup(botId: string): void {
    this.state.cleanup(botId);
  }

  /**
   * Get or create modules with current config
   */
  private getModules(config: ReturnType<typeof parseConfig>): void {
    if (this.currentConfig !== config) {
      this.signalCalculator = new SignalCalculator(config);
      this.exposureManager = new ExposureManager(config);
      this.riskValidator = new RiskValidator(config);
      this.decisionEngine = new DecisionEngine(config);
      this.currentConfig = config;
    }
  }

  /**
   * Main strategy execution
   */
  async execute(context: StrategyContext): Promise<StrategySignal | null> {
    const { bot, tickSize, yesPrices, noPrices, positions, marketEndTime } = context;
    const botId = bot.config.id;
    const now = Date.now();

    // 1. Parse configuration
    const config = parseConfig(
      (bot.config.strategyConfig || {}) as Record<string, unknown>
    );
    this.getModules(config);

    // 2. Calculate consensus price from YES/NO books
    const consensus = this.consensusCalculator.calculate(yesPrices, noPrices);
    if (!consensus.isValid) {
      log('TimeAbove50', `${botId}: Missing order book data, skipping cycle`);
      return null;
    }

    // 3. Check throttles (rebalance_interval, cooldown)
    const throttleCheck = this.riskValidator!.checkThrottles(botId, this.state, now);
    if (!throttleCheck.allowed) {
      // Don't log throttle denials (too noisy)
      return null;
    }

    // Record that we checked (prevents burst logging)
    this.state.recordDecision(botId, now);

    // 4. Extract positions
    const { inv_yes, inv_no } = this.extractPositions(positions);

    // 5. Calculate time to resolution
    const T_min = this.getTimeToResolution(marketEndTime);

    // 6. Calculate signal components (tau, A, dbar, E)
    const signal = this.signalCalculator!.calculate(
      botId,
      this.state,
      consensus.consensusPrice,
      consensus.spread_c,
      T_min,
      now
    );

    // 7. Calculate exposure target (q*)
    const exposure = this.exposureManager!.calculateTarget(
      signal.E,
      consensus.consensusPrice,
      inv_yes,
      inv_no,
      T_min
    );

    // Log state every cycle for monitoring
    const shortId = botId.slice(0, 8);
    const direction = exposure.q_star > 0 ? 'YES' : exposure.q_star < 0 ? 'NO' : 'FLAT';
    log(
      `TA50 ${shortId}`,
      `p=${consensus.consensusPrice.toFixed(3)} | ` +
      `E=${signal.E >= 0 ? '+' : ''}${signal.E.toFixed(3)} | ` +
      `q*=${exposure.q_star >= 0 ? '+' : ''}${exposure.q_star.toFixed(0)} (${direction}) | ` +
      `pos: YES=${inv_yes.toFixed(0)} NO=${inv_no.toFixed(0)} | ` +
      `dq=${exposure.dq >= 0 ? '+' : ''}${exposure.dq.toFixed(0)}`
    );

    // Save metrics for charting and emit event for real-time updates
    this.saveMetrics(
      botId,
      now,
      signal,
      exposure,
      consensus.consensusPrice,
      inv_yes,
      inv_no,
      positions,
      context.emitEvent
    );

    // 8. Check spread gates
    const spreadCheck = this.riskValidator!.checkSpreadGates(
      consensus.spread_c,
      exposure.isExpanding
    );
    if (!spreadCheck.allowed) {
      log('TimeAbove50', `${botId}: ${spreadCheck.reason}`);
      return null;
    }

    // 9. Determine action using decision engine
    const action = this.decisionEngine!.decide(exposure, inv_yes, inv_no);
    if (!action) {
      // No action needed (dq too small or already at target)
      return null;
    }

    // 10. Check min hold for direction changes
    const holdCheck = this.riskValidator!.checkMinHold(
      botId,
      this.state,
      action.targetDirection,
      exposure.isExpanding,
      now
    );
    if (!holdCheck.allowed) {
      log('TimeAbove50', `${botId}: ${holdCheck.reason}`);
      return null;
    }

    // 11. Update direction tracking
    this.state.updateDirection(botId, action.targetDirection, now);

    // 12. Validate price data before signal creation
    if (!yesPrices || !noPrices) {
      log('TimeAbove50', `${botId}: Missing price data for signal creation`);
      return null;
    }

    // 13. Create signal with tick-rounded price
    const tick = tickSize ? parseFloat(tickSize.tick_size) : 0.01;

    // Log the action being taken
    log(
      `TA50 ${shortId}`,
      `>>> ACTION: ${action.side} ${action.quantity.toFixed(0)} ${action.outcome} ` +
      `(${action.isUnwind ? 'UNWIND' : 'BUILD'})`
    );

    return this.signalFactory.createSignal(
      action,
      yesPrices,
      noPrices,
      tick,
      signal.E
    );
  }

  /**
   * Extract YES and NO position sizes from context
   */
  private extractPositions(
    positions: StrategyContext['positions']
  ): { inv_yes: number; inv_no: number } {
    let inv_yes = 0;
    let inv_no = 0;

    if (positions && positions.length > 0) {
      for (const pos of positions) {
        const size = parseFloat(pos.size || '0');
        if (pos.outcome === 'YES') {
          inv_yes = size;
        } else if (pos.outcome === 'NO') {
          inv_no = size;
        }
      }
    }

    return { inv_yes, inv_no };
  }

  /**
   * Calculate time to market resolution in minutes
   *
   * Returns 15 minutes if marketEndTime is not available
   */
  private getTimeToResolution(marketEndTime: Date | undefined): number {
    if (!marketEndTime) {
      return 15; // Default to 15 minutes if unknown
    }

    const now = Date.now();
    const endTime = marketEndTime.getTime();
    const remainingMs = Math.max(0, endTime - now);
    return remainingMs / 60000; // Convert to minutes
  }

  /**
   * Save strategy metrics to database for charting and emit real-time event
   */
  private saveMetrics(
    botId: string,
    timestamp: number,
    signal: { tau: number; A: number; E: number; theta: number; dbar: number; inDeadband: boolean },
    exposure: { q_star: number },
    consensusPrice: number,
    inv_yes: number,
    inv_no: number,
    positions: StrategyContext['positions'],
    emitEvent?: StrategyContext['emitEvent']
  ): void {
    try {

      // Calculate total PnL from positions
      let totalPnl = 0;
      if (positions && positions.length > 0) {
        for (const pos of positions) {
          const realizedPnl = parseFloat(pos.realizedPnl || '0');
          const size = parseFloat(pos.size || '0');
          const avgEntry = parseFloat(pos.avgEntryPrice || '0');

          // Unrealized PnL: (currentPrice - avgEntry) * size
          // For YES: use consensusPrice, for NO: use (1 - consensusPrice)
          let unrealizedPnl = 0;
          if (size > 0 && avgEntry > 0) {
            const currentPrice = pos.outcome === 'YES' ? consensusPrice : (1 - consensusPrice);
            unrealizedPnl = (currentPrice - avgEntry) * size;
          }

          totalPnl += realizedPnl + unrealizedPnl;
        }
      }

      const metricsData = {
        botId,
        timestamp,
        tau: signal.A,  // Store A (time-above score) in tau field: A = 2*tau - 1, range [-1, 1]
        edge: signal.E,
        qStar: exposure.q_star,
        theta: signal.theta,
        delta: signal.dbar,  // Store dbar (smoothed displacement) in delta field
        price: consensusPrice,
        positionYes: inv_yes,
        positionNo: inv_no,
        totalPnl,
      };

      // Save to database
      createStrategyMetric(metricsData);

      // Emit event for real-time chart updates
      if (emitEvent) {
        emitEvent({
          type: 'METRICS_UPDATED',
          metrics: metricsData,
          timestamp: new Date(),
        });
      }
    } catch (err) {
      // Don't let metrics errors affect strategy execution
      log('TimeAbove50', `Failed to save metrics for ${botId}: ${err}`);
    }
  }
}
