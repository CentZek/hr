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
  
  // First ensure we're working with a proper Date object
  if (!(date instanceof Date) || !isValid(date)) return 'Missing';

  try {
    // IMPORTANT: For display purposes, use the local time rather than UTC
    // This ensures times show correctly in the user's timezone
    return format(date, 'HH:mm');
  } catch (err) {
    console.error('Error formatting time:', err);
    return 'Missing';
  }
}

/**
 * Format a Date object to 24-hour time format with optional 12-hour reference
 * Used for transition period to help users get used to 24-hour format
 * @param date The date to format
 * @returns Formatted time string (e.g., "21:15")
 */
export function formatTimeWithReference(date: Date | null): string {
  if (!date) return 'Missing';
  if (!(date instanceof Date) || !isValid(date)) return 'Missing';
  
  try {
    return format(date, 'HH:mm');
  } catch (err) {
    console.error('Error formatting time with reference:', err);
    return 'Missing';
  }
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
    console.error('Error formatting time string:', e);
    return timeStr;
  }
}

/**
 * Format time from a time record, preferring display values for non-manual entries
 * @param record The time record object
 * @param field Which field to format ('check_in' or 'check_out')
 * @returns Formatted time string
 */
export function formatRecordTime(record: any, field: 'check_in' | 'check_out'): string {
  // Guard against null or undefined records
  if (!record) return 'Missing';
  
  // For Excel-imported data, prefer the display value
  if (!record.is_manual_entry && record[`display_${field}`] && record[`display_${field}`] !== 'Missing') {
    return record[`display_${field}`];
  }
  
  // For manual entries, use the standard display logic
  if (record.is_manual_entry) {
    // Check if the record has a display value to use
    if (record[`display_${field}`] && record[`display_${field}`] !== 'Missing') {
      return record[`display_${field}`];
    }
    
    // If we have a shift type, use standard times
    if (record.shift_type) {
      const displayTimes = {
        morning: { check_in: '05:00', check_out: '14:00' },
        evening: { check_in: '13:00', check_out: '22:00' },
        night: { check_in: '21:00', check_out: '06:00' },
        canteen: { check_in: '07:00', check_out: '16:00' }
      };
      
      const shiftType = record.shift_type;
      if (displayTimes[shiftType as keyof typeof displayTimes]) {
        return displayTimes[shiftType as keyof typeof displayTimes][field];
      }
    }
  }
  
  // Fallback to the actual timestamp if available
  if (record.timestamp) {
    try {
      // FIREFOX FIX: Ensure we have a proper date object by creating a new one
      let date;
      if (typeof record.timestamp === 'string') {
        try {
          // Handle different string formats
          if (record.timestamp.includes('T')) {
            // ISO format
            date = new Date(record.timestamp);
          } else if (record.timestamp.includes('-')) {
            // YYYY-MM-DD format
            const parts = record.timestamp.split(/[-:\s]/);
            if (parts.length >= 3) {
              date = new Date(
                parseInt(parts[0], 10),
                parseInt(parts[1], 10) - 1,
                parseInt(parts[2], 10),
                parts.length > 3 ? parseInt(parts[3], 10) : 0,
                parts.length > 4 ? parseInt(parts[4], 10) : 0
              );
            } else {
              date = new Date(record.timestamp);
            }
          } else {
            // Fallback
            date = new Date(record.timestamp);
          }
        } catch (e) {
          console.error("Error parsing timestamp string:", e);
          return 'Missing';
        }
      } else if (record.timestamp instanceof Date) {
        date = record.timestamp;
      } else {
        console.error("Unrecognized timestamp format:", record.timestamp);
        return 'Missing';
      }
      
      if (date instanceof Date && !isNaN(date.getTime())) {
        return format(date, 'HH:mm');
      }
    } catch (err) {
      console.error("Error formatting time record:", err);
    }
  }
  
  return 'Missing';
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
  try {
    // Validate inputs to prevent errors
    if (!dateStr || !timeIn || !timeOut) {
      throw new Error('Invalid date or time parameters');
    }
    
    // FIREFOX FIX: Use new Date() approach for better cross-browser compatibility
    const [year, month, day] = dateStr.split('-').map(n => parseInt(n, 10));
    if (isNaN(year) || isNaN(month) || isNaN(day)) {
      throw new Error(`Invalid date format: ${dateStr}`);
    }
    
    // Parse check-in time
    const [inHour, inMinute] = timeIn.split(':').map(n => parseInt(n, 10));
    if (isNaN(inHour) || isNaN(inMinute)) {
      throw new Error(`Invalid check-in time: ${timeIn}`);
    }
    
    // Parse check-out time
    const [outHour, outMinute] = timeOut.split(':').map(n => parseInt(n, 10));
    if (isNaN(outHour) || isNaN(outMinute)) {
      throw new Error(`Invalid check-out time: ${timeOut}`);
    }
    
    // Create Date objects (month is 0-indexed in JavaScript)
    const checkIn = new Date(year, month - 1, day, inHour, inMinute);
    let checkOut = new Date(year, month - 1, day, outHour, outMinute);
    
    // For night shifts, always roll over to next day if checkout is in early morning hours
    if (shiftType === 'night' && outHour < 12) {
      checkOut = new Date(year, month - 1, day + 1, outHour, outMinute);
    } 
    // If check-out time is same or earlier than check-in, assume it's next day
    else if (checkOut <= checkIn) {
      checkOut = new Date(year, month - 1, day + 1, outHour, outMinute);
    }
    
    // Final validation
    if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) {
      throw new Error('Invalid date calculation');
    }
    
    return { checkIn, checkOut };
  } catch (error) {
    console.error('Error parsing shift times:', error);
    // Return current date as fallback to prevent crashes
    const now = new Date();
    return { 
      checkIn: now, 
      checkOut: new Date(now.getTime() + 9 * 60 * 60 * 1000) // 9 hours later
    };
  }
}

/**
 * Parse a time string in various formats to a Date object
 * Always converts to 24-hour format internally
 */
export function parseTime(timeStr: string, dateStr: string): Date | null {
  if (!timeStr || !dateStr) return null;
  
  try {
    // FIREFOX FIX: Use direct Date creation instead of parse
    const [year, month, day] = dateStr.split('-').map(n => parseInt(n, 10));
    if (isNaN(year) || isNaN(month) || isNaN(day)) {
      throw new Error(`Invalid date format: ${dateStr}`);
    }
    
    // Handle 24-hour format (HH:MM)
    if (timeStr.match(/^\d{1,2}:\d{2}$/)) {
      const [hours, minutes] = timeStr.split(':').map(n => parseInt(n, 10));
      if (isNaN(hours) || isNaN(minutes)) {
        throw new Error(`Invalid time format: ${timeStr}`);
      }
      return new Date(year, month - 1, day, hours, minutes);
    }
    
    // Handle 12-hour format with AM/PM
    if (timeStr.match(/^\d{1,2}:\d{2}\s*[AaPp][Mm]$/)) {
      // Extract hours, minutes, and AM/PM
      const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
      if (!match) throw new Error(`Invalid time format: ${timeStr}`);
      
      let hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const isPM = match[3].toLowerCase() === 'pm';
      
      // Convert to 24-hour format
      if (isPM && hours < 12) hours += 12;
      if (!isPM && hours === 12) hours = 0;
      
      return new Date(year, month - 1, day, hours, minutes);
    }
    
    // Default fallback using parse (with error checking)
    try {
      const result = parse(`${dateStr} ${timeStr}`, 'yyyy-MM-dd HH:mm', new Date());
      if (!isValid(result)) throw new Error(`Invalid time: ${timeStr}`);
      return result;
    } catch (parseError) {
      // If parse fails, try direct Date creation
      const [hours, minutes] = timeStr.split(':').map(n => parseInt(n, 10));
      if (isNaN(hours) || isNaN(minutes)) {
        throw new Error(`Invalid time format: ${timeStr}`);
      }
      return new Date(year, month - 1, day, hours, minutes);
    }
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
  
  // FIREFOX FIX: Try direct Date creation first
  try {
    const date = new Date(dateTimeStr);
    if (isValid(date)) return date;
  } catch (e) {
    // Continue to other methods if this fails
    console.debug('Direct Date creation failed, trying other methods', e);
  }
  
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
      year = parseInt(dateMatch[1], 10);
      month = parseInt(dateMatch[2], 10);
      day = parseInt(dateMatch[3], 10);
    } else {
      // MM/DD/YYYY
      month = parseInt(dateMatch[1], 10);
      day = parseInt(dateMatch[2], 10);
      year = parseInt(dateMatch[3], 10);
    }
    
    // Extract time parts, looking for hours, minutes, and AM/PM if present
    const timeMatch = dateTimeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([aApP][mM])?/);
    if (!timeMatch) return null;
    
    let hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
    
    // Handle AM/PM if present
    const isPM = timeMatch[4]?.toLowerCase() === 'pm';
    const isAM = timeMatch[4]?.toLowerCase() === 'am';
    
    // Convert to 24-hour
    if (isPM && hours < 12) {
      hours += 12; // Convert to 24-hour format (1 PM = 13:00)
    } else if (isAM && hours === 12) {
      hours = 0; // 12 AM = 00:00 in 24-hour format
    }
    
    // FIREFOX FIX: Use direct Date constructor
    const result = new Date(year, month - 1, day, hours, minutes, seconds);
    if (isValid(result)) {
      return result;
    }
  } catch (e) {
    // If manual parsing fails, fall through to the last resort options
    console.error('Manual date parsing failed:', e);
  }
  
  // FIREFOX FIX: As a last resort, try a standard ISO format transformation
  try {
    // Try to convert to a standard ISO format
    const cleanedDateStr = dateTimeStr.replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2');
    const result = new Date(cleanedDateStr);
    if (isValid(result)) {
      return result;
    }
  } catch (e) {
    console.error('Last resort date parsing failed:', e);
  }
  
  return null;
}

/**
 * Format a date object to display date
 */
export function formatDate(date: Date | null): string {
  if (!date) return '';
  if (!(date instanceof Date) || !isValid(date)) return '';
  try {
    return format(date, 'MM/dd/yyyy');
  } catch (err) {
    console.error('Error formatting date:', err);
    return '';
  }
}

/**
 * Format a time value with 24-hour representation
 */
export function formatTimeWith24Hour(date: Date | null): string {
  if (!date) return 'Missing';
  if (!(date instanceof Date) || !isValid(date)) return 'Missing';
  try {
    return format(date, 'HH:mm');
  } catch (err) {
    console.error('Error formatting time with 24 hour:', err);
    return 'Missing';
  }
}

/**
 * Safely get hours from a date object, with validation
 */
export function safeGetHours(date: any): number {
  if (date instanceof Date && isValid(date)) {
    try {
      return date.getHours();
    } catch (err) {
      console.error('Error getting hours from date:', err);
    }
  }
  return 0;
}

/**
 * Safely get minutes from a date object, with validation
 */
export function safeGetMinutes(date: any): number {
  if (date instanceof Date && isValid(date)) {
    try {
      return date.getMinutes();
    } catch (err) {
      console.error('Error getting minutes from date:', err);
    }
  }
  return 0;
}

/**
 * Safely convert any date-like value to a proper Date object
 */
export function ensureValidDate(value: any): Date | null {
  // If it's already a Date
  if (value instanceof Date && isValid(value)) {
    return value;
  }
  
  // If it's a string, try to parse it
  if (typeof value === 'string') {
    try {
      // FIREFOX FIX: Try multiple methods to parse the date
      
      // Method 1: Try direct Date construction
      let date = new Date(value);
      if (isValid(date)) {
        return date;
      }
      
      // Method 2: Try date-fns parseISO for ISO format
      if (value.includes('T')) {
        date = parseISO(value);
        if (isValid(date)) {
          return date;
        }
      }
      
      // Method 3: Try manual parsing for YYYY-MM-DD format
      if (value.includes('-')) {
        const [year, month, day] = value.split('-').map(part => parseInt(part, 10));
        if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
          date = new Date(year, month - 1, day);
          if (isValid(date)) {
            return date;
          }
        }
      }
      
      // Method 4: Try manual parsing for MM/DD/YYYY format
      if (value.includes('/')) {
        const [month, day, year] = value.split('/').map(part => parseInt(part, 10));
        if (!isNaN(month) && !isNaN(day) && !isNaN(year)) {
          date = new Date(year, month - 1, day);
          if (isValid(date)) {
            return date;
          }
        }
      }
      
      // Method 5: Try format detection
      if (value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
        // ISO format
        date = new Date(value);
        if (isValid(date)) {
          return date;
        }
      }
      
      return null;
    } catch (err) {
      console.error('Error parsing date string:', err);
    }
  }
  
  // If it's a timestamp number
  if (typeof value === 'number') {
    try {
      const date = new Date(value);
      if (isValid(date)) {
        return date;
      }
    } catch (err) {
      console.error('Error parsing timestamp:', err);
    }
  }
  
  return null;
}

/**
 * Clear Firefox-specific date caches
 * This resolves issues with timestamp formatting in Firefox
 */
export function clearBrowserDateCache(): void {
  try {
    // Detect Firefox
    const isFirefox = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().indexOf('firefox') > -1;
    
    if (isFirefox) {
      console.log('Firefox detected, clearing potential date cache issues');
      
      // Reset date-related localStorage items that might be causing issues
      if (typeof localStorage !== 'undefined') {
        // Get all keys
        const keysToCheck = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) keysToCheck.push(key);
        }
        
        // Look for keys that might contain timestamp data
        const dateRelatedKeys = keysToCheck.filter(key => 
          key.includes('timestamp') || 
          key.includes('date') || 
          key.includes('time') || 
          key.includes('record')
        );
        
        console.log(`Found ${dateRelatedKeys.length} potentially date-related keys in localStorage`);
        
        // Optional: clear these keys if you're sure they're causing problems
        // dateRelatedKeys.forEach(key => localStorage.removeItem(key));
      }
    }
  } catch (error) {
    console.error('Error clearing browser date cache:', error);
  }
}

// Run the cache clear function on module load
clearBrowserDateCache();