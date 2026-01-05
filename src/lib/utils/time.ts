/**
 * Time/Date Utilities
 *
 * Centralized utilities for Eastern Time (ET) handling and time formatting.
 */

/**
 * Get ET offset in minutes (in same format as getTimezoneOffset - positive for west of UTC)
 * EST (Nov-Mar) = UTC-5 = +300 minutes
 * EDT (Mar-Nov) = UTC-4 = +240 minutes
 *
 * @param date - Date to check for DST
 * @returns Offset in minutes (240 for EDT, 300 for EST)
 */
export function getETOffsetMinutes(date: Date = new Date()): number {
  const month = date.getMonth();
  // Rough DST handling: EDT (UTC-4) from March to November, EST (UTC-5) otherwise
  // More accurate would be second Sunday in March to first Sunday in November
  if (month >= 2 && month <= 10) {
    return 240; // EDT: UTC-4 = +240 minutes behind UTC
  }
  return 300; // EST: UTC-5 = +300 minutes behind UTC
}

/**
 * Convert 12-hour to 24-hour format
 *
 * @param hour - Hour in 12-hour format (1-12)
 * @param period - 'AM' or 'PM'
 * @returns Hour in 24-hour format (0-23)
 */
export function to24Hour(hour: number, period: 'AM' | 'PM'): number {
  if (period === 'AM') {
    return hour === 12 ? 0 : hour;
  } else {
    return hour === 12 ? 12 : hour + 12;
  }
}

/**
 * Format hour and minute to 12-hour time string
 *
 * @param hour - Hour in 24-hour format (0-23)
 * @param minute - Minute (0-59)
 * @returns Formatted time string (e.g., "3:45PM")
 */
export function formatTime12Hour(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${hour12}:${minute.toString().padStart(2, '0')}${period}`;
}

/**
 * Convert a Date to Eastern Time representation
 * Returns a new Date object adjusted to ET (for calculation purposes)
 *
 * @param date - Date in local/UTC time
 * @returns Date adjusted to ET
 */
export function toETDate(date: Date): Date {
  const etOffsetMs = getETOffsetMinutes(date) * 60 * 1000;
  return new Date(date.getTime() - etOffsetMs);
}

/**
 * Convert from ET to UTC
 *
 * @param etDate - Date representing ET time
 * @returns Date in UTC
 */
export function fromETToUTC(etDate: Date): Date {
  const etOffsetMs = getETOffsetMinutes(etDate) * 60 * 1000;
  return new Date(etDate.getTime() + etOffsetMs);
}

/**
 * Adjust time from local timezone to ET
 * When we parse "3:45PM", JavaScript creates a Date for 3:45 PM LOCAL time.
 * This function adjusts it to represent 3:45 PM ET instead.
 *
 * @param localDate - Date parsed in local timezone
 * @returns Date adjusted to represent the same clock time in ET
 */
export function adjustLocalToET(localDate: Date): Date {
  const localOffsetMinutes = localDate.getTimezoneOffset();
  const etOffsetMinutes = getETOffsetMinutes(localDate);
  const adjustmentMs = (localOffsetMinutes - etOffsetMinutes) * 60 * 1000;
  return new Date(localDate.getTime() - adjustmentMs);
}
