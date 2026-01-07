/**
 * Decision Engine
 *
 * Implements the priority-based decision logic for the arbitrage strategy:
 * - Priority 0: Sell leading leg (when imbalanced, for profit-taking)
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
  side: 'BUY' | 'SELL';
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
    maxPosition: number
  ): TradeDecision | null {
    const cooldownMs = this.config.cooldownMs;

    // Check if both legs on cooldown (skip cycle)
    if (this.state.areBothOnCooldown(botId, cooldownMs)) {
      return null;
    }

    // PRIORITY 0: Sell leading leg (when imbalanced, for profit-taking)
    if (analysis.sizeDiff >= this.config.minImbalanceForSell) {
      const leadingLeg = analysis.leadingLeg;
      // Check cooldown for the leg we'd sell
      if (!this.state.isOnCooldown(botId, leadingLeg, cooldownMs)) {
        const sellDecision = this.trySellLeadingLeg(analysis, marketData);
        if (sellDecision) {
          this.state.recordOrder(botId, sellDecision.leg);  // Record for cooldown
          console.log(`[Arb] REBALANCE: Selling ${sellDecision.orderSize.toFixed(0)} ${sellDecision.leg} to reduce imbalance`);
          return sellDecision;
        }
      }
    }

    // PRIORITY 1: Balance lagging leg
    if (analysis.totalSize > 0) {
      const decision = this.tryBalanceDecision(
        botId, analysis, marketData, maxPosition, cooldownMs
      );
      if (decision) return decision;
    }

    // PRIORITY 2: Round-robin entry
    return this.tryEntryDecision(
      botId, analysis, marketData, maxPosition, cooldownMs
    );
  }

  /**
   * Try to sell the leading leg to reduce exposure (profit-taking)
   * Returns a sell decision if conditions are met, null otherwise
   */
  private trySellLeadingLeg(
    analysis: PositionAnalysis,
    marketData: MarketData
  ): TradeDecision | null {
    const leadingLeg = analysis.leadingLeg;
    const leadingLegBid = leadingLeg === 'YES' ? marketData.yes.bestBid : marketData.no.bestBid;
    const leadingLegFilledSize = leadingLeg === 'YES' ? analysis.yesFilledSize : analysis.noFilledSize;
    const leadingLegAvg = leadingLeg === 'YES' ? analysis.yesFilledAvg : analysis.noFilledAvg;

    // Check if price is above sell threshold
    if (leadingLegBid < this.config.sellThreshold) {
      return null;
    }

    // Check if we have position to sell
    if (leadingLegFilledSize <= 0) {
      return null;
    }

    // Check if selling would be profitable
    if (leadingLegBid <= leadingLegAvg) {
      console.log(`[Arb] Skipping ${leadingLeg} sell - bid ${leadingLegBid.toFixed(3)} <= entry ${leadingLegAvg.toFixed(3)}`);
      return null;
    }

    // Calculate sell size (capped at imbalance, available position, and order size)
    const sellSize = Math.min(
      analysis.sizeDiff,
      leadingLegFilledSize,
      this.config.orderSize
    );

    if (sellSize <= 0) {
      return null;
    }

    return {
      leg: leadingLeg,
      side: 'SELL',
      aggressive: true,
      orderSize: sellSize,
    };
  }

  /**
   * Priority 1: Balance the lagging leg
   */
  private tryBalanceDecision(
    botId: string,
    analysis: PositionAnalysis,
    marketData: MarketData,
    maxPosition: number,
    cooldownMs: number
  ): TradeDecision | null {
    const leg = analysis.laggingLeg;

    if (!this.canBuyLeg(botId, leg, analysis, cooldownMs, maxPosition)) {
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
    return { leg, side: 'BUY', aggressive: analysis.isLargeImbalance, orderSize: this.config.orderSize };
  }

  /**
   * Priority 2: Round-robin entry (alternate YES/NO)
   */
  private tryEntryDecision(
    botId: string,
    analysis: PositionAnalysis,
    marketData: MarketData,
    maxPosition: number,
    cooldownMs: number
  ): TradeDecision | null {
    const firstLeg = this.state.getNextLegRoundRobin(botId);
    const secondLeg: 'YES' | 'NO' = firstLeg === 'YES' ? 'NO' : 'YES';

    // Try first leg (opposite of last bought)
    const firstDecision = this.tryLegEntry(
      botId, firstLeg, analysis, marketData, maxPosition, cooldownMs
    );
    if (firstDecision) return firstDecision;

    // Try second leg (fallback)
    return this.tryLegEntry(
      botId, secondLeg, analysis, marketData, maxPosition, cooldownMs
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
    maxPosition: number,
    cooldownMs: number
  ): TradeDecision | null {
    if (!this.canBuyLeg(botId, leg, analysis, cooldownMs, maxPosition)) {
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
    return { leg, side: 'BUY', aggressive: false, orderSize: this.config.orderSize };
  }

  /**
   * Check if a leg can be bought (cooldown + position limits)
   */
  private canBuyLeg(
    botId: string,
    leg: 'YES' | 'NO',
    analysis: PositionAnalysis,
    cooldownMs: number,
    maxPosition: number
  ): boolean {
    const isLagging = leg === analysis.laggingLeg;

    // Check cooldown
    if (this.state.isOnCooldown(botId, leg, cooldownMs)) {
      return false;
    }

    // Position limit check
    // Lagging leg can always buy (reduces imbalance)
    // Leading leg blocked if it would increase diff beyond maxPosition
    if (isLagging) {
      return true;
    }

    // Check position limits for leading leg
    const newDiff = leg === 'YES' ? analysis.newDiffIfBuyYes : analysis.newDiffIfBuyNo;
    const newFilledDiff = leg === 'YES' ? analysis.newFilledDiffIfBuyYes : analysis.newFilledDiffIfBuyNo;

    if (newDiff > maxPosition || newFilledDiff > maxPosition) {
      return false;
    }

    return true;
  }
}
