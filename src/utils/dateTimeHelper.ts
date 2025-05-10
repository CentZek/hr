/**
 * Standardized date and time utilities with consistent 24-hour format
 */
import { parse, format, isValid, addDays, isSameOrBefore, isBefore, parseISO } from 'date-fns';

/**
 * Format a Date object to 24-hour time format
 * @param date The date to format
 * @returns Formatted time string (e.g., "21:15")
 */
export function formatTime24H(date: Date | null): string {
  if (!date) return 'Missing';
  return format(date, 'HH:mm');
}

/**
 * Format a Date object to 24-hour time format with optional 12-hour reference
 * Used for transition period to help users get used to 24-hour format
 * @param date The date to format
 * @returns Formatted time string (e.g., "21:15")
 */
export function formatTimeWithReference(date: Date | null): string {
  if (!date) return 'Missing';
  return format(date, 'HH:mm');
}

/**
 * Legacy function name kept for backward compatibility
 * Now standardized to always return 24-hour format
 */
export function formatTimeWithAMPM(date: Date | null): string {
  return formatTime24H(date);
}

/**
 * Format a time string from 24-hour to display format
 * @param timeStr Time string in 24-hour format (HH:MM)
 * @returns Formatted time for display
 */
export function formatTimeString(timeStr: string): string {
  if (!timeStr) return '';
  
  try {
    // Just return the 24-hour format directly
    return timeStr;
  } catch (e) {
    return timeStr;
  }
}

/**
 * Parse shift times with proper day rollover for night shifts
 * Used for both manual entries and employee-submitted shifts
 * @param dateStr The base date in YYYY-MM-DD format
 * @param timeIn The check-in time in HH:MM format
 * @param timeOut The check-out time in HH:MM format
 * @param shiftType Optional shift type to determine if day rollover should be forced
 * @returns Object containing parsed check-in and check-out dates
 */
export function parseShiftTimes(dateStr: string, timeIn: string, timeOut: string, shiftType?: string): { 
  checkIn: Date; 
  checkOut: Date;
} {
  const checkIn = parse(`${dateStr}T${timeIn}:00.000Z`, "yyyy-MM-dd'T'HH:mm:ss.SSSX", new Date());
  let checkOut = parse(`${dateStr}T${timeOut}:00.000Z`, "yyyy-MM-dd'T'HH:mm:ss.SSSX", new Date());
  
  // For night shifts, always roll over to next day if checkout is in early morning hours
  if (shiftType === 'night' && checkOut.getHours() < 12) {
    checkOut = addDays(checkOut, 1);
  } 
  // If check-out time is same or earlier than check-in, assume it's next day
  else if (isBefore(checkOut, checkIn) || checkOut.getTime() === checkIn.getTime()) {
    checkOut = addDays(checkOut, 1);
  }
  
  return { checkIn, checkOut };
}

/**
 * Parse a time string in various formats to a Date object
 * Always converts to 24-hour format internally
 */
export function parseTime(timeStr: string, dateStr: string): Date | null {
  if (!timeStr) return null;
  
  try {
    // Handle direct 24-hour input (standard)
    if (timeStr.match(/^\d{1,2}:\d{2}$/)) {
      return parse(`${dateStr}T${timeStr}:00.000Z`, "yyyy-MM-dd'T'HH:mm:ss.SSSX", new Date());
    }
    
    // Handle 12-hour format with AM/PM if present
    if (timeStr.match(/^\d{1,2}:\d{2}\s*[AaPp][Mm]$/)) {
      return parse(`${dateStr} ${timeStr}`, 'yyyy-MM-dd hh:mm a', new Date());
    }
    
    // Default fallback
    return parse(`${dateStr}T${timeStr}:00.000Z`, "yyyy-MM-dd'T'HH:mm:ss.SSSX", new Date());
  } catch (e) {
    console.error('Failed to parse time:', e);
    return null;
  }
}

/**
 * Parse a date+time string with explicit handling for 12/24 hour formats
 * Always converts to 24-hour format internally for consistency
 */
export function parseDateTime(dateTimeStr: string): Date | null {
  // Skip if empty or not a string
  if (!dateTimeStr || typeof dateTimeStr !== 'string') return null;
  
  // Common formats to try
  const formats = [
    // 24-hour formats
    'yyyy-MM-dd HH:mm:ss', 
    'yyyy-MM-dd HH:mm',
    'yyyy/MM/dd HH:mm:ss',
    'yyyy/MM/dd HH:mm',
    'MM/dd/yyyy HH:mm:ss',
    'MM/dd/yyyy HH:mm',
    'M/d/yyyy HH:mm:ss',
    'M/d/yyyy HH:mm',
    // 12-hour formats
    'MM/dd/yyyy h:mm:ss a',
    'MM/dd/yyyy h:mm a',
    'M/d/yyyy h:mm:ss a',
    'M/d/yyyy h:mm a',
  ];
  
  // Try each format
  for (const formatStr of formats) {
    try {
      const result = parse(dateTimeStr, formatStr, new Date());
      if (isValid(result)) {
        // Successfully parsed
        return result;
      }
    } catch (e) {
      // Continue to next format
    }
  }
  
  // Manual parsing for special cases
  try {
    // First extract date parts
    const dateMatch = dateTimeStr.match(/(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,4})/);
    if (!dateMatch) return null;
    
    let year, month, day;
    // Handle both MM/DD/YYYY and YYYY-MM-DD formats
    if (dateMatch[1].length === 4) {
      // YYYY-MM-DD
      year = parseInt(dateMatch[1]);
      month = parseInt(dateMatch[2]);
      day = parseInt(dateMatch[3]);
    } else {
      // MM/DD/YYYY
      month = parseInt(dateMatch[1]);
      day = parseInt(dateMatch[2]);
      year = parseInt(dateMatch[3]);
    }
    
    // Extract time parts, looking for hours, minutes, and AM/PM if present
    const timeMatch = dateTimeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([aApP][mM])?/);
    if (!timeMatch) return null;
    
    let hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    const seconds = timeMatch[3] ? parseInt(timeMatch[3]) : 0;
    
    // Handle AM/PM if present
    const isPM = timeMatch[4]?.toLowerCase() === 'pm';
    const isAM = timeMatch[4]?.toLowerCase() === 'am';
    
    // Convert to 24-hour
    if (isPM && hours < 12) {
      hours += 12; // Convert to 24-hour format (1 PM = 13:00)
    } else if (isAM && hours === 12) {
      hours = 0; // 12 AM = 00:00 in 24-hour format
    }
    
    // Create and return the date
    const result = new Date(year, month - 1, day, hours, minutes, seconds);
    if (isValid(result)) {
      return result;
    }
  } catch (e) {
    // If manual parsing fails, fall through to the last resort options
  }
  
  // If all else fails, try to directly create a Date object
  try {
    const result = new Date(dateTimeStr);
    if (isValid(result)) {
      return result;
    }
  } catch (e) {
    console.error('Failed to parse datetime:', e);
  }
  
  return null;
}

/**
 * Format a date object to display date
 */
export function formatDate(date: Date | null): string {
  if (!date) return '';
  return format(date, 'MM/dd/yyyy');
}

/**
 * Format a time value with 24-hour representation
 */
export function formatTimeWith24Hour(date: Date | null): string {
  if (!date) return 'Missing';
  return format(date, 'HH:mm');
}