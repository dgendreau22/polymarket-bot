/**
 * Settlement Time Utilities
 *
 * Handles time-to-expiry calculations and ET to UTC conversion
 * for Polymarket settlement times.
 */

import { fromZonedTime, toZonedTime } from 'date-fns-tz';

// ============================================================================
// Constants
// ============================================================================

const EASTERN_TIMEZONE = 'America/New_York';
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

// ============================================================================
// Types
// ============================================================================

export interface SettlementInfo {
  settlementTimeUtc: Date;
  timeToExpiryYears: number;
  isExpired: boolean;
}

// ============================================================================
// Date Parsing
// ============================================================================

/**
 * Extract settlement date from Polymarket question text.
 * Questions typically look like:
 * - "Will Bitcoin be above $100,000 on January 29, 2026?"
 * - "Will BTC be above $100k on Jan 29, 2026?"
 * - "Will Bitcoin be above $100,000 on 2026-01-29?"
 * - "Will the price of Bitcoin be above $80,000 on January 29?" (no year - assumes current year)
 *
 * @returns Date in Eastern Time (noon ET - Polymarket settlement time), or null if no date found
 */
export function parseSettlementTime(questionText: string): Date | null {
  // Try ISO format first: 2026-01-29
  const isoMatch = questionText.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return createETDate(parseInt(year, 10), parseInt(month, 10), parseInt(day, 10));
  }

  // Try long format with year: January 29, 2026 or Jan 29, 2026
  const longMatch = questionText.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})\b/i
  );
  if (longMatch) {
    const [, monthName, day, year] = longMatch;
    const month = parseMonthName(monthName);
    if (month !== null) {
      return createETDate(parseInt(year, 10), month, parseInt(day, 10));
    }
  }

  // Try format without year: "on January 29?" or "on Jan 29"
  // Assumes current year (or next year if date has passed)
  const noYearMatch = questionText.match(
    /\bon\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\b/i
  );
  if (noYearMatch) {
    const [, monthName, day] = noYearMatch;
    const month = parseMonthName(monthName);
    if (month !== null) {
      const now = new Date();
      let year = now.getFullYear();

      // If the date appears to be in the past, assume next year
      const tentativeDate = createETDate(year, month, parseInt(day, 10));
      if (tentativeDate < now) {
        year += 1;
      }

      return createETDate(year, month, parseInt(day, 10));
    }
  }

  return null;
}

// ============================================================================
// Timezone Conversion
// ============================================================================

/**
 * Convert a date representing Eastern Time to UTC.
 * Correctly handles DST (EST vs EDT).
 *
 * @param etDate - Date object representing time in Eastern timezone
 * @returns Date object in UTC
 */
export function etToUtc(etDate: Date): Date {
  // fromZonedTime: Given a date that represents local time in a timezone,
  // returns the equivalent UTC date
  return fromZonedTime(etDate, EASTERN_TIMEZONE);
}

/**
 * Convert a UTC date to Eastern Time.
 *
 * @param utcDate - Date object in UTC
 * @returns Date object representing Eastern Time
 */
export function utcToEt(utcDate: Date): Date {
  return toZonedTime(utcDate, EASTERN_TIMEZONE);
}

// ============================================================================
// Settlement Info
// ============================================================================

/**
 * Get settlement information including time to expiry.
 * Settlement is at 12:00 ET (noon Eastern Time) for Polymarket BTC markets.
 *
 * @param settlementDate - Date representing settlement day in ET (at noon)
 * @returns Settlement info with UTC time, time to expiry, and expiration status
 */
export function getSettlementInfo(settlementDate: Date): SettlementInfo {
  const settlementTimeUtc = etToUtc(settlementDate);
  const now = new Date();

  const msToExpiry = settlementTimeUtc.getTime() - now.getTime();
  const timeToExpiryYears = msToExpiry / MS_PER_YEAR;

  return {
    settlementTimeUtc,
    timeToExpiryYears: Math.max(0, timeToExpiryYears),
    isExpired: msToExpiry <= 0,
  };
}

/**
 * Check if current time is within cutoff minutes of settlement.
 * Useful for stopping trading activity before settlement.
 *
 * @param settlementDate - Date representing settlement day in ET
 * @param cutoffMinutes - Minutes before settlement to trigger cutoff
 * @returns true if within cutoff period or past settlement
 */
export function isWithinCutoff(settlementDate: Date, cutoffMinutes: number): boolean {
  const settlementTimeUtc = etToUtc(settlementDate);
  const now = new Date();

  const msToExpiry = settlementTimeUtc.getTime() - now.getTime();
  const cutoffMs = cutoffMinutes * 60 * 1000;

  return msToExpiry <= cutoffMs;
}

// ============================================================================
// Private Helpers
// ============================================================================

/**
 * Create a Date object representing noon ET (12:00 Eastern) on the given date.
 * Polymarket BTC "above $X" markets settle at 12:00 ET (noon Eastern).
 * This is 17:00 UTC during EST (winter) or 16:00 UTC during EDT (summer).
 */
function createETDate(year: number, month: number, day: number): Date {
  // Create a date string representing noon ET
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00`;
  // Create a Date object where the local values represent the target time
  const localDate = new Date(dateStr);
  // Convert to UTC by treating the local date values as ET
  // fromZonedTime reads year/month/day/hour from the Date and interprets them as ET,
  // then returns the corresponding UTC timestamp
  return fromZonedTime(localDate, EASTERN_TIMEZONE);
}

/**
 * Parse month name to month number (1-12).
 */
function parseMonthName(name: string): number | null {
  const months: Record<string, number> = {
    january: 1, jan: 1,
    february: 2, feb: 2,
    march: 3, mar: 3,
    april: 4, apr: 4,
    may: 5,
    june: 6, jun: 6,
    july: 7, jul: 7,
    august: 8, aug: 8,
    september: 9, sep: 9,
    october: 10, oct: 10,
    november: 11, nov: 11,
    december: 12, dec: 12,
  };

  return months[name.toLowerCase()] ?? null;
}
