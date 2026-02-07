/**
 * Pricing Engine
 *
 * Black-Scholes digital option pricing with IV interpolation.
 * Used to compute theoretical prices for Polymarket binary options
 * based on Deribit implied volatility surface.
 */

import { IVSnapshot, ExpiryData } from '@/lib/deribit/types';

// ============================================================================
// Types
// ============================================================================

export interface TheoreticalPriceResult {
  /** Theoretical price (0-1 probability) */
  price: number;
  /** Interpolated IV used (as decimal) */
  iv: number;
  /** Underlying price used */
  forward: number;
  /** d2 value for debugging */
  d2: number;
  /** Confidence based on interpolation quality */
  confidence: 'high' | 'medium' | 'low';
}

// ============================================================================
// Normal Distribution
// ============================================================================

/**
 * Cumulative distribution function for standard normal distribution.
 * Uses Abramowitz & Stegun approximation (error < 1.5e-7).
 *
 * @param x - Value to evaluate CDF at
 * @returns Probability P(X <= x) where X ~ N(0,1)
 */
export function normalCDF(x: number): number {
  // Approximation coefficients
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1 / (1 + p * absX);
  const y =
    1 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp((-absX * absX) / 2);

  return 0.5 * (1 + sign * y);
}

// ============================================================================
// Strike Utilities
// ============================================================================

/**
 * Find the closest available strike to the target.
 *
 * @param targetStrike - Desired strike price
 * @param availableStrikes - Array of available strike prices
 * @returns Closest available strike
 * @throws Error if availableStrikes is empty
 */
export function findNearestStrike(targetStrike: number, availableStrikes: number[]): number {
  if (availableStrikes.length === 0) {
    throw new Error('No available strikes provided');
  }

  return availableStrikes.reduce((closest, current) =>
    Math.abs(current - targetStrike) < Math.abs(closest - targetStrike) ? current : closest
  );
}

// ============================================================================
// IV Interpolation
// ============================================================================

/**
 * Interpolate IV for a target expiry using total variance interpolation.
 *
 * Uses the formula:
 * - T1, T2 = Deribit expiries bracketing settlement T*
 * - w1 = sigma1^2 * T1, w2 = sigma2^2 * T2 (total variance)
 * - alpha = (T* - T1) / (T2 - T1)
 * - w* = w1 + alpha * (w2 - w1)
 * - sigma* = sqrt(w* / T*)
 *
 * @param ivSnapshot - IV surface snapshot from Deribit
 * @param targetExpiry - Target settlement date
 * @param targetStrike - Target strike (optional, uses ATM if not provided)
 * @returns Interpolated IV as decimal (e.g., 0.5 for 50%)
 */
export function interpolateIV(
  ivSnapshot: IVSnapshot,
  targetExpiry: Date,
  targetStrike?: number
): number {
  const expiries = ivSnapshot.expiries;

  if (expiries.length === 0) {
    throw new Error('No expiry data available in IV snapshot');
  }

  const targetTimestamp = targetExpiry.getTime();
  const strike = targetStrike ?? ivSnapshot.underlying_price;

  // Sort expiries by timestamp
  const sortedExpiries = [...expiries].sort(
    (a, b) => a.expiry_timestamp - b.expiry_timestamp
  );

  // Find bracketing expiries
  let lowerExpiry: ExpiryData | null = null;
  let upperExpiry: ExpiryData | null = null;

  for (const expiry of sortedExpiries) {
    if (expiry.expiry_timestamp <= targetTimestamp) {
      lowerExpiry = expiry;
    }
    if (expiry.expiry_timestamp >= targetTimestamp && upperExpiry === null) {
      upperExpiry = expiry;
    }
  }

  // Handle edge cases
  if (lowerExpiry === null) {
    // Target is before all expiries - use first expiry's IV
    return getIVAtStrike(sortedExpiries[0], strike);
  }

  if (upperExpiry === null) {
    // Target is beyond all expiries - extrapolate using last two
    if (sortedExpiries.length >= 2) {
      const second = sortedExpiries[sortedExpiries.length - 2];
      const first = sortedExpiries[sortedExpiries.length - 1];
      return interpolateBetweenExpiries(second, first, targetTimestamp, strike);
    }
    // Only one expiry available
    return getIVAtStrike(sortedExpiries[sortedExpiries.length - 1], strike);
  }

  // Target matches an expiry exactly
  if (lowerExpiry.expiry_timestamp === upperExpiry.expiry_timestamp) {
    return getIVAtStrike(lowerExpiry, strike);
  }

  // Interpolate between two expiries
  return interpolateBetweenExpiries(lowerExpiry, upperExpiry, targetTimestamp, strike);
}

/**
 * Interpolate IV between two expiries using total variance method.
 */
function interpolateBetweenExpiries(
  lower: ExpiryData,
  upper: ExpiryData,
  targetTimestamp: number,
  strike: number
): number {
  const iv1 = getIVAtStrike(lower, strike);
  const iv2 = getIVAtStrike(upper, strike);

  const T1 = lower.time_to_expiry_years;
  const T2 = upper.time_to_expiry_years;

  // Calculate target time to expiry in years
  const now = Date.now();
  const targetT = Math.max(0, (targetTimestamp - now) / (365.25 * 24 * 60 * 60 * 1000));

  // Total variance at each expiry: w = sigma^2 * T
  const w1 = iv1 * iv1 * T1;
  const w2 = iv2 * iv2 * T2;

  // Linear interpolation factor
  const alpha = T2 > T1 ? (targetT - T1) / (T2 - T1) : 0;

  // Interpolated total variance
  const wTarget = w1 + alpha * (w2 - w1);

  // Convert back to IV: sigma* = sqrt(w* / T*)
  if (targetT <= 0) {
    // At expiry, return the lower expiry IV
    return iv1;
  }

  return Math.sqrt(Math.max(0, wTarget / targetT));
}

/**
 * Get IV at a specific strike from expiry data.
 * Uses call mark IV if available, otherwise uses the nearest available strike.
 */
function getIVAtStrike(expiry: ExpiryData, targetStrike: number): number {
  if (expiry.strikes.length === 0) {
    throw new Error(`No strike data for expiry ${expiry.expiry_date}`);
  }

  // Find nearest strike
  const availableStrikes = expiry.strikes.map((s) => s.strike);
  const nearestStrike = findNearestStrike(targetStrike, availableStrikes);

  const strikeData = expiry.strikes.find((s) => s.strike === nearestStrike);
  if (!strikeData) {
    throw new Error(`Strike data not found for ${nearestStrike}`);
  }

  // Prefer call mark IV (more liquid for OTM calls above spot)
  // Convert from percentage to decimal (Deribit returns IV as percentage like 50 for 50%)
  return strikeData.call_mark_iv / 100;
}

// ============================================================================
// Black-Scholes Pricing
// ============================================================================

/**
 * Compute theoretical price for a digital (binary) call option using Black-Scholes.
 *
 * Formula:
 * - d2 = (ln(F/K) - 0.5 * sigma^2 * T) / (sigma * sqrt(T))
 * - p_theo = N(d2)
 *
 * Where:
 * - F = forward price (underlying)
 * - K = strike price
 * - sigma = implied volatility (decimal)
 * - T = time to expiry (years)
 *
 * @param forward - Forward/underlying price
 * @param strike - Strike price
 * @param iv - Implied volatility as decimal (e.g., 0.5 for 50%)
 * @param timeToExpiryYears - Time to expiry in years
 * @returns Theoretical price (0-1 probability)
 */
export function computeTheoreticalPrice(
  forward: number,
  strike: number,
  iv: number,
  timeToExpiryYears: number
): number {
  // Handle edge cases
  if (timeToExpiryYears <= 0) {
    // At expiry: digital pays 1 if F >= K, 0 otherwise
    return forward >= strike ? 1 : 0;
  }

  if (iv <= 0) {
    // Zero volatility: deterministic outcome
    return forward >= strike ? 1 : 0;
  }

  const sqrtT = Math.sqrt(timeToExpiryYears);

  // d2 = (ln(F/K) - 0.5 * sigma^2 * T) / (sigma * sqrt(T))
  const d2 =
    (Math.log(forward / strike) - 0.5 * iv * iv * timeToExpiryYears) / (iv * sqrtT);

  // Digital call price = N(d2)
  return normalCDF(d2);
}

/**
 * Compute theoretical price with full result including diagnostics.
 *
 * @param ivSnapshot - IV surface snapshot from Deribit
 * @param strike - Strike price for the binary option
 * @param targetExpiry - Settlement date
 * @returns Full pricing result with IV, forward, d2, and confidence
 */
export function computeTheoreticalPriceWithDiagnostics(
  ivSnapshot: IVSnapshot,
  strike: number,
  targetExpiry: Date
): TheoreticalPriceResult {
  const forward = ivSnapshot.underlying_price;

  // Calculate time to expiry
  const now = Date.now();
  const targetTimestamp = targetExpiry.getTime();
  const timeToExpiryYears = Math.max(0, (targetTimestamp - now) / (365.25 * 24 * 60 * 60 * 1000));

  // Interpolate IV
  const iv = interpolateIV(ivSnapshot, targetExpiry, strike);

  // Compute d2 for diagnostics
  let d2 = 0;
  if (timeToExpiryYears > 0 && iv > 0) {
    const sqrtT = Math.sqrt(timeToExpiryYears);
    d2 = (Math.log(forward / strike) - 0.5 * iv * iv * timeToExpiryYears) / (iv * sqrtT);
  }

  // Compute theoretical price
  const price = computeTheoreticalPrice(forward, strike, iv, timeToExpiryYears);

  // Determine confidence based on interpolation quality
  const confidence = determineConfidence(ivSnapshot, targetExpiry, strike);

  return {
    price,
    iv,
    forward,
    d2,
    confidence,
  };
}

/**
 * Determine confidence level based on interpolation quality.
 */
function determineConfidence(
  ivSnapshot: IVSnapshot,
  targetExpiry: Date,
  strike: number
): 'high' | 'medium' | 'low' {
  const targetTimestamp = targetExpiry.getTime();
  const expiries = ivSnapshot.expiries;

  if (expiries.length === 0) {
    return 'low';
  }

  // Check if target is within expiry range
  const sortedExpiries = [...expiries].sort(
    (a, b) => a.expiry_timestamp - b.expiry_timestamp
  );
  const minExpiry = sortedExpiries[0].expiry_timestamp;
  const maxExpiry = sortedExpiries[sortedExpiries.length - 1].expiry_timestamp;

  const isWithinRange = targetTimestamp >= minExpiry && targetTimestamp <= maxExpiry;

  // Check if strike is close to available strikes
  let minStrikeDistance = Infinity;
  for (const expiry of expiries) {
    for (const s of expiry.strikes) {
      const distance = Math.abs(s.strike - strike) / strike;
      minStrikeDistance = Math.min(minStrikeDistance, distance);
    }
  }

  // High confidence: within range and close strike (< 5%)
  if (isWithinRange && minStrikeDistance < 0.05) {
    return 'high';
  }

  // Medium confidence: within range or close strike
  if (isWithinRange || minStrikeDistance < 0.1) {
    return 'medium';
  }

  // Low confidence: extrapolation required
  return 'low';
}

// ============================================================================
// Implied Volatility (Inverse Pricing)
// ============================================================================

/**
 * Compute implied volatility from a market price using bisection method.
 * Given a market price for a digital option, find the IV that produces that price.
 *
 * @param marketPrice - Observed market price (0-1)
 * @param forward - Forward/underlying price
 * @param strike - Strike price
 * @param timeToExpiryYears - Time to expiry in years
 * @param tolerance - Convergence tolerance (default: 0.0001 = 0.01%)
 * @param maxIterations - Maximum iterations (default: 100)
 * @returns Implied volatility as decimal, or null if cannot converge
 */
export function computeImpliedIV(
  marketPrice: number,
  forward: number,
  strike: number,
  timeToExpiryYears: number,
  tolerance: number = 0.0001,
  maxIterations: number = 100
): number | null {
  // Handle edge cases
  if (timeToExpiryYears <= 0) {
    return null; // Cannot compute IV at expiry
  }

  if (marketPrice <= 0 || marketPrice >= 1) {
    return null; // Price outside valid range
  }

  // Bisection bounds for IV (1% to 500%)
  let ivLow = 0.01;
  let ivHigh = 5.0;

  // Check if solution exists within bounds
  const priceLow = computeTheoreticalPrice(forward, strike, ivLow, timeToExpiryYears);
  const priceHigh = computeTheoreticalPrice(forward, strike, ivHigh, timeToExpiryYears);

  // For digital calls: higher IV -> price moves toward 0.5
  // If strike > forward: higher IV -> higher price
  // If strike < forward: higher IV -> lower price
  const isOTM = strike > forward;

  if (isOTM) {
    // OTM call: price increases with IV
    if (marketPrice < priceLow || marketPrice > priceHigh) {
      return null; // No solution in range
    }
  } else {
    // ITM call: price decreases with IV
    if (marketPrice > priceLow || marketPrice < priceHigh) {
      return null; // No solution in range
    }
  }

  // Bisection iteration
  for (let i = 0; i < maxIterations; i++) {
    const ivMid = (ivLow + ivHigh) / 2;
    const priceMid = computeTheoreticalPrice(forward, strike, ivMid, timeToExpiryYears);
    const error = priceMid - marketPrice;

    if (Math.abs(error) < tolerance) {
      return ivMid;
    }

    if (isOTM) {
      // OTM: price increases with IV
      if (error > 0) {
        ivHigh = ivMid; // Price too high, reduce IV
      } else {
        ivLow = ivMid; // Price too low, increase IV
      }
    } else {
      // ITM: price decreases with IV
      if (error > 0) {
        ivLow = ivMid; // Price too high, increase IV to lower it
      } else {
        ivHigh = ivMid; // Price too low, decrease IV to raise it
      }
    }
  }

  // Did not converge, return best estimate
  return (ivLow + ivHigh) / 2;
}
