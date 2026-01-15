/**
 * Signal Calculator
 *
 * Calculates signal components for the TimeAbove50 strategy:
 * - tau: Time-above estimator (exponential decay)
 * - A: Time-above score (2*tau - 1)
 * - dbar: Smoothed displacement (EWMA)
 * - d: Instant displacement (p - 0.5)
 * - Chop metrics: crossing rate and logit volatility
 * - theta: Time-to-resolution scaler
 * - chi: Chop penalty
 * - E: Combined edge score
 */

import type { TimeAbove50Config } from './TimeAbove50Config';
import type { TimeAbove50State, PricePoint } from './TimeAbove50State';

/** Calculated signal components */
export interface SignalComponents {
  /** Updated tau (time-above estimator) */
  tau: number;
  /** Updated dbar (smoothed displacement) */
  dbar: number;
  /** Time-above score: 2*tau - 1, range [-1, 1] */
  A: number;
  /** Instant displacement: p - 0.5 */
  d: number;
  /** Crossing rate (flips/minute around 0.50) */
  cross: number;
  /** Logit volatility */
  sigma: number;
  /** Chop penalty [0, 1] */
  chi: number;
  /** Theta scaler (time-to-resolution) [0, 1] */
  theta: number;
  /** Combined edge score */
  E: number;
  /** True if suppressed by deadband */
  inDeadband: boolean;
}

export class SignalCalculator {
  constructor(private config: TimeAbove50Config) {}

  /**
   * Calculate all signal components
   */
  calculate(
    botId: string,
    state: TimeAbove50State,
    consensusPrice: number,
    spread_c: number,
    timeToResolutionMinutes: number,
    now: number
  ): SignalComponents {
    const botState = state.getState(botId);

    // Calculate time delta from last price point
    const priceHistory = botState.priceHistory;
    let dt = 1.0; // Default 1 second
    if (priceHistory.length >= 2) {
      const lastTime = priceHistory[priceHistory.length - 1]?.timestamp ?? now;
      dt = Math.max(0.001, (now - lastTime) / 1000);
    }

    // Calculate instant displacement
    const d = consensusPrice - 0.5;

    // Update tau (time-above estimator)
    const I = consensusPrice > 0.5 ? 1 : 0;
    const tau = this.updateTau(botState.tau, I, dt);
    state.updateTau(botId, tau);

    // Calculate A (time-above score)
    const A = 2 * tau - 1;

    // Update dbar (smoothed displacement)
    const dbar = this.updateDbar(botState.dbar, d, dt);
    state.updateDbar(botId, dbar);

    // Add current price to history
    state.addPricePoint(botId, now, consensusPrice);

    // Calculate chop metrics
    const recentHistory = state.getPriceHistory(botId, this.config.W_chop_sec, now);
    const { cross, sigma } = this.calculateChop(recentHistory);

    // Calculate theta (time-to-resolution scaler)
    const theta = this.calculateTheta(timeToResolutionMinutes);

    // Calculate chi (chop penalty)
    const chi = this.calculateChopPenalty(cross, sigma);

    // Check deadband
    const inDeadband = this.applyDeadband(d, A, spread_c, cross);

    // Calculate combined edge score
    let E: number;
    if (inDeadband) {
      E = 0;
    } else {
      E = this.calculateEdgeScore(A, dbar, d, theta, chi);
    }

    return {
      tau,
      dbar,
      A,
      d,
      cross,
      sigma,
      chi,
      theta,
      E,
      inDeadband,
    };
  }

  /**
   * Update tau using exponential decay
   *
   * tau_t = tau_{t-} * e^(-dt/H_tau) + I_t * (1 - e^(-dt/H_tau))
   */
  private updateTau(prevTau: number, I: number, dt: number): number {
    const decay = Math.exp(-(Math.log(2) / this.config.H_tau) * dt);
    return prevTau * decay + I * (1 - decay);
  }

  /**
   * Update dbar using EWMA
   *
   * dbar_t = dbar_{t-} * e^(-dt/H_d) + d_t * (1 - e^(-dt/H_d))
   */
  private updateDbar(prevDbar: number, d: number, dt: number): number {
    const decay = Math.exp(-(Math.log(2) / this.config.H_d) * dt);
    return prevDbar * decay + d * (1 - decay);
  }

  /**
   * Calculate chop metrics from price history
   *
   * - Crossing rate: count of sign flips around 0.50 per minute
   * - Logit volatility: std dev of logit returns
   */
  private calculateChop(priceHistory: PricePoint[]): { cross: number; sigma: number } {
    if (priceHistory.length < 6) {
      return { cross: 0, sigma: 0 };
    }

    // Calculate crossing rate
    let flips = 0;
    let prevSign = Math.sign(priceHistory[0].price - 0.5);
    for (let i = 1; i < priceHistory.length; i++) {
      const currSign = Math.sign(priceHistory[i].price - 0.5);
      if (prevSign !== 0 && currSign !== 0 && prevSign * currSign === -1) {
        flips++;
      }
      if (currSign !== 0) {
        prevSign = currSign;
      }
    }
    const windowMinutes = this.config.W_chop_sec / 60;
    const cross = flips / windowMinutes;

    // Calculate logit volatility
    const logits = priceHistory.map(p => this.logit(p.price));
    const returns: number[] = [];
    for (let i = 1; i < logits.length; i++) {
      returns.push(logits[i] - logits[i - 1]);
    }

    let sigma = 0;
    if (returns.length > 1) {
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
      sigma = Math.sqrt(variance);
    }

    return { cross, sigma };
  }

  /**
   * Calculate theta scaler (time-to-resolution decay)
   *
   * theta(T) = (T / (T + T0))^b
   */
  private calculateTheta(T_min: number): number {
    if (T_min <= 0) {
      return 0;
    }
    return Math.pow(T_min / (T_min + this.config.T0), this.config.theta_b);
  }

  /**
   * Calculate chop penalty
   *
   * chi = 1 / (1 + (cross/c0)^2 + (sigma/sigma0)^2)
   */
  private calculateChopPenalty(cross: number, sigma: number): number {
    return 1 / (
      1 +
      Math.pow(cross / this.config.c0, 2) +
      Math.pow(sigma / this.config.sigma0, 2)
    );
  }

  /**
   * Check if price is in deadband (suppress signal)
   *
   * Deadband rule: if |d| < delta AND |A| < A_min, suppress signal
   */
  private applyDeadband(
    d: number,
    A: number,
    spread_c: number,
    cross: number
  ): boolean {
    // Calculate adaptive deadband
    const delta = Math.max(
      this.config.delta_min,
      this.config.delta0 +
        this.config.lambda_s * spread_c +
        this.config.lambda_c * cross
    );

    return Math.abs(d) < delta && Math.abs(A) < this.config.A_min;
  }

  /**
   * Calculate combined edge score
   *
   * E = theta * chi * (alpha*A + beta*tanh(dbar/d0) + gamma*tanh(d/d1))
   */
  private calculateEdgeScore(
    A: number,
    dbar: number,
    d: number,
    theta: number,
    chi: number
  ): number {
    const component1 = this.config.alpha * A;
    const component2 = this.config.beta * Math.tanh(dbar / this.config.d0);
    const component3 = this.config.gamma * Math.tanh(d / this.config.d1);

    return theta * chi * (component1 + component2 + component3);
  }

  /**
   * Logit transform: log(p / (1-p))
   */
  private logit(p: number): number {
    const clipped = this.clip(p, 0.01, 0.99);
    return Math.log(clipped / (1 - clipped));
  }

  /**
   * Clip value to range
   */
  private clip(x: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, x));
  }
}
