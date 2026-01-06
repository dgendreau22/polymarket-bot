/**
 * Decision Engine
 *
 * Implements the priority-based decision logic for the arbitrage strategy:
 * - Priority 0: Close-out mode (force hedge in last 10% of time)
 * - Priority 1: Balance lagging leg (when one leg has position)
 * - Priority 2: Round-robin entry (alternate YES/NO for balanced accumulation)
 */

import type { ArbitrageConfig } from './ArbitrageConfig';
import type { ArbitrageState } from './ArbitrageState';
import type { PositionAnalysis } from './PositionAnalyzer';
import type { PriceValidator } from './PriceValidator';

/**
 * Market data for both legs
 */
export interface MarketData {
  yes: { bestBid: number; bestAsk: number };
  no: { bestBid: number; bestAsk: number };
  potentialProfit: number;
  isValid: boolean;
}

/**
 * Trade decision from the engine
 */
export interface TradeDecision {
  leg: 'YES' | 'NO';
  aggressive: boolean;
  orderSize: number;
}

/**
 * Decision engine for arbitrage strategy
 */
export class DecisionEngine {
  constructor(
    private config: ArbitrageConfig,
    private state: ArbitrageState,
    private validator: PriceValidator
  ) {}

  /**
   * Main entry point - returns a trade decision or null
   */
  decide(
    botId: string,
    analysis: PositionAnalysis,
    marketData: MarketData,
    timeProgress: number,
    scaledMaxPosition: number
  ): TradeDecision | null {
    const isCloseOutMode = timeProgress >= this.config.closeOutThreshold;
    const effectiveCooldown = isCloseOutMode
      ? this.config.closeOutCooldownMs
      : this.config.normalCooldownMs;

    // Check if both legs on cooldown (skip cycle)
    if (this.state.areBothOnCooldown(botId, effectiveCooldown) && !isCloseOutMode) {
      return null;
    }

    // PRIORITY 0: Close-out mode
    if (isCloseOutMode && analysis.sizeDiff > 0) {
      const decision = this.tryCloseOutDecision(botId, analysis, marketData, effectiveCooldown);
      if (decision) return decision;
    }

    // PRIORITY 1: Balance lagging leg
    if (analysis.totalSize > 0) {
      const decision = this.tryBalanceDecision(
        botId, analysis, marketData, scaledMaxPosition, effectiveCooldown, isCloseOutMode
      );
      if (decision) return decision;
    }

    // PRIORITY 2: Round-robin entry
    return this.tryEntryDecision(
      botId, analysis, marketData, scaledMaxPosition, effectiveCooldown, isCloseOutMode
    );
  }

  /**
   * Priority 0: Force hedge the lagging leg in close-out mode
   */
  private tryCloseOutDecision(
    botId: string,
    analysis: PositionAnalysis,
    marketData: MarketData,
    cooldownMs: number
  ): TradeDecision | null {
    const leg = analysis.laggingLeg;

    if (!this.canBuyLeg(botId, leg, analysis, true, cooldownMs, 0)) {
      return null;
    }

    // Use multiplied order size (capped at remaining imbalance)
    const closeOutSize = Math.min(
      analysis.sizeDiff,
      this.config.orderSize * this.config.closeOutOrderMultiplier
    );
    const closeOutPrice = leg === 'YES' ? marketData.yes.bestAsk : marketData.no.bestAsk;
    const otherAvg = leg === 'YES' ? analysis.noAvg : analysis.yesAvg;

    // Check price ceiling even in close-out mode
    if (!this.validator.isLegPriceAcceptable(leg, closeOutPrice, otherAvg)) {
      console.log(`[Arb] CLOSE-OUT: Skipping ${leg} - price ${closeOutPrice.toFixed(3)} too high`);
      return null;
    }

    console.log(`[Arb] CLOSE-OUT: Buying ${closeOutSize.toFixed(0)} ${leg} to hedge (imbalance=${analysis.sizeDiff.toFixed(0)})`);

    this.state.recordOrder(botId, leg);
    return { leg, aggressive: true, orderSize: closeOutSize };
  }

  /**
   * Priority 1: Balance the lagging leg
   */
  private tryBalanceDecision(
    botId: string,
    analysis: PositionAnalysis,
    marketData: MarketData,
    scaledMaxPosition: number,
    cooldownMs: number,
    isCloseOutMode: boolean
  ): TradeDecision | null {
    const leg = analysis.laggingLeg;

    if (!this.canBuyLeg(botId, leg, analysis, isCloseOutMode, cooldownMs, scaledMaxPosition)) {
      return null;
    }

    const prices = leg === 'YES' ? marketData.yes : marketData.no;
    const buyPrice = analysis.isLargeImbalance ? prices.bestAsk : prices.bestBid;
    const otherAvg = leg === 'YES' ? analysis.noAvg : analysis.yesAvg;

    // Check price ceiling
    if (!this.validator.isLegPriceAcceptable(leg, buyPrice, otherAvg)) {
      return null;
    }

    // Check profitability
    if (!this.validator.wouldCostBeValid(analysis, leg, this.config.orderSize, buyPrice)) {
      console.log(`[Arb] Skipping ${leg} buy - would push combined avg >= $${this.config.profitThreshold}`);
      return null;
    }

    this.state.recordOrder(botId, leg);
    return { leg, aggressive: analysis.isLargeImbalance, orderSize: this.config.orderSize };
  }

  /**
   * Priority 2: Round-robin entry (alternate YES/NO)
   */
  private tryEntryDecision(
    botId: string,
    analysis: PositionAnalysis,
    marketData: MarketData,
    scaledMaxPosition: number,
    cooldownMs: number,
    isCloseOutMode: boolean
  ): TradeDecision | null {
    const firstLeg = this.state.getNextLegRoundRobin(botId);
    const secondLeg: 'YES' | 'NO' = firstLeg === 'YES' ? 'NO' : 'YES';

    // Try first leg (opposite of last bought)
    const firstDecision = this.tryLegEntry(
      botId, firstLeg, analysis, marketData, scaledMaxPosition, cooldownMs, isCloseOutMode
    );
    if (firstDecision) return firstDecision;

    // Try second leg (fallback)
    return this.tryLegEntry(
      botId, secondLeg, analysis, marketData, scaledMaxPosition, cooldownMs, isCloseOutMode
    );
  }

  /**
   * Try to enter a specific leg
   */
  private tryLegEntry(
    botId: string,
    leg: 'YES' | 'NO',
    analysis: PositionAnalysis,
    marketData: MarketData,
    scaledMaxPosition: number,
    cooldownMs: number,
    isCloseOutMode: boolean
  ): TradeDecision | null {
    if (!this.canBuyLeg(botId, leg, analysis, isCloseOutMode, cooldownMs, scaledMaxPosition)) {
      return null;
    }

    const prices = leg === 'YES' ? marketData.yes : marketData.no;
    const buyPrice = prices.bestBid;
    const otherAvg = leg === 'YES' ? analysis.noAvg : analysis.yesAvg;

    // Check price ceiling
    if (!this.validator.isLegPriceAcceptable(leg, buyPrice, otherAvg)) {
      return null;
    }

    // Check profitability
    if (!this.validator.wouldCostBeValid(analysis, leg, this.config.orderSize, buyPrice)) {
      return null;
    }

    this.state.recordOrder(botId, leg);
    return { leg, aggressive: false, orderSize: this.config.orderSize };
  }

  /**
   * Check if a leg can be bought (cooldown + position limits)
   */
  private canBuyLeg(
    botId: string,
    leg: 'YES' | 'NO',
    analysis: PositionAnalysis,
    isCloseOutMode: boolean,
    cooldownMs: number,
    scaledMaxPosition: number
  ): boolean {
    const isLagging = leg === analysis.laggingLeg;

    // Check cooldown (bypass for lagging leg in close-out mode)
    const onCooldown = this.state.isOnCooldown(botId, leg, cooldownMs);
    if (onCooldown && !(isCloseOutMode && isLagging)) {
      return false;
    }

    // Position limit check
    // Lagging leg can always buy (reduces imbalance)
    // Leading leg blocked if it would increase diff beyond scaledMaxPosition
    if (isLagging) {
      return true;
    }

    // Check position limits for leading leg
    const newDiff = leg === 'YES' ? analysis.newDiffIfBuyYes : analysis.newDiffIfBuyNo;
    const newFilledDiff = leg === 'YES' ? analysis.newFilledDiffIfBuyYes : analysis.newFilledDiffIfBuyNo;

    if (newDiff > scaledMaxPosition || newFilledDiff > scaledMaxPosition) {
      return false;
    }

    return true;
  }
}
