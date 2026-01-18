/**
 * Backtest Engine
 *
 * Replays recorded market data against the Time Above 50 strategy to simulate trading.
 *
 * Key features:
 * - Loads ticks from recording sessions
 * - Calculates consensus price from YES/NO ticks (1-second VWAP windows)
 * - Runs strategy signal calculation
 * - Simulates position execution (fills at tick price, no slippage)
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
import type {
  BacktestConfig,
  BacktestResult,
  BacktestTrade,
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
    const ticks = this.loadTicks();
    if (ticks.length === 0) {
      throw new Error('No ticks found in selected sessions');
    }

    // Convert ticks to consensus prices
    this.consensusPrices = this.calculateConsensusPrices(ticks);
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
   */
  private loadSnapshots(): void {
    const sessionIds = this.sessions.map((s) => s.id);
    const rawSnapshots = getSnapshotsForSessions(sessionIds);

    this.snapshots = [];
    this.snapshotTimestamps = [];

    for (const row of rawSnapshots) {
      const timestamp = new Date(row.timestamp).getTime();

      // Parse bid/ask values, skip if any are missing
      const yesBid = row.yes_best_bid ? parseFloat(row.yes_best_bid) : null;
      const yesAsk = row.yes_best_ask ? parseFloat(row.yes_best_ask) : null;
      const noBid = row.no_best_bid ? parseFloat(row.no_best_bid) : null;
      const noAsk = row.no_best_ask ? parseFloat(row.no_best_ask) : null;

      // Skip incomplete snapshots
      if (yesBid === null || yesAsk === null || noBid === null || noAsk === null) {
        continue;
      }
      if (yesBid <= 0 || yesAsk <= 0 || noBid <= 0 || noAsk <= 0) {
        continue;
      }

      // Calculate spreads
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
   * Calculate consensus prices from YES/NO ticks
   *
   * Groups ticks into 1-second windows and calculates VWAP for each outcome.
   * Consensus = (YES_VWAP + (1 - NO_VWAP)) / 2
   */
  private calculateConsensusPrices(ticks: ProcessedTick[]): ConsensusPricePoint[] {
    const result: ConsensusPricePoint[] = [];
    const windowMs = 1000; // 1 second windows

    // Group ticks by time window
    let windowStart = ticks[0].timestamp;
    let windowTicks: ProcessedTick[] = [];

    for (const tick of ticks) {
      if (tick.timestamp >= windowStart + windowMs) {
        // Process current window
        const consensus = this.processWindow(windowTicks, windowStart);
        if (consensus) {
          result.push(consensus);
        }

        // Start new window
        windowStart = tick.timestamp;
        windowTicks = [];
      }
      windowTicks.push(tick);
    }

    // Process final window
    if (windowTicks.length > 0) {
      const consensus = this.processWindow(windowTicks, windowStart);
      if (consensus) {
        result.push(consensus);
      }
    }

    return result;
  }

  /**
   * Process a window of ticks to get consensus price
   *
   * Enriches with snapshot bid/ask data when available for:
   * - Spread-weighted consensus price
   * - Realistic fill prices (buy at ask, sell at bid)
   */
  private processWindow(
    ticks: ProcessedTick[],
    timestamp: number
  ): ConsensusPricePoint | null {
    const yesTicks = ticks.filter((t) => t.outcome === 'YES');
    const noTicks = ticks.filter((t) => t.outcome === 'NO');

    // Calculate VWAP for YES
    let yesPrice: number | null = null;
    if (yesTicks.length > 0) {
      const totalValue = yesTicks.reduce((sum, t) => sum + t.price * (t.size || 1), 0);
      const totalSize = yesTicks.reduce((sum, t) => sum + (t.size || 1), 0);
      yesPrice = totalValue / totalSize;
    }

    // Calculate VWAP for NO
    let noPrice: number | null = null;
    if (noTicks.length > 0) {
      const totalValue = noTicks.reduce((sum, t) => sum + t.price * (t.size || 1), 0);
      const totalSize = noTicks.reduce((sum, t) => sum + (t.size || 1), 0);
      noPrice = totalValue / totalSize;
    }

    // Try to get snapshot data for this timestamp
    const snapshot = this.getNearestSnapshot(timestamp);

    // Calculate consensus price
    let result: ConsensusPricePoint | null = null;

    if (yesPrice !== null && noPrice !== null) {
      // Use spread-weighted consensus if snapshot available, else simple average
      const consensus = snapshot?.consensusPrice ?? (yesPrice + (1 - noPrice)) / 2;
      result = {
        timestamp,
        price: consensus,
        yesPrice,
        noPrice,
        sessionId: ticks[0].sessionId,
      };
    } else if (yesPrice !== null) {
      result = {
        timestamp,
        price: snapshot?.consensusPrice ?? yesPrice,
        yesPrice,
        noPrice: 1 - yesPrice,
        sessionId: ticks[0].sessionId,
      };
    } else if (noPrice !== null) {
      result = {
        timestamp,
        price: snapshot?.consensusPrice ?? (1 - noPrice),
        yesPrice: 1 - noPrice,
        noPrice,
        sessionId: ticks[0].sessionId,
      };
    }

    // Enrich with snapshot bid/ask data if available
    if (result && snapshot) {
      result.yesBid = snapshot.yesBid;
      result.yesAsk = snapshot.yesAsk;
      result.noBid = snapshot.noBid;
      result.noAsk = snapshot.noAsk;
      result.yesSpread = snapshot.yesSpread;
      result.noSpread = snapshot.noSpread;
    }

    return result;
  }

  /**
   * Process a single consensus price point through the strategy
   */
  private processConsensusPricePoint(
    botId: string,
    pricePoint: ConsensusPricePoint
  ): void {
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
   */
  private executeTrades(
    botId: string,
    pricePoint: ConsensusPricePoint,
    dq: number,
    edge: number
  ): void {
    const timestamp = new Date(pricePoint.timestamp).toISOString();
    const tradeQuantity = Math.abs(dq);

    if (dq > 0) {
      // Need more YES exposure
      if (this.position.noShares > 0) {
        // First: sell NO (unwind)
        const sellQty = Math.min(this.position.noShares, tradeQuantity);
        this.sellPosition('NO', sellQty, pricePoint, `Unwind NO (E=${edge.toFixed(3)})`);
      }
      const remainingQty = tradeQuantity - Math.min(this.position.noShares, tradeQuantity);
      if (remainingQty > 0) {
        // Then: buy YES
        this.buyPosition('YES', remainingQty, pricePoint, `Buy YES (E=${edge.toFixed(3)})`);
      }
    } else if (dq < 0) {
      // Need more NO exposure (or less YES)
      if (this.position.yesShares > 0) {
        // First: sell YES (unwind)
        const sellQty = Math.min(this.position.yesShares, tradeQuantity);
        this.sellPosition('YES', sellQty, pricePoint, `Unwind YES (E=${edge.toFixed(3)})`);
      }
      const remainingQty = tradeQuantity - Math.min(this.position.yesShares, tradeQuantity);
      if (remainingQty > 0) {
        // Then: buy NO
        this.buyPosition('NO', remainingQty, pricePoint, `Buy NO (E=${edge.toFixed(3)})`);
      }
    }

    // Record fill time for cooldown
    this.state.recordFill(botId, pricePoint.timestamp);
    this.state.recordDecision(botId, pricePoint.timestamp);

    // Update direction
    const newDirection = this.position.yesShares > this.position.noShares
      ? 'LONG_YES'
      : this.position.noShares > this.position.yesShares
        ? 'LONG_NO'
        : 'FLAT';
    this.state.updateDirection(botId, newDirection, pricePoint.timestamp);
  }

  /**
   * Buy shares of an outcome
   *
   * Uses VWAP tick price for fills. Snapshot bid/ask data is currently inverted
   * (WebSocket returns bids ascending, asks descending) so we use tick prices
   * which are reliable trade execution prices.
   */
  private buyPosition(
    outcome: 'YES' | 'NO',
    quantity: number,
    pricePoint: ConsensusPricePoint,
    reason: string
  ): void {
    // Use VWAP tick price (snapshot bid/ask data is inverted)
    const price = outcome === 'YES' ? pricePoint.yesPrice : pricePoint.noPrice;
    const cost = price * quantity;

    if (cost > this.balance) {
      // Can't afford, buy what we can
      quantity = Math.floor(this.balance / price);
      if (quantity <= 0) return;
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
   * Uses VWAP tick price for fills. Snapshot bid/ask data is currently inverted
   * (WebSocket returns bids ascending, asks descending) so we use tick prices
   * which are reliable trade execution prices.
   */
  private sellPosition(
    outcome: 'YES' | 'NO',
    quantity: number,
    pricePoint: ConsensusPricePoint,
    reason: string
  ): void {
    // Use VWAP tick price (snapshot bid/ask data is inverted)
    const price = outcome === 'YES' ? pricePoint.yesPrice : pricePoint.noPrice;

    if (outcome === 'YES') {
      quantity = Math.min(quantity, this.position.yesShares);
      if (quantity <= 0) return;

      const pnl = (price - this.position.yesAvgEntry) * quantity;
      this.balance += price * quantity;
      this.position.yesShares -= quantity;
      if (this.position.yesShares === 0) {
        this.position.yesAvgEntry = 0;
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
   */
  private closeAllPositions(pricePoint: ConsensusPricePoint): void {
    if (this.position.yesShares > 0) {
      this.sellPosition('YES', this.position.yesShares, pricePoint, 'End of backtest');
    }
    if (this.position.noShares > 0) {
      this.sellPosition('NO', this.position.noShares, pricePoint, 'End of backtest');
    }
  }

  /**
   * Update balance history with current equity
   */
  private updateBalanceHistory(pricePoint: ConsensusPricePoint): void {
    const yesValue = this.position.yesShares * pricePoint.yesPrice;
    const noValue = this.position.noShares * pricePoint.noPrice;
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
