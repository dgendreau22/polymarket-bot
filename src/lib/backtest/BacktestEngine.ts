/**
 * Backtest Engine
 *
 * Replays recorded market data against the Time Above 50 strategy to simulate trading.
 *
 * Key features:
 * - Uses order book snapshots for accurate pricing (YES + NO always ≈ 1.0)
 * - Snapshot-driven evaluation (throttled to rebalance_interval)
 * - Runs strategy signal calculation with spread-weighted consensus
 * - Simulates position execution using bid/ask prices
 * - Tracks balance history for PnL metrics
 */

import { v4 as uuidv4 } from 'uuid';
import type { TimeAbove50Config } from '@/lib/strategies/time-above-50/TimeAbove50Config';
import { DEFAULT_CONFIG } from '@/lib/strategies/time-above-50/TimeAbove50Config';
import { TimeAbove50State } from '@/lib/strategies/time-above-50/TimeAbove50State';
import { SignalCalculator } from '@/lib/strategies/time-above-50/SignalCalculator';
import { ExposureManager } from '@/lib/strategies/time-above-50/ExposureManager';
import {
  getTicksBySession,
  getRecordingSessionById,
  getSnapshotsForSessions,
  type MarketTickRow,
  type MarketSnapshotRow,
  type RecordingSessionRow,
} from '@/lib/persistence/DataRepository';
import { calculateMetrics } from './PnLCalculator';
import {
  checkPriceCrossing,
  getMarketableFillPrice,
  processTicksForFills,
} from './BacktestOrderMatcher';
import type {
  BacktestConfig,
  BacktestResult,
  BacktestTrade,
  BacktestPendingOrder,
  BacktestFill,
  BalanceSnapshot,
  ConsensusPricePoint,
  ProcessedTick,
  SessionBreakdown,
  SimulatedPosition,
  SnapshotPrice,
} from './types';

/**
 * Main backtest engine class
 */
export class BacktestEngine {
  private config: BacktestConfig;
  private strategyConfig: TimeAbove50Config;
  private state: TimeAbove50State;
  private signalCalculator: SignalCalculator;
  private exposureManager: ExposureManager;

  // Simulation state
  private balance: number;
  private position: SimulatedPosition;
  private trades: BacktestTrade[];
  private balanceHistory: BalanceSnapshot[];

  // Session data
  private sessions: RecordingSessionRow[];
  private consensusPrices: ConsensusPricePoint[];
  private ticksProcessed: number;

  // Snapshot data (for spread-aware pricing)
  private snapshots: SnapshotPrice[];
  private snapshotTimestamps: number[]; // Sorted timestamps for binary search

  // Limit order simulation (when executionMode === 'limit')
  private pendingOrders: BacktestPendingOrder[];
  private allTicks: ProcessedTick[]; // Store ticks for fill scanning
  private totalOrdersCreated: number;
  private filledOrderCount: number;
  private expiredOrderCount: number;
  private lastEvalTimestamp: number; // Track last evaluation time for tick scanning

  constructor(config: BacktestConfig) {
    this.config = config;
    this.strategyConfig = { ...DEFAULT_CONFIG, ...config.strategyParams };
    this.state = new TimeAbove50State();
    this.signalCalculator = new SignalCalculator(this.strategyConfig);
    this.exposureManager = new ExposureManager(this.strategyConfig);

    // Initialize simulation state
    this.balance = config.initialCapital;
    this.position = {
      yesShares: 0,
      noShares: 0,
      yesAvgEntry: 0,
      noAvgEntry: 0,
      netPosition: 0,
    };
    this.trades = [];
    this.balanceHistory = [];
    this.sessions = [];
    this.consensusPrices = [];
    this.ticksProcessed = 0;
    this.snapshots = [];
    this.snapshotTimestamps = [];
    // Limit order simulation state
    this.pendingOrders = [];
    this.allTicks = [];
    this.totalOrdersCreated = 0;
    this.filledOrderCount = 0;
    this.expiredOrderCount = 0;
    this.lastEvalTimestamp = 0;
  }

  /**
   * Run the backtest
   */
  async run(): Promise<BacktestResult> {
    const startTime = Date.now();
    const runId = uuidv4();
    const botId = `backtest-${runId}`;

    // Load sessions, ticks, and snapshots
    this.loadSessions();
    this.loadSnapshots();
    this.allTicks = this.loadTicks();
    if (this.allTicks.length === 0) {
      throw new Error('No ticks found in selected sessions');
    }

    // Convert ticks to consensus prices
    this.consensusPrices = this.calculateConsensusPrices(this.allTicks);
    if (this.consensusPrices.length === 0) {
      throw new Error('Could not calculate consensus prices from ticks');
    }

    // Record initial balance
    this.balanceHistory.push({
      timestamp: this.consensusPrices[0].timestamp,
      balance: this.balance,
      equity: this.balance,
    });

    // Simulate strategy execution for each consensus price point
    for (const pricePoint of this.consensusPrices) {
      this.processConsensusPricePoint(botId, pricePoint);
    }

    // Close any remaining positions at end
    this.closeAllPositions(this.consensusPrices[this.consensusPrices.length - 1]);

    // Calculate final metrics
    const finalBalance = this.balance;
    const metrics = calculateMetrics(
      this.trades,
      this.balanceHistory,
      this.config.initialCapital,
      finalBalance
    );

    // Calculate session breakdown
    const sessionBreakdown = this.calculateSessionBreakdown();

    const endTime = Date.now();

    // Clean up state
    this.state.cleanup(botId);

    // Calculate fill metrics for limit mode
    const executionMode = this.config.executionMode ?? 'limit';
    const totalOrdersCreated = this.totalOrdersCreated;
    const filledOrderCount = this.filledOrderCount;
    const expiredOrderCount = this.expiredOrderCount;
    const fillRate = totalOrdersCreated > 0
      ? filledOrderCount / totalOrdersCreated
      : 0;

    return {
      runId,
      strategyParams: this.strategyConfig,
      initialCapital: this.config.initialCapital,
      finalBalance,
      totalPnl: metrics.totalPnl,
      totalReturn: metrics.totalReturn,
      sharpeRatio: metrics.sharpeRatio,
      maxDrawdown: metrics.maxDrawdown,
      winRate: metrics.winRate,
      tradeCount: metrics.tradeCount,
      avgTradePnl: metrics.avgTradePnl,
      maxWin: metrics.maxWin,
      maxLoss: metrics.maxLoss,
      profitFactor: metrics.profitFactor,
      trades: this.trades,
      balanceHistory: this.balanceHistory,
      sessionBreakdown,
      backtestDurationSeconds: (endTime - startTime) / 1000,
      ticksProcessed: this.ticksProcessed,
      // Limit order metrics
      executionMode,
      totalOrdersCreated: executionMode === 'limit' ? totalOrdersCreated : undefined,
      filledOrderCount: executionMode === 'limit' ? filledOrderCount : undefined,
      expiredOrderCount: executionMode === 'limit' ? expiredOrderCount : undefined,
      fillRate: executionMode === 'limit' ? fillRate : undefined,
    };
  }

  /**
   * Load recording sessions
   */
  private loadSessions(): void {
    this.sessions = [];
    for (const sessionId of this.config.sessionIds) {
      const session = getRecordingSessionById(sessionId);
      if (session) {
        this.sessions.push(session);
      }
    }
    if (this.sessions.length === 0) {
      throw new Error('No valid sessions found');
    }
  }

  /**
   * Load ticks from all sessions
   */
  private loadTicks(): ProcessedTick[] {
    const allTicks: ProcessedTick[] = [];

    for (const session of this.sessions) {
      const rawTicks = getTicksBySession(session.id);
      for (const tick of rawTicks) {
        allTicks.push({
          timestamp: new Date(tick.timestamp).getTime(),
          outcome: tick.outcome,
          price: parseFloat(tick.price),
          size: parseFloat(tick.size),
          sessionId: session.id,
        });
        this.ticksProcessed++;
      }
    }

    // Sort by timestamp
    allTicks.sort((a, b) => a.timestamp - b.timestamp);

    return allTicks;
  }

  /**
   * Load order book snapshots for spread-aware pricing
   *
   * Validates and corrects inverted spreads (bid > ask) which can occur
   * due to WebSocket data ordering issues.
   */
  private loadSnapshots(): void {
    const sessionIds = this.sessions.map((s) => s.id);
    const rawSnapshots = getSnapshotsForSessions(sessionIds);

    this.snapshots = [];
    this.snapshotTimestamps = [];
    let yesInvertedCount = 0;
    let noInvertedCount = 0;

    for (const row of rawSnapshots) {
      const timestamp = new Date(row.timestamp).getTime();

      // Parse bid/ask values, skip if any are missing
      let yesBid = row.yes_best_bid ? parseFloat(row.yes_best_bid) : null;
      let yesAsk = row.yes_best_ask ? parseFloat(row.yes_best_ask) : null;
      let noBid = row.no_best_bid ? parseFloat(row.no_best_bid) : null;
      let noAsk = row.no_best_ask ? parseFloat(row.no_best_ask) : null;

      // Skip incomplete snapshots
      if (yesBid === null || yesAsk === null || noBid === null || noAsk === null) {
        continue;
      }
      if (yesBid <= 0 || yesAsk <= 0 || noBid <= 0 || noAsk <= 0) {
        continue;
      }

      // Validate and correct inverted spreads (bid should be <= ask)
      if (yesBid > yesAsk) {
        // Swap inverted YES spread
        [yesBid, yesAsk] = [yesAsk, yesBid];
        yesInvertedCount++;
      }
      if (noBid > noAsk) {
        // Swap inverted NO spread
        [noBid, noAsk] = [noAsk, noBid];
        noInvertedCount++;
      }

      // Calculate spreads (now always positive)
      const yesSpread = yesAsk - yesBid;
      const noSpread = noAsk - noBid;

      // Calculate spread-weighted consensus (matches ConsensusPriceCalculator.ts)
      // Tighter spread = higher confidence = more weight
      const wYes = 1 / (yesSpread + 1e-6);
      const wNo = 1 / (noSpread + 1e-6);
      const yesMid = (yesBid + yesAsk) / 2;
      const noMid = (noBid + noAsk) / 2;
      const consensusPrice = (wYes * yesMid + wNo * (1 - noMid)) / (wYes + wNo);

      this.snapshots.push({
        timestamp,
        yesBid,
        yesAsk,
        noBid,
        noAsk,
        yesSpread,
        noSpread,
        consensusPrice,
        sessionId: row.session_id,
      });
      this.snapshotTimestamps.push(timestamp);
    }

    const totalInverted = yesInvertedCount + noInvertedCount;
    if (totalInverted > 0) {
      console.log(`[BacktestEngine] Corrected ${totalInverted} inverted spreads (YES: ${yesInvertedCount}, NO: ${noInvertedCount})`);
    }
    console.log(`[BacktestEngine] Loaded ${this.snapshots.length} snapshots for spread-aware pricing`);
  }

  /**
   * Find the nearest snapshot to a given timestamp (within 5 seconds)
   * Uses binary search for efficiency
   */
  private getNearestSnapshot(timestamp: number): SnapshotPrice | null {
    if (this.snapshots.length === 0) return null;

    const maxDelta = 5000; // 5 seconds max distance

    // Binary search for closest timestamp
    let left = 0;
    let right = this.snapshotTimestamps.length - 1;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (this.snapshotTimestamps[mid] < timestamp) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    // Check neighbors to find closest
    let bestIdx = left;
    let bestDelta = Math.abs(this.snapshotTimestamps[left] - timestamp);

    if (left > 0) {
      const prevDelta = Math.abs(this.snapshotTimestamps[left - 1] - timestamp);
      if (prevDelta < bestDelta) {
        bestIdx = left - 1;
        bestDelta = prevDelta;
      }
    }

    if (bestDelta <= maxDelta) {
      return this.snapshots[bestIdx];
    }

    return null;
  }

  /**
   * Calculate consensus prices from order book snapshots (snapshot-driven mode)
   *
   * Uses snapshots as the primary data source for accurate pricing.
   * Snapshots capture YES and NO bid/ask simultaneously, avoiding the
   * stale/corrupt tick data issues where YES + NO != 1.0.
   *
   * Throttled to rebalance_interval to match dry-run behavior.
   */
  private calculateConsensusPrices(_ticks: ProcessedTick[]): ConsensusPricePoint[] {
    const result: ConsensusPricePoint[] = [];
    const intervalMs = this.strategyConfig.rebalance_interval * 1000;

    if (this.snapshots.length === 0) {
      console.log(`[BacktestEngine] Warning: No snapshots available, cannot calculate prices`);
      return result;
    }

    let lastEvalTime = 0;

    for (const snapshot of this.snapshots) {
      // Throttle: only create evaluation point if interval elapsed
      if (snapshot.timestamp - lastEvalTime < intervalMs) continue;
      lastEvalTime = snapshot.timestamp;

      // Calculate mid-prices from bid/ask (more accurate than tick prices)
      const yesMid = (snapshot.yesBid + snapshot.yesAsk) / 2;
      const noMid = (snapshot.noBid + snapshot.noAsk) / 2;

      result.push({
        timestamp: snapshot.timestamp,
        price: snapshot.consensusPrice,
        yesPrice: yesMid,
        noPrice: noMid,
        sessionId: snapshot.sessionId,
        yesBid: snapshot.yesBid,
        yesAsk: snapshot.yesAsk,
        noBid: snapshot.noBid,
        noAsk: snapshot.noAsk,
        yesSpread: snapshot.yesSpread,
        noSpread: snapshot.noSpread,
      });
    }

    console.log(`[BacktestEngine] Snapshot-driven: ${this.snapshots.length} snapshots → ${result.length} evaluation points`);
    return result;
  }

  /**
   * Process a single consensus price point through the strategy
   */
  private processConsensusPricePoint(
    botId: string,
    pricePoint: ConsensusPricePoint
  ): void {
    // In limit mode, process any pending order fills from ticks since last evaluation
    const executionMode = this.config.executionMode ?? 'limit';
    if (executionMode === 'limit' && this.lastEvalTimestamp > 0) {
      this.processPendingOrderFills(
        this.lastEvalTimestamp,
        pricePoint.timestamp,
        pricePoint
      );
    }
    this.lastEvalTimestamp = pricePoint.timestamp;

    // Find session end time for time-to-resolution
    const session = this.sessions.find((s) => s.id === pricePoint.sessionId);
    const endTime = session ? new Date(session.end_time).getTime() : pricePoint.timestamp + 15 * 60 * 1000;
    const timeToResolutionMinutes = Math.max(0, (endTime - pricePoint.timestamp) / (1000 * 60));

    // Use actual spread from snapshot if available, else fallback to 0.01
    const spread = pricePoint.yesSpread ?? pricePoint.noSpread ?? 0.01;

    // Check throttles
    if (!this.state.canRebalance(botId, this.strategyConfig.rebalance_interval, pricePoint.timestamp)) {
      this.updateBalanceHistory(pricePoint);
      return;
    }

    if (!this.state.isCooldownPassed(botId, this.strategyConfig.cooldown, pricePoint.timestamp)) {
      this.updateBalanceHistory(pricePoint);
      return;
    }

    // Calculate signal
    const signal = this.signalCalculator.calculate(
      botId,
      this.state,
      pricePoint.price,
      spread,
      timeToResolutionMinutes,
      pricePoint.timestamp
    );

    // Calculate exposure target
    const target = this.exposureManager.calculateTarget(
      signal.E,
      pricePoint.price,
      this.position.yesShares,
      this.position.noShares,
      timeToResolutionMinutes
    );

    // Execute trades if needed
    if (target.shouldAct) {
      this.executeTrades(botId, pricePoint, target.dq, signal.E);
    }

    // Update balance history
    this.updateBalanceHistory(pricePoint);
  }

  /**
   * Execute trades to reach target exposure
   *
   * In immediate mode: executes at bid/ask (taker)
   * In limit mode: creates limit orders at bid (for buys) or ask (for sells)
   */
  private executeTrades(
    botId: string,
    pricePoint: ConsensusPricePoint,
    dq: number,
    edge: number
  ): void {
    const timestamp = new Date(pricePoint.timestamp).toISOString();
    const tradeQuantity = Math.abs(dq);
    const executionMode = this.config.executionMode ?? 'limit';

    // Verbose logging for debugging
    if (this.config.verbose) {
      const side = dq > 0 ? 'BUY YES' : 'BUY NO';
      console.log(`[Trade] ${timestamp} | dq=${dq.toFixed(1)} E=${edge.toFixed(3)} | Bal=$${this.balance.toFixed(2)} | Pos: YES=${this.position.yesShares} NO=${this.position.noShares}`);
    }

    if (dq > 0) {
      // Need more YES exposure
      if (this.position.noShares > 0) {
        // First: sell NO (unwind)
        const sellQty = Math.min(this.position.noShares, tradeQuantity);
        // For SELL: place at ask (maker) - will fill when someone buys at our price
        const sellPrice = pricePoint.noAsk ?? pricePoint.noPrice;
        if (executionMode === 'limit') {
          this.createLimitOrder('SELL', 'NO', sellPrice, sellQty, pricePoint, `Unwind NO (E=${edge.toFixed(3)})`);
        } else {
          this.sellPosition('NO', sellQty, pricePoint, `Unwind NO (E=${edge.toFixed(3)})`);
        }
      }
      const remainingQty = tradeQuantity - Math.min(this.position.noShares, tradeQuantity);
      if (remainingQty > 0) {
        // Then: buy YES
        // For BUY: place at bid (maker) - will fill when someone sells at our price
        const buyPrice = pricePoint.yesBid ?? pricePoint.yesPrice;
        if (executionMode === 'limit') {
          this.createLimitOrder('BUY', 'YES', buyPrice, remainingQty, pricePoint, `Buy YES (E=${edge.toFixed(3)})`);
        } else {
          this.buyPosition('YES', remainingQty, pricePoint, `Buy YES (E=${edge.toFixed(3)})`);
        }
      }
    } else if (dq < 0) {
      // Need more NO exposure (or less YES)
      if (this.position.yesShares > 0) {
        // First: sell YES (unwind)
        const sellQty = Math.min(this.position.yesShares, tradeQuantity);
        // For SELL: place at ask (maker) - will fill when someone buys at our price
        const sellPrice = pricePoint.yesAsk ?? pricePoint.yesPrice;
        if (executionMode === 'limit') {
          this.createLimitOrder('SELL', 'YES', sellPrice, sellQty, pricePoint, `Unwind YES (E=${edge.toFixed(3)})`);
        } else {
          this.sellPosition('YES', sellQty, pricePoint, `Unwind YES (E=${edge.toFixed(3)})`);
        }
      }
      const remainingQty = tradeQuantity - Math.min(this.position.yesShares, tradeQuantity);
      if (remainingQty > 0) {
        // Then: buy NO
        // For BUY: place at bid (maker) - will fill when someone sells at our price
        const buyPrice = pricePoint.noBid ?? pricePoint.noPrice;
        if (executionMode === 'limit') {
          this.createLimitOrder('BUY', 'NO', buyPrice, remainingQty, pricePoint, `Buy NO (E=${edge.toFixed(3)})`);
        } else {
          this.buyPosition('NO', remainingQty, pricePoint, `Buy NO (E=${edge.toFixed(3)})`);
        }
      }
    }

    // Record decision time (note: in limit mode, fills happen later)
    this.state.recordDecision(botId, pricePoint.timestamp);

    // For immediate mode, record fill time
    if (executionMode === 'immediate') {
      this.state.recordFill(botId, pricePoint.timestamp);
    }

    // Update direction based on current position (may change after limit fills)
    const newDirection = this.position.yesShares > this.position.noShares
      ? 'LONG_YES'
      : this.position.noShares > this.position.yesShares
        ? 'LONG_NO'
        : 'FLAT';
    this.state.updateDirection(botId, newDirection, pricePoint.timestamp);
  }

  /**
   * Validate a trade before execution (optional, enabled via config.validateTrades)
   * Returns true if the trade is valid, false otherwise
   */
  private validateTrade(
    side: 'BUY' | 'SELL',
    outcome: 'YES' | 'NO',
    quantity: number,
    price: number
  ): boolean {
    // Basic validation
    if (quantity <= 0) {
      if (this.config.verbose) {
        console.log(`[Validation] Invalid quantity: ${quantity}`);
      }
      return false;
    }
    if (price <= 0 || price >= 1) {
      if (this.config.verbose) {
        console.log(`[Validation] Invalid price: ${price} (must be 0 < price < 1)`);
      }
      return false;
    }

    // Buy-specific validation
    if (side === 'BUY') {
      const cost = price * quantity;
      if (cost > this.balance) {
        if (this.config.verbose) {
          console.log(`[Validation] Insufficient balance: need $${cost.toFixed(2)}, have $${this.balance.toFixed(2)}`);
        }
        return false;
      }
    }

    // Sell-specific validation
    if (side === 'SELL') {
      const shares = outcome === 'YES' ? this.position.yesShares : this.position.noShares;
      if (quantity > shares) {
        if (this.config.verbose) {
          console.log(`[Validation] Cannot sell ${quantity} ${outcome}, only have ${shares}`);
        }
        return false;
      }
    }

    return true;
  }

  /**
   * Buy shares of an outcome
   *
   * Uses ask price (what you pay to buy) from snapshot data when available,
   * falling back to VWAP tick price if no snapshot data.
   */
  private buyPosition(
    outcome: 'YES' | 'NO',
    quantity: number,
    pricePoint: ConsensusPricePoint,
    reason: string
  ): void {
    // Use ask price for buys (what you pay to buy)
    // Fall back to VWAP if snapshot data not available
    let price: number;
    if (outcome === 'YES') {
      price = pricePoint.yesAsk ?? pricePoint.yesPrice;
    } else {
      price = pricePoint.noAsk ?? pricePoint.noPrice;
    }
    const originalQuantity = quantity;

    // Enforce Q_max position limit
    const currentShares = outcome === 'YES' ? this.position.yesShares : this.position.noShares;
    const maxAllowed = this.strategyConfig.Q_max - currentShares;
    if (maxAllowed <= 0) {
      if (this.config.verbose) {
        console.log(`[Backtest] Position at limit: ${outcome}=${currentShares}, Q_max=${this.strategyConfig.Q_max}`);
      }
      return; // Already at position limit
    }
    quantity = Math.min(quantity, maxAllowed);

    const cost = price * quantity;

    if (cost > this.balance) {
      // Can't afford, buy what we can
      quantity = Math.floor(this.balance / price);
      if (quantity <= 0) return;
    }

    // Log when position was capped
    if (this.config.verbose && quantity < originalQuantity) {
      const reason = quantity < maxAllowed ? 'balance' : 'Q_max';
      console.log(`[Backtest] Position capped by ${reason}: wanted ${originalQuantity}, allowed ${quantity}`);
    }

    this.balance -= price * quantity;

    if (outcome === 'YES') {
      const totalCost = this.position.yesAvgEntry * this.position.yesShares + price * quantity;
      this.position.yesShares += quantity;
      this.position.yesAvgEntry = this.position.yesShares > 0 ? totalCost / this.position.yesShares : 0;
    } else {
      const totalCost = this.position.noAvgEntry * this.position.noShares + price * quantity;
      this.position.noShares += quantity;
      this.position.noAvgEntry = this.position.noShares > 0 ? totalCost / this.position.noShares : 0;
    }

    this.position.netPosition = this.position.yesShares - this.position.noShares;

    // Optional validation (useful for debugging)
    if (this.config.validateTrades && !this.validateTrade('BUY', outcome, quantity, price)) {
      console.error(`[Backtest] Trade validation failed for BUY ${outcome} qty=${quantity} @ ${price}`);
    }

    // Verbose trade logging
    if (this.config.verbose) {
      console.log(`[Trade] BUY ${outcome} qty=${quantity} @ ${price.toFixed(4)} | Balance: $${this.balance.toFixed(2)} | Pos: YES=${this.position.yesShares} NO=${this.position.noShares}`);
    }

    this.trades.push({
      id: uuidv4(),
      timestamp: new Date(pricePoint.timestamp).toISOString(),
      side: 'BUY',
      outcome,
      price,
      quantity,
      value: price * quantity,
      pnl: 0, // PnL calculated on sell
      reason,
      sessionId: pricePoint.sessionId,
    });
  }

  /**
   * Sell shares of an outcome
   *
   * Uses bid price (what you receive when selling) from snapshot data when available,
   * falling back to VWAP tick price if no snapshot data.
   */
  private sellPosition(
    outcome: 'YES' | 'NO',
    quantity: number,
    pricePoint: ConsensusPricePoint,
    reason: string
  ): void {
    // Use bid price for sells (what you receive when selling)
    // Fall back to VWAP if snapshot data not available
    let price: number;
    if (outcome === 'YES') {
      price = pricePoint.yesBid ?? pricePoint.yesPrice;
    } else {
      price = pricePoint.noBid ?? pricePoint.noPrice;
    }

    if (outcome === 'YES') {
      quantity = Math.min(quantity, this.position.yesShares);
      if (quantity <= 0) return;

      const pnl = (price - this.position.yesAvgEntry) * quantity;
      this.balance += price * quantity;
      this.position.yesShares -= quantity;
      if (this.position.yesShares === 0) {
        this.position.yesAvgEntry = 0;
      }

      // Verbose trade logging
      if (this.config.verbose) {
        const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
        console.log(`[Trade] SELL ${outcome} qty=${quantity} @ ${price.toFixed(4)} PnL=${pnlStr} | Balance: $${this.balance.toFixed(2)} | Pos: YES=${this.position.yesShares} NO=${this.position.noShares}`);
      }

      this.trades.push({
        id: uuidv4(),
        timestamp: new Date(pricePoint.timestamp).toISOString(),
        side: 'SELL',
        outcome,
        price,
        quantity,
        value: price * quantity,
        pnl,
        reason,
        sessionId: pricePoint.sessionId,
      });
    } else {
      quantity = Math.min(quantity, this.position.noShares);
      if (quantity <= 0) return;

      const pnl = (price - this.position.noAvgEntry) * quantity;
      this.balance += price * quantity;
      this.position.noShares -= quantity;
      if (this.position.noShares === 0) {
        this.position.noAvgEntry = 0;
      }

      // Verbose trade logging
      if (this.config.verbose) {
        const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
        console.log(`[Trade] SELL ${outcome} qty=${quantity} @ ${price.toFixed(4)} PnL=${pnlStr} | Balance: $${this.balance.toFixed(2)} | Pos: YES=${this.position.yesShares} NO=${this.position.noShares}`);
      }

      this.trades.push({
        id: uuidv4(),
        timestamp: new Date(pricePoint.timestamp).toISOString(),
        side: 'SELL',
        outcome,
        price,
        quantity,
        value: price * quantity,
        pnl,
        reason,
        sessionId: pricePoint.sessionId,
      });
    }

    this.position.netPosition = this.position.yesShares - this.position.noShares;
  }

  /**
   * Close all positions at end of backtest
   * Also expires any unfilled pending orders
   */
  private closeAllPositions(pricePoint: ConsensusPricePoint): void {
    // Expire unfilled pending orders
    for (const order of this.pendingOrders) {
      if (order.quantity - order.filledQuantity > 0) {
        this.expiredOrderCount++;
        if (this.config.verbose) {
          const unfilled = order.quantity - order.filledQuantity;
          console.log(`[Order Expired] ${order.side} ${order.outcome} qty=${unfilled.toFixed(1)} @ ${order.price.toFixed(4)} (${order.reason})`);
        }
      }
    }
    this.pendingOrders = [];

    // Close positions
    if (this.position.yesShares > 0) {
      this.sellPosition('YES', this.position.yesShares, pricePoint, 'End of backtest');
    }
    if (this.position.noShares > 0) {
      this.sellPosition('NO', this.position.noShares, pricePoint, 'End of backtest');
    }
  }

  // ============================================================================
  // Limit Order Simulation Methods
  // ============================================================================

  /**
   * Create a limit order (limit mode) or execute immediately (immediate mode)
   *
   * In limit mode:
   * - Marketable orders (crossing spread) fill immediately if fillMarketableImmediately is true
   * - Otherwise, creates a pending order that fills when ticks cross the price
   *
   * @param side - BUY or SELL
   * @param outcome - YES or NO
   * @param price - Limit price
   * @param quantity - Quantity to trade
   * @param pricePoint - Current market state
   * @param reason - Reason for trade
   */
  private createLimitOrder(
    side: 'BUY' | 'SELL',
    outcome: 'YES' | 'NO',
    price: number,
    quantity: number,
    pricePoint: ConsensusPricePoint,
    reason: string
  ): void {
    const executionMode = this.config.executionMode ?? 'limit';
    const fillMarketableImmediately = this.config.fillMarketableImmediately ?? true;

    // In immediate mode, execute directly at the price
    if (executionMode === 'immediate') {
      if (side === 'BUY') {
        this.buyPosition(outcome, quantity, pricePoint, reason);
      } else {
        this.sellPosition(outcome, quantity, pricePoint, reason);
      }
      return;
    }

    // Limit mode: check if order is marketable
    const snapshot = this.getNearestSnapshot(pricePoint.timestamp);

    if (fillMarketableImmediately && snapshot) {
      const fillPrice = getMarketableFillPrice(side, price, snapshot, outcome);

      if (fillPrice !== null) {
        // Marketable order - fill immediately at the market price
        if (this.config.verbose) {
          console.log(`[Marketable Order] ${side} ${outcome} qty=${quantity.toFixed(1)} @ ${price.toFixed(4)} fills at ${fillPrice.toFixed(4)}`);
        }
        this.totalOrdersCreated++;
        this.filledOrderCount++;

        // Create modified price point with fill price
        const fillPricePoint = this.createPricePointWithPrice(pricePoint, fillPrice, outcome);

        if (side === 'BUY') {
          this.buyPosition(outcome, quantity, fillPricePoint, `${reason} [FILLED MARKET]`);
        } else {
          this.sellPosition(outcome, quantity, fillPricePoint, `${reason} [FILLED MARKET]`);
        }
        return;
      }
    }

    // Create pending limit order
    const orderId = uuidv4();
    this.totalOrdersCreated++;

    const order: BacktestPendingOrder = {
      id: orderId,
      side,
      outcome,
      price,
      quantity,
      filledQuantity: 0,
      createdAt: pricePoint.timestamp,
      sessionId: pricePoint.sessionId,
      reason,
    };

    this.pendingOrders.push(order);

    if (this.config.verbose) {
      console.log(`[Pending Order] ${side} ${outcome} qty=${quantity.toFixed(1)} @ ${price.toFixed(4)} (${reason})`);
    }
  }

  /**
   * Create a modified price point with a specific execution price
   */
  private createPricePointWithPrice(
    original: ConsensusPricePoint,
    price: number,
    outcome: 'YES' | 'NO'
  ): ConsensusPricePoint {
    const result = { ...original };
    if (outcome === 'YES') {
      result.yesPrice = price;
      result.yesBid = price;
      result.yesAsk = price;
    } else {
      result.noPrice = price;
      result.noBid = price;
      result.noAsk = price;
    }
    return result;
  }

  /**
   * Process pending orders against historical ticks
   *
   * Called at each price point to check if any pending orders would have filled
   * based on ticks that occurred since the last evaluation.
   *
   * @param startTime - Start of tick window (Unix ms)
   * @param endTime - End of tick window (Unix ms)
   * @param pricePoint - Current market state for trade recording
   */
  private processPendingOrderFills(
    startTime: number,
    endTime: number,
    pricePoint: ConsensusPricePoint
  ): void {
    if (this.pendingOrders.length === 0) return;

    // Get fills from tick scanning
    const fills = processTicksForFills(
      this.pendingOrders,
      this.allTicks,
      startTime,
      endTime
    );

    // Apply each fill
    for (const fill of fills) {
      this.applyFill(fill, pricePoint);
    }

    // Remove fully filled orders
    this.pendingOrders = this.pendingOrders.filter(
      (o) => o.quantity - o.filledQuantity > 0
    );
  }

  /**
   * Apply a fill to update position and create trade record
   */
  private applyFill(fill: BacktestFill, pricePoint: ConsensusPricePoint): void {
    const order = this.pendingOrders.find((o) => o.id === fill.orderId);
    if (!order) return;

    // Update order state
    order.filledQuantity += fill.fillQuantity;

    if (fill.isFullyFilled) {
      this.filledOrderCount++;
    }

    // Create price point with fill price
    const fillPricePoint = this.createPricePointWithPrice(
      { ...pricePoint, timestamp: fill.timestamp },
      fill.fillPrice,
      order.outcome
    );

    if (this.config.verbose) {
      console.log(`[Fill] ${order.side} ${order.outcome} qty=${fill.fillQuantity.toFixed(1)} @ ${fill.fillPrice.toFixed(4)} (${fill.isFullyFilled ? 'FULL' : 'PARTIAL'})`);
    }

    // Execute the trade at fill price
    if (order.side === 'BUY') {
      this.buyPosition(
        order.outcome,
        fill.fillQuantity,
        fillPricePoint,
        `${order.reason} [FILLED LIMIT]`
      );
    } else {
      this.sellPosition(
        order.outcome,
        fill.fillQuantity,
        fillPricePoint,
        `${order.reason} [FILLED LIMIT]`
      );
    }
  }

  /**
   * Update balance history with current equity
   *
   * Uses bid prices for conservative mark-to-market (liquidation value).
   * This gives a more realistic drawdown calculation since positions
   * would be sold at bid, not mid-market.
   */
  private updateBalanceHistory(pricePoint: ConsensusPricePoint): void {
    // Use bid prices for conservative mark-to-market (liquidation value)
    const yesPrice = pricePoint.yesBid ?? pricePoint.yesPrice;
    const noPrice = pricePoint.noBid ?? pricePoint.noPrice;

    const yesValue = this.position.yesShares * yesPrice;
    const noValue = this.position.noShares * noPrice;
    const equity = this.balance + yesValue + noValue;

    // Only record periodically to avoid massive arrays
    const lastSnapshot = this.balanceHistory[this.balanceHistory.length - 1];
    if (!lastSnapshot || pricePoint.timestamp - lastSnapshot.timestamp >= 5000) {
      this.balanceHistory.push({
        timestamp: pricePoint.timestamp,
        balance: this.balance,
        equity,
      });
    }
  }

  /**
   * Calculate breakdown by session
   */
  private calculateSessionBreakdown(): SessionBreakdown[] {
    return this.sessions.map((session) => {
      const sessionTrades = this.trades.filter((t) => t.sessionId === session.id);
      const sellTrades = sessionTrades.filter((t) => t.side === 'SELL');
      const pnl = sellTrades.reduce((sum, t) => sum + t.pnl, 0);
      const winners = sellTrades.filter((t) => t.pnl > 0).length;
      const winRate = sellTrades.length > 0 ? (winners / sellTrades.length) * 100 : 0;

      const startTime = new Date(session.start_time).getTime();
      const endTime = new Date(session.end_time).getTime();
      const durationMinutes = (endTime - startTime) / (1000 * 60);

      return {
        sessionId: session.id,
        marketName: session.market_name,
        pnl,
        tradeCount: sessionTrades.length,
        winRate,
        durationMinutes,
      };
    });
  }
}

/**
 * Run a single backtest with the given configuration
 */
export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const engine = new BacktestEngine(config);
  return engine.run();
}
