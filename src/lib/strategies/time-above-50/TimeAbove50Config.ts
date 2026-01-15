/**
 * TimeAbove50 Strategy Configuration
 *
 * Parses and validates all 30+ strategy parameters from bot.config.strategyConfig.
 * Default values match the specification in timeAbove50.md.
 */

export interface TimeAbove50Config {
  // Signal parameters (EWMA half-lives in seconds)
  H_tau: number;           // Time-above EW half-life (default: 45s)
  H_d: number;             // Displacement EW half-life (default: 60s)
  W_chop_sec: number;      // Chop window size (default: 90s)

  // Theta scaler (time-to-resolution)
  T0: number;              // Theta reference time in minutes (default: 3.0)
  theta_b: number;         // Theta exponent (default: 1.5)

  // Edge score weights
  alpha: number;           // Weight for A (time-above score) (default: 1.0)
  beta: number;            // Weight for tanh(d_bar/d0) (default: 0.6)
  gamma: number;           // Weight for tanh(d/d1) (default: 0.3)
  d0: number;              // Scale for smoothed displacement (default: 0.015)
  d1: number;              // Scale for instant displacement (default: 0.010)

  // Chop penalty
  c0: number;              // Reference crossing rate (default: 2.0 flips/min)
  sigma0: number;          // Reference logit volatility (default: 0.08)

  // Sizing
  k: number;               // Edge-to-exposure sensitivity (default: 2.5)
  Q_max: number;           // Max exposure in shares (default: 600)
  q_step: number;          // Min step size for rebalancing (default: 10)

  // Deadband around 0.50
  delta_min: number;       // Minimum deadband (default: 0.003)
  delta0: number;          // Base deadband (default: 0.004)
  lambda_s: number;        // Spread contribution to deadband (default: 0.5)
  lambda_c: number;        // Chop contribution to deadband (default: 0.002)
  A_min: number;           // Minimum persistence (default: 0.15)

  // Hysteresis thresholds
  E_enter: number;         // Edge threshold to enter/expand (default: 0.18)
  E_exit: number;          // Edge threshold to exit (default: 0.10)
  E_taker: number;         // Edge threshold for taker orders (default: 0.30)
  E_override: number;      // Edge override for time flatten (default: 0.35)

  // Liquidity gates
  spread_max_entry: number; // Max spread for new entries (default: 0.025)
  spread_halt: number;      // Spread to halt all activity (default: 0.04)

  // Time flatten (minutes to resolution)
  T_flat: number;          // Time to start flattening (default: 1.0 min)

  // Throttles (in seconds)
  rebalance_interval: number; // Min time between decisions (default: 2.0s)
  cooldown: number;           // Cooldown after fill (default: 2.0s)
  min_hold: number;           // Min hold before direction flip (default: 15s)

  // EV gating (disabled by default - zero fees)
  EV_min: number;          // Minimum EV threshold (default: 0.0)
  m: number;               // p_hat forecast multiplier (default: 1.0)
}

/**
 * Default configuration values from the specification
 */
export const DEFAULT_CONFIG: TimeAbove50Config = {
  // Signal parameters
  H_tau: 45.0,
  H_d: 60.0,
  W_chop_sec: 90,

  // Theta scaler
  T0: 3.0,
  theta_b: 1.5,

  // Edge score weights
  alpha: 1.0,
  beta: 0.6,
  gamma: 0.3,
  d0: 0.015,
  d1: 0.010,

  // Chop penalty
  c0: 2.0,
  sigma0: 0.08,

  // Sizing
  k: 2.5,
  Q_max: 600,
  q_step: 10,

  // Deadband
  delta_min: 0.003,
  delta0: 0.004,
  lambda_s: 0.5,
  lambda_c: 0.002,
  A_min: 0.15,

  // Hysteresis
  E_enter: 0.18,
  E_exit: 0.10,
  E_taker: 0.30,
  E_override: 0.35,

  // Liquidity gates
  spread_max_entry: 0.025,
  spread_halt: 0.04,

  // Time flatten
  T_flat: 1.0,

  // Throttles
  rebalance_interval: 2.0,
  cooldown: 2.0,
  min_hold: 15.0,

  // EV gating (disabled)
  EV_min: 0.0,
  m: 1.0,
};

/**
 * Helper to get a number value from config with default
 */
function getNumber(
  config: Record<string, unknown>,
  key: string,
  defaultValue: number
): number {
  const value = config[key];
  if (typeof value === 'number' && !isNaN(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }
  return defaultValue;
}

/**
 * Parse strategy configuration from bot.config.strategyConfig
 */
export function parseConfig(
  strategyConfig: Record<string, unknown>
): TimeAbove50Config {
  return {
    // Signal parameters
    H_tau: getNumber(strategyConfig, 'H_tau', DEFAULT_CONFIG.H_tau),
    H_d: getNumber(strategyConfig, 'H_d', DEFAULT_CONFIG.H_d),
    W_chop_sec: getNumber(strategyConfig, 'W_chop_sec', DEFAULT_CONFIG.W_chop_sec),

    // Theta scaler
    T0: getNumber(strategyConfig, 'T0', DEFAULT_CONFIG.T0),
    theta_b: getNumber(strategyConfig, 'theta_b', DEFAULT_CONFIG.theta_b),

    // Edge score weights
    alpha: getNumber(strategyConfig, 'alpha', DEFAULT_CONFIG.alpha),
    beta: getNumber(strategyConfig, 'beta', DEFAULT_CONFIG.beta),
    gamma: getNumber(strategyConfig, 'gamma', DEFAULT_CONFIG.gamma),
    d0: getNumber(strategyConfig, 'd0', DEFAULT_CONFIG.d0),
    d1: getNumber(strategyConfig, 'd1', DEFAULT_CONFIG.d1),

    // Chop penalty
    c0: getNumber(strategyConfig, 'c0', DEFAULT_CONFIG.c0),
    sigma0: getNumber(strategyConfig, 'sigma0', DEFAULT_CONFIG.sigma0),

    // Sizing
    k: getNumber(strategyConfig, 'k', DEFAULT_CONFIG.k),
    Q_max: getNumber(strategyConfig, 'Q_max', DEFAULT_CONFIG.Q_max),
    q_step: getNumber(strategyConfig, 'q_step', DEFAULT_CONFIG.q_step),

    // Deadband
    delta_min: getNumber(strategyConfig, 'delta_min', DEFAULT_CONFIG.delta_min),
    delta0: getNumber(strategyConfig, 'delta0', DEFAULT_CONFIG.delta0),
    lambda_s: getNumber(strategyConfig, 'lambda_s', DEFAULT_CONFIG.lambda_s),
    lambda_c: getNumber(strategyConfig, 'lambda_c', DEFAULT_CONFIG.lambda_c),
    A_min: getNumber(strategyConfig, 'A_min', DEFAULT_CONFIG.A_min),

    // Hysteresis
    E_enter: getNumber(strategyConfig, 'E_enter', DEFAULT_CONFIG.E_enter),
    E_exit: getNumber(strategyConfig, 'E_exit', DEFAULT_CONFIG.E_exit),
    E_taker: getNumber(strategyConfig, 'E_taker', DEFAULT_CONFIG.E_taker),
    E_override: getNumber(strategyConfig, 'E_override', DEFAULT_CONFIG.E_override),

    // Liquidity gates
    spread_max_entry: getNumber(strategyConfig, 'spread_max_entry', DEFAULT_CONFIG.spread_max_entry),
    spread_halt: getNumber(strategyConfig, 'spread_halt', DEFAULT_CONFIG.spread_halt),

    // Time flatten
    T_flat: getNumber(strategyConfig, 'T_flat', DEFAULT_CONFIG.T_flat),

    // Throttles
    rebalance_interval: getNumber(strategyConfig, 'rebalance_interval', DEFAULT_CONFIG.rebalance_interval),
    cooldown: getNumber(strategyConfig, 'cooldown', DEFAULT_CONFIG.cooldown),
    min_hold: getNumber(strategyConfig, 'min_hold', DEFAULT_CONFIG.min_hold),

    // EV gating
    EV_min: getNumber(strategyConfig, 'EV_min', DEFAULT_CONFIG.EV_min),
    m: getNumber(strategyConfig, 'm', DEFAULT_CONFIG.m),
  };
}
