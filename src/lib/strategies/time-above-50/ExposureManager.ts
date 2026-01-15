/**
 * Exposure Manager
 *
 * Calculates target exposure (q*) and applies constraints:
 * - Gamma weight: peaks at p=0.50
 * - Hysteresis: E_enter/E_exit thresholds
 * - Gray zone: no expansions allowed
 * - Time flatten: force q*=0 near resolution
 */

import type { TimeAbove50Config } from './TimeAbove50Config';

/** Exposure target and decision */
export interface ExposureTarget {
  /** Target net exposure (q* = inv_yes - inv_no) */
  q_star: number;
  /** Current net exposure */
  q_current: number;
  /** Required adjustment: q* - q */
  dq: number;
  /** True if |dq| >= q_step (should act) */
  shouldAct: boolean;
  /** True if |q*| > |q| (expanding position) */
  isExpanding: boolean;
  /** Effective edge score after hysteresis/flatten */
  E_effective: number;
}

export class ExposureManager {
  constructor(private config: TimeAbove50Config) {}

  /**
   * Calculate target exposure with all constraints
   */
  calculateTarget(
    E: number,
    consensusPrice: number,
    inv_yes: number,
    inv_no: number,
    timeToResolutionMinutes: number
  ): ExposureTarget {
    // Calculate current net exposure
    const q_current = inv_yes - inv_no;

    // Apply hysteresis and time flatten to get effective E
    const E_effective = this.applyConstraints(
      E,
      q_current,
      timeToResolutionMinutes
    );

    // Calculate gamma weight (peaks at p=0.50)
    const g = this.gammaWeight(consensusPrice);

    // Calculate raw target exposure
    const q_star_raw = this.config.Q_max * g * Math.tanh(this.config.k * E_effective);

    // Apply gray zone constraint (no expansions in gray zone)
    const q_star = this.applyGrayZone(E, q_current, q_star_raw);

    // Calculate adjustment
    const dq = q_star - q_current;

    // Check if we should act
    const shouldAct = Math.abs(dq) >= this.config.q_step;

    // Check if expanding
    const isExpanding = Math.abs(q_star) > Math.abs(q_current);

    return {
      q_star,
      q_current,
      dq,
      shouldAct,
      isExpanding,
      E_effective,
    };
  }

  /**
   * Gamma weight function: g(p) = 4*p*(1-p)
   * Peaks at p=0.5 with value 1, drops to 0 at p=0 and p=1
   */
  private gammaWeight(p: number): number {
    return 4 * p * (1 - p);
  }

  /**
   * Apply hysteresis and time flatten constraints
   */
  private applyConstraints(
    E: number,
    q_current: number,
    T_min: number
  ): number {
    let E_eff = E;

    // Hysteresis: if |E| < E_exit, force to zero
    if (Math.abs(E) < this.config.E_exit) {
      E_eff = 0;
    }

    // Time flatten: if T < T_flat and |E| < E_override, force to zero
    if (T_min < this.config.T_flat && Math.abs(E) < this.config.E_override) {
      E_eff = 0;
    }

    return E_eff;
  }

  /**
   * Gray zone constraint: no expansions when E_exit <= |E| < E_enter
   *
   * If in gray zone and new position would be larger, clamp to current
   */
  private applyGrayZone(
    E: number,
    q_current: number,
    q_star_raw: number
  ): number {
    const absE = Math.abs(E);

    // Check if in gray zone
    const inGrayZone = absE >= this.config.E_exit && absE < this.config.E_enter;

    if (inGrayZone) {
      // Only allow reductions, not expansions
      if (Math.abs(q_star_raw) > Math.abs(q_current)) {
        return q_current;
      }
    }

    return q_star_raw;
  }
}
