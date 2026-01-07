/**
 * Arbitrage Strategy Configuration
 *
 * Centralizes all configuration constants and provides parsing
 * for strategy configuration from bot config.
 */

/**
 * Full configuration for the arbitrage strategy
 */
export interface ArbitrageConfig {
  // Order settings
  orderSize: number;
  maxPositionPerLeg: number;

  // Profitability thresholds
  profitThreshold: number;        // Combined avg cost must stay below this (default: 0.98)
  maxSingleLegPrice: number;      // Max price for single leg without other leg (default: 0.75)

  // Imbalance settings
  imbalanceThreshold: number;     // Ratio to trigger aggressive mode (default: 0.50)

  // Cooldown settings (ms)
  cooldownMs: number;             // Cooldown per leg (default: 3000)

  // Profit-taking settings (for selling leading leg when imbalanced)
  sellThreshold: number;          // Price threshold above which to sell leading leg (default: 0.75)
  minImbalanceForSell: number;    // Minimum imbalance required before selling is allowed (default: 30)
}

/**
 * Default configuration values
 */
export const DEFAULT_ARBITRAGE_CONFIG: ArbitrageConfig = {
  orderSize: 10,
  maxPositionPerLeg: 100,
  profitThreshold: 0.98,
  maxSingleLegPrice: 0.75,
  imbalanceThreshold: 0.50,
  cooldownMs: 3000,
  sellThreshold: 0.75,
  minImbalanceForSell: 30,
};

/**
 * Parse strategy configuration from bot config
 */
export function parseConfig(strategyConfig: Record<string, unknown>): ArbitrageConfig {
  const getNumber = (key: string, defaultVal: number): number => {
    const val = strategyConfig[key];
    return val !== undefined ? parseFloat(String(val)) : defaultVal;
  };

  return {
    // Order settings
    orderSize: getNumber('orderSize', DEFAULT_ARBITRAGE_CONFIG.orderSize),
    maxPositionPerLeg: getNumber('maxPosition', DEFAULT_ARBITRAGE_CONFIG.maxPositionPerLeg),

    // Profitability thresholds
    profitThreshold: getNumber('profitThreshold', DEFAULT_ARBITRAGE_CONFIG.profitThreshold),
    maxSingleLegPrice: getNumber('maxSingleLegPrice', DEFAULT_ARBITRAGE_CONFIG.maxSingleLegPrice),

    // Imbalance settings
    imbalanceThreshold: getNumber('imbalanceThreshold', DEFAULT_ARBITRAGE_CONFIG.imbalanceThreshold),

    // Cooldown settings
    cooldownMs: getNumber('cooldownMs', DEFAULT_ARBITRAGE_CONFIG.cooldownMs),

    // Profit-taking settings
    sellThreshold: getNumber('sellThreshold', DEFAULT_ARBITRAGE_CONFIG.sellThreshold),
    minImbalanceForSell: getNumber('minImbalanceForSell', DEFAULT_ARBITRAGE_CONFIG.minImbalanceForSell),
  };
}
