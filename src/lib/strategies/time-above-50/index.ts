/**
 * TimeAbove50 Strategy Module
 *
 * Exports all components for the TimeAbove50 strategy.
 */

// Configuration
export type { TimeAbove50Config } from './TimeAbove50Config';
export { DEFAULT_CONFIG, parseConfig } from './TimeAbove50Config';

// State management
export type { BotState, PricePoint, PositionDirection } from './TimeAbove50State';
export { TimeAbove50State } from './TimeAbove50State';

// Consensus price calculation
export type { ConsensusResult } from './ConsensusPriceCalculator';
export { ConsensusPriceCalculator } from './ConsensusPriceCalculator';

// Signal calculation
export type { SignalComponents } from './SignalCalculator';
export { SignalCalculator } from './SignalCalculator';

// Exposure management
export type { ExposureTarget } from './ExposureManager';
export { ExposureManager } from './ExposureManager';

// Risk validation
export type { RiskCheckResult } from './RiskValidator';
export { RiskValidator } from './RiskValidator';

// Decision engine
export type { TradeAction } from './DecisionEngine';
export { DecisionEngine } from './DecisionEngine';

// Signal factory
export { SignalFactory } from './SignalFactory';
