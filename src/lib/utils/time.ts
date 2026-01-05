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
