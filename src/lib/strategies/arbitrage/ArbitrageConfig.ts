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
  closeOutThreshold: number;      // Time progress to activate close-out (default: 0.90)

  // Cooldown settings (ms)
  normalCooldownMs: number;       // Normal cooldown per leg (default: 3000)
  closeOutCooldownMs: number;     // Faster cooldown in close-out mode (default: 500)
  closeOutOrderMultiplier: number; // Order size multiplier in close-out (default: 3)

  // Position unwinding settings (for selling leading leg in close-out mode)
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
  closeOutThreshold: 0.90,
  normalCooldownMs: 3000,
  closeOutCooldownMs: 500,
  closeOutOrderMultiplier: 3,
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
    closeOutThreshold: getNumber('closeOutThreshold', DEFAULT_ARBITRAGE_CONFIG.closeOutThreshold),

    // Cooldown settings
    normalCooldownMs: getNumber('normalCooldownMs', DEFAULT_ARBITRAGE_CONFIG.normalCooldownMs),
    closeOutCooldownMs: getNumber('closeOutCooldownMs', DEFAULT_ARBITRAGE_CONFIG.closeOutCooldownMs),
    closeOutOrderMultiplier: getNumber('closeOutOrderMultiplier', DEFAULT_ARBITRAGE_CONFIG.closeOutOrderMultiplier),

    // Position unwinding settings
    sellThreshold: getNumber('sellThreshold', DEFAULT_ARBITRAGE_CONFIG.sellThreshold),
    minImbalanceForSell: getNumber('minImbalanceForSell', DEFAULT_ARBITRAGE_CONFIG.minImbalanceForSell),
  };
}
