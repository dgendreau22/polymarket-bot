/**
 * Market Duration Configuration
 *
 * Shared between server (Orchestrator) and client (UI page).
 * Kept in a separate file to avoid pulling server-side dependencies into client components.
 */

export type MarketDuration = '5m' | '15m' | '1h' | '4h' | '1d';

export interface DurationConfig {
  suffix: string;
  intervalMinutes: number;
  displayName: string;
  maxLeadTimeMinutes: number;
  lookAheadSlots: number;
}

export const DURATION_CONFIGS: Record<MarketDuration, DurationConfig> = {
  '5m':  { suffix: '5m',  intervalMinutes: 5,    displayName: '5-min',  maxLeadTimeMinutes: 5,   lookAheadSlots: 8 },
  '15m': { suffix: '15m', intervalMinutes: 15,   displayName: '15-min', maxLeadTimeMinutes: 15,  lookAheadSlots: 8 },
  '1h':  { suffix: '1h',  intervalMinutes: 60,   displayName: '1hr',    maxLeadTimeMinutes: 60,  lookAheadSlots: 8 },
  '4h':  { suffix: '4h',  intervalMinutes: 240,  displayName: '4hr',    maxLeadTimeMinutes: 120, lookAheadSlots: 6 },
  '1d':  { suffix: '1d',  intervalMinutes: 1440, displayName: '1-day',  maxLeadTimeMinutes: 240, lookAheadSlots: 4 },
};
