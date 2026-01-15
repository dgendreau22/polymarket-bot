/**
 * Consensus Price Calculator
 *
 * Calculates spread-weighted consensus price from YES and NO order books.
 * The consensus price reduces temporary inconsistencies between books.
 *
 * Formula (from spec lines 18-34):
 * - mid_yes = (bid_yes + ask_yes) / 2
 * - mid_no = (bid_no + ask_no) / 2
 * - p_from_no = 1 - mid_no
 * - Weights: w = 1 / (spread + epsilon)
 * - Consensus: p_t = (w_yes * mid_yes + w_no * p_from_no) / (w_yes + w_no)
 */

export interface ConsensusResult {
  /** Weighted consensus probability for YES */
  consensusPrice: number;
  /** YES book spread (ask - bid) */
  spread_yes: number;
  /** NO book spread (ask - bid) */
  spread_no: number;
  /** Minimum spread: min(spread_yes, spread_no) */
  spread_c: number;
  /** True if calculation succeeded */
  isValid: boolean;
}

export class ConsensusPriceCalculator {
  /** Small epsilon to prevent division by zero */
  private readonly EPSILON_S = 1e-6;

  /**
   * Calculate consensus price from YES and NO book prices
   */
  calculate(
    yesPrices: { bestBid: number; bestAsk: number } | undefined,
    noPrices: { bestBid: number; bestAsk: number } | undefined
  ): ConsensusResult {
    // Handle missing data
    if (!yesPrices || !noPrices) {
      return {
        consensusPrice: 0.5,
        spread_yes: 1,
        spread_no: 1,
        spread_c: 1,
        isValid: false,
      };
    }

    // Validate prices are reasonable
    if (
      yesPrices.bestBid <= 0 ||
      yesPrices.bestAsk <= 0 ||
      noPrices.bestBid <= 0 ||
      noPrices.bestAsk <= 0
    ) {
      return {
        consensusPrice: 0.5,
        spread_yes: 1,
        spread_no: 1,
        spread_c: 1,
        isValid: false,
      };
    }

    // Calculate mid prices
    const mid_yes = this.getMidPrice(yesPrices.bestBid, yesPrices.bestAsk);
    const mid_no = this.getMidPrice(noPrices.bestBid, noPrices.bestAsk);
    const p_from_no = 1 - mid_no;

    // Calculate spreads
    const spread_yes = yesPrices.bestAsk - yesPrices.bestBid;
    const spread_no = noPrices.bestAsk - noPrices.bestBid;
    const spread_c = Math.min(spread_yes, spread_no);

    // Calculate weights (tighter spread = higher weight)
    const w_yes = this.calculateWeight(spread_yes);
    const w_no = this.calculateWeight(spread_no);

    // Calculate weighted consensus
    const consensusPrice = (w_yes * mid_yes + w_no * p_from_no) / (w_yes + w_no);

    // Clamp to valid probability range
    const clampedPrice = Math.max(0.01, Math.min(0.99, consensusPrice));

    return {
      consensusPrice: clampedPrice,
      spread_yes,
      spread_no,
      spread_c,
      isValid: true,
    };
  }

  /**
   * Calculate mid price from bid and ask
   */
  private getMidPrice(bid: number, ask: number): number {
    return (bid + ask) / 2;
  }

  /**
   * Calculate weight from spread (tighter spread = higher weight)
   */
  private calculateWeight(spread: number): number {
    return 1 / (spread + this.EPSILON_S);
  }
}
