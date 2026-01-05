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
};

/**
 * Parse strategy configuration from bot config
 */
export function parseConfig(strategyConfig: Record<string, unknown>): ArbitrageConfig {
  return {
    ...DEFAULT_ARBITRAGE_CONFIG,
    orderSize: parseFloat(String(strategyConfig.orderSize || DEFAULT_ARBITRAGE_CONFIG.orderSize)),
    maxPositionPerLeg: parseFloat(String(strategyConfig.maxPosition || DEFAULT_ARBITRAGE_CONFIG.maxPositionPerLeg)),
  };
}
